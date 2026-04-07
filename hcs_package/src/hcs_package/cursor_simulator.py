"""
Playwright-compatible cursor simulator.

This module provides a high-level interface for generating human-like cursor
trajectories that can be used with Playwright for browser automation.

Implementation Notes:
- Noise is applied every step (when add_noise=True) to match steering_simulator behavior
- Plans are generated every step (no plan reuse with Tp) for simplicity and flexibility
- Uses cubic splines (k=3) for reference path generation when use_optimal_path=False
- Velocity indexing matches steering_simulator: uses index 1 (first planned step) for noise
"""

import json
import numpy as np
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any, Union
from .model import model
from .mpcc_model import reset_warm_start
from .params import SteeringModelInput, BumpParams, EnvParams, TunnelInfo
from .reference_path import ReferencePath, generate_optimal_reference_path
from .noise import single_step_motor_and_device_noise
from .constraints import ConstraintConfig, ConstraintRegion, ConstraintType, PathConstraint, RectangleConstraint, PolygonConstraint
from .constraint_utils import parse_constraints_from_json, convert_constraints_to_corridor_bounds
from .adapt import compute_clearance_profile, compute_curvature_rate_profile, compute_curvature_spike_profile


class CursorSimulator:
    """
    A simulator for generating human-like cursor movements.
    
    This class provides a simple interface for generating cursor trajectories
    that can be used with Playwright's mouse movement functions.
    
    Example:
        >>> simulator = CursorSimulator()                          # default: office_worker
        >>> simulator = CursorSimulator("gamer")                   # built-in persona name
        >>> simulator = CursorSimulator("/path/to/custom.json")    # custom config file
        >>> trajectory = simulator.generate_trajectory_with_waypoints(task_file="task.json")
        >>> for x, y, delay in trajectory:
        ...     page.mouse.move(x, y)
        ...     await page.wait_for_timeout(int(delay * 1000))
    
    Available built-in personas:
        office_worker, novice, gamer, young_children, fatigued, motor_impaired
    """
    
    # Directory containing built-in user configuration files
    _CONFIG_DIR = Path(__file__).parent / "user_configurations"
    
    def __init__(self, user_config: Optional[Union[str, Path]] = None):
        """
        Initialize the cursor simulator.
        
        Args:
            user_config: User persona configuration. Can be:
                - None: uses "office_worker" (default)
                - A built-in persona name: "office_worker", "novice", "gamer",
                  "young_children", "fatigued", "motor_impaired"
                - A path to a custom JSON configuration file
        """
        # Base defaults (always present, persona config overrides these)
        config = {
            "Interval": 0.05,
            "Tp": 0.05,
            "Th": 0.3,
            "nc": [0.2, 0.02],
            "forearm": 0.357,
            "mouseGain": 1,
            "planner_weights": {
                "jerk": 1.2e-06,
                "progress": 0.1e-06,
                "constraint": 50,
                "contour": 20,
                "lag": 0.05,
                "desired_speed": 0.2
            },
            "planner_margin": 0.0,
            "add_noise": True,
            "ddm_enabled": False,
            "random_seed": 1000
        }
        
        # Resolve persona config file
        if user_config is None:
            user_config = "office_worker"
        
        config_path = Path(user_config)
        
        # If it's not an existing file path, treat it as a built-in persona name
        if not config_path.exists():
            builtin_path = self._CONFIG_DIR / f"{user_config}.json"
            if builtin_path.exists():
                config_path = builtin_path
            else:
                available = [f.stem for f in self._CONFIG_DIR.glob("*.json")]
                raise FileNotFoundError(
                    f"User config not found: '{user_config}'. "
                    f"Available built-in personas: {available}"
                )
        
        # Load and merge persona config
        with open(config_path, 'r') as f:
            user_cfg = json.load(f)
        
        # Deep-merge planner_weights (so partial overrides work)
        if 'planner_weights' in user_cfg:
            config['planner_weights'].update(user_cfg.pop('planner_weights'))
        config.update(user_cfg)
        
        # Set parameters from config
        self.interval = config['Interval']
        self.forearm = config['forearm']
        
        # Convert Th (seconds) to prediction horizon (steps)
        th = config['Th']
        self.pred_horizon = max(1, int(round(th / self.interval)))
        
        # Convert Tp (seconds) to planning horizon (steps)
        tp = config['Tp']
        self.tp = max(1, int(round(tp / self.interval)))
        
        self.nc = list(config['nc'])
        self.planner_weights = config['planner_weights']
        self.planner_margin = config['planner_margin']
        self.add_noise = config['add_noise']
        
        seed = config['random_seed']
        if seed is not None:
            np.random.seed(seed)

        # Reference path params: prefer dedicated section, fall back to planner_weights
        rp_cfg = config.get('reference_path', {})
        pw = self.planner_weights
        self.reference_path_params = {
            'w_cut': rp_cfg.get('w_cut', pw.get('w_cut', 0.01)),
            'w_suppress': rp_cfg.get('w_suppress', pw.get('w_suppress', 0.0)),
            'w_width_exp': rp_cfg.get('w_width_exp', pw.get('w_width_exp', 1.0)),
            'cut_window_frac': rp_cfg.get('cut_window_frac', pw.get('cut_window_frac', 0.05)),
            'global_clearance_ref': rp_cfg.get('global_clearance_ref', pw.get('global_clearance_ref', 0.025)),
        }

        # Speed model: load from config
        self.speed_model = self._load_speed_model(config, config_path)

    @staticmethod
    def _load_speed_model(config: dict, config_path: Path):
        """Load speed model from config's ``speed_model`` section.

        Supported formats::

            "speed_model": {"type": "gam", "path": "model.pkl"}

        If the section is absent, returns None.

        For GAM models, relative paths are resolved against the directory
        containing the config file.
        """
        sm_cfg = config.get('speed_model')
        if sm_cfg is None or not isinstance(sm_cfg, dict):
            return None

        model_type = sm_cfg.get('type', 'gam')

        if model_type == 'gam':
            from .speed_model import GAMSpeedModel
            model_path = sm_cfg.get('path')
            if model_path is None:
                raise ValueError("speed_model type='gam' requires a 'path' key")
            model_path = Path(model_path)
            if not model_path.is_absolute():
                model_path = config_path.parent / model_path
            if not model_path.exists():
                raise FileNotFoundError(f"GAM speed model not found: {model_path}")
            return GAMSpeedModel.load(str(model_path))

        raise ValueError(f"Unknown speed_model type: {model_type!r}")

    def generate_trajectory_with_waypoints(
        self,
        task_file: Optional[Union[str, Path]] = None,
        waypoints: Optional[List[Tuple[float, float]]] = None,
        constraints: Optional[Union[Dict[str, Any], str, Path]] = None,
        screen_width: float = 1920.0,
        screen_height: float = 1080.0,
        max_steps: int = 2000,
        target_radius: float = 0.01,
        use_optimal_path: bool = True,
        return_timestamps: bool = False,
        return_reference_path: bool = False
    ) -> Union[List[Tuple[float, float, float]], Tuple[List[Tuple[float, float, float]], Any]]:
        """
        Generate a trajectory following waypoints with optional constraints.
        
        Args:
            task_file: Path to task.json file containing "waypoints", "constraints", and optionally
                      "screen_width" and "screen_height". If provided, these values from the file will be used.
                      Format: {"waypoints": [[x1, y1], [x2, y2], ...], "constraints": {...}, 
                               "screen_width": 1920, "screen_height": 1080}
            waypoints: Optional list of (x, y) waypoints in screen pixels. 
                      Ignored if task_file is provided.
            constraints: Optional constraints in JSON format. Ignored if task_file is provided.
                        Can be:
                        - Dictionary with constraint configuration
                        - Path to JSON file
                        - JSON string
            screen_width: Screen width in pixels (default: 1920). Overridden by task_file if present.
            screen_height: Screen height in pixels (default: 1080). Overridden by task_file if present.
            max_steps: Maximum simulation steps (default: 2000)
            target_radius: Target radius in normalized coordinates (default: 0.01)
            use_optimal_path: If True, generate optimal reference path from waypoints (default: True)
            return_timestamps: If True, return timestamps instead of delays (default: False)
            return_reference_path: If True, also return the reference path object (default: False)
        
        Returns:
            If return_reference_path is False: List of tuples (x, y, delay) or (x, y, timestamp)
            If return_reference_path is True: Tuple of (trajectory, reference_path)
        """
        # Load task file if provided
        if task_file is not None:
            task_path = Path(task_file)
            if not task_path.exists():
                raise FileNotFoundError(f"Task file not found: {task_file}")
            
            with open(task_path, 'r') as f:
                task_data = json.load(f)
            
            # Extract waypoints and constraints from task file
            if "waypoints" not in task_data:
                raise ValueError("task.json must contain 'waypoints' key")
            
            # Convert waypoints from list of lists to list of tuples
            waypoints = [tuple(wp) for wp in task_data["waypoints"]]
            
            # Extract constraints if present
            if "constraints" in task_data:
                constraints = task_data["constraints"]
            
            # Extract screen dimensions if present (override function parameters)
            if "screen_width" in task_data:
                screen_width = float(task_data["screen_width"])
            if "screen_height" in task_data:
                screen_height = float(task_data["screen_height"])
        
        # Validate waypoints
        if waypoints is None or len(waypoints) < 1:
            raise ValueError("At least 1 waypoint is required (either from task_file or waypoints parameter)")

        # Single waypoint: return a trivial trajectory at that point
        if len(waypoints) == 1:
            x, y = waypoints[0]
            result = [(x, y, 0.0)]
            if return_reference_path:
                return result, None
            return result
        
        # Convert screen coordinates to normalized coordinates (meters)
        screen_width_m = 0.46  # meters
        screen_height_m = screen_height / screen_width * screen_width_m
        
        # Normalize waypoints
        waypoints_norm = [
            (x / screen_width * screen_width_m, y / screen_height * screen_height_m)
            for x, y in waypoints
        ]
        
        # Parse constraints
        constraint_config = None
        if constraints is not None:
            if isinstance(constraints, (str, Path)):
                # Load from file or parse JSON string
                path = Path(constraints)
                if path.exists():
                    with open(path, 'r') as f:
                        constraints_dict = json.load(f)
                        # Handle nested structure (e.g., {"constraints": {...}})
                        if "constraints" in constraints_dict:
                            constraints_dict = constraints_dict["constraints"]
                else:
                    # Try parsing as JSON string
                    constraints_dict = json.loads(constraints)
            else:
                constraints_dict = constraints
            
            constraint_config = parse_constraints_from_json(constraints_dict)
        
        # Build cartesian_regions first — needed for constraint-aware QP bounds
        cartesian_regions = []
        if constraint_config is not None:
            for region in constraint_config.regions:
                if isinstance(region.geometry, (RectangleConstraint, PolygonConstraint)):
                    cartesian_regions.append(region)

        # Generate reference path
        tunnel_width = None  # Initialize tunnel_width
        if use_optimal_path and len(waypoints_norm) >= 2:
            # Estimate tunnel width from PathConstraint geometry when available,
            # otherwise fall back to waypoint-spacing heuristic.
            if constraint_config is not None:
                for region in constraint_config.regions:
                    if isinstance(region.geometry, PathConstraint):
                        tunnel_width = float(region.geometry.width)
                        break
            if tunnel_width is None:
                distances = [
                    np.linalg.norm(np.array(waypoints_norm[i+1]) - np.array(waypoints_norm[i]))
                    for i in range(len(waypoints_norm) - 1)
                ]
                avg_distance = np.mean(distances) if distances else 0.1
                tunnel_width = min(0.1, max(0.02, avg_distance * 0.3))

            # Read race-tracing parameters from reference_path_params
            rp = self.reference_path_params
            w_cut                = rp['w_cut']
            w_suppress           = rp['w_suppress']
            w_width_exp          = rp['w_width_exp']
            cut_window_frac      = rp['cut_window_frac']
            global_clearance_ref = rp['global_clearance_ref']

            # Compute corridor_bounds from centerline for reference path generation.
            # This allows clearance computation to work with path-relative constraints.
            # Cache centerline spline — reused later for curvature rate profile.
            centerline_corridor_bounds = None
            centerline_spline = ReferencePath(waypoints_norm, s=0.0, k=3)
            if constraint_config is not None:
                centerline_corridor_bounds = convert_constraints_to_corridor_bounds(
                    constraint_config,
                    centerline_spline,
                    default_margin=self.planner_margin,
                )

            reference_path = generate_optimal_reference_path(
                tunnel_path=waypoints_norm,
                tunnel_width=tunnel_width,
                margin=self.planner_margin,
                num_knots=None,
                w_cut=w_cut,
                w_suppress=w_suppress,
                w_width_exp=w_width_exp,
                cut_window_frac=cut_window_frac,
                global_clearance_ref=global_clearance_ref,
                cartesian_constraints=cartesian_regions if cartesian_regions else None,
                corridor_bounds=centerline_corridor_bounds,
                centerline_cache=centerline_spline,
            )
        else:
            # Use linear spline through waypoints
            centerline_spline = None
            reference_path = ReferencePath(waypoints_norm, s=0.0, k=1)

        # PathConstraint → path-relative corridor_bounds  (tunnel, lasso)
        corridor_bounds = None
        if constraint_config is not None:
            corridor_bounds = convert_constraints_to_corridor_bounds(
                constraint_config,
                reference_path,
                default_margin=self.planner_margin,
            )
        
        # Pre-compute clearance profile for normalized clearance control.
        # Used for both speed adaptation (steering law) and tracking adaptation.
        # Always computed when reference path exists (features enabled by default).
        clearance_profile = None
        curvature_rate_profile = None
        curvature_profile = None
        if reference_path.total_length > 0:
            n_profile = 500
            s_profile = np.linspace(0, reference_path.total_length, n_profile)
            c_profile = compute_clearance_profile(
                reference_path, s_profile,
                corridor_bounds=corridor_bounds,
                cartesian_constraints=cartesian_regions if cartesian_regions else None,
            )
            clearance_profile = (s_profile, c_profile)

            # Pre-compute curvature difficulty signal for stop-and-go behavior.
            # Computed on the CENTERLINE (not optimized path) so that corner
            # difficulty is preserved even when corner-cutting smooths the trajectory.
            # The signal is κ × |∂κ/∂s| which fires strongly at corners
            # (high curvature AND high rate of change).
            # Reuse cached centerline spline from corridor bounds computation,
            # or create one if not available (non-optimal path case).
            centerline_path = centerline_spline if centerline_spline is not None else ReferencePath(waypoints_norm, s=0.0, k=3)
            n_cl = 500
            s_cl = np.linspace(0, centerline_path.total_length, n_cl)
            rate_cl = compute_curvature_rate_profile(centerline_path, s_cl)
            
            # Map centerline signal to optimized path using normalized progress [0,1]
            progress_cl = s_cl / centerline_path.total_length
            progress_opt = s_profile / reference_path.total_length
            rate_profile = np.interp(progress_opt, progress_cl, rate_cl)
            curvature_rate_profile = (s_profile, rate_profile)

            # Pre-compute absolute curvature profile on the OPTIMIZED reference path.
            # Used for curvature-responsive speed modulation: humans slow in curves
            # even on smooth (sigmoidal) paths where rate-based stop-and-go is disabled.
            kappa_profile = np.array([abs(reference_path.curvature(float(s))) for s in s_profile])
            curvature_profile = (s_profile, kappa_profile)

        # Initialize state at first waypoint
        cursor_pos = np.array([waypoints_norm[0][0], waypoints_norm[0][1]], dtype=float)
        cursor_vel = np.array([0.0, 0.0], dtype=float)
        hand_pos = np.array([0.0, 0.0], dtype=float)
        
        reset_warm_start()
        trajectory = []
        current_time = 0.0
        final_target = np.array(waypoints_norm[-1])
        
        for step in range(max_steps):
            # Check if cursor has reached the final target
            dist_to_target = np.linalg.norm(cursor_pos - final_target)
            if dist_to_target < target_radius:
                break
            
            # Build model input
            tunnel_path = waypoints_norm  # Use waypoints as tunnel path
            model_input = SteeringModelInput(
                state_cog=(
                    float(cursor_pos[0]),
                    float(cursor_pos[1]),
                    float(cursor_vel[0]),
                    float(cursor_vel[1])
                ),
                bump=BumpParams(
                    pred_horizon=self.pred_horizon,
                    Tp=self.tp,
                    nc=self.nc
                ),
                env=EnvParams(interval=self.interval),
                tunnel=TunnelInfo(
                    tunnel_path=tunnel_path,
                    tunnel_width=tunnel_width or 0.1,
                    top_wall=None,
                    bottom_wall=None
                ),
                planner_weights=self.planner_weights,
                planner_margin=self.planner_margin,
                reference_path=reference_path,
                current_acc=(0.0, 0.0),
                corridor_bounds=corridor_bounds,
                cartesian_constraints=cartesian_regions if cartesian_regions else None,
                clearance_profile=clearance_profile,
                curvature_rate_profile=curvature_rate_profile,
                curvature_profile=curvature_profile,
                speed_model=self.speed_model,
            )
            
            # Generate plan
            cursor_info, plan_debug = model(model_input)
            c_pos_dx, c_pos_dy, c_vel_x, c_vel_y = cursor_info
            
            # Apply noise consistently with steering_simulator
            # Use planned velocity at index 1 (first step after current) for noise application
            # c_vel_x has length pred_horizon+1: [v0, v1, v2, ..., vN]
            planned_vel_idx = min(1, len(c_vel_x) - 1)
            
            if self.add_noise:
                c_pos_dx_step, c_pos_dy_step, c_vel_x_step, c_vel_y_step, \
                hand_pos[0], hand_pos[1], _, _ = single_step_motor_and_device_noise(
                    c_vel_x[planned_vel_idx], c_vel_y[planned_vel_idx],
                    hand_pos[0], hand_pos[1],
                    self.nc,
                    self.interval,
                    self.forearm
                )
            else:
                # Use planned values when noise is disabled
                c_pos_dx_step = c_pos_dx[0]
                c_pos_dy_step = c_pos_dy[0]
                c_vel_x_step = c_vel_x[planned_vel_idx]
                c_vel_y_step = c_vel_y[planned_vel_idx]
                # No hand position update when noise is disabled
            
            # Update position
            cursor_pos[0] += c_pos_dx_step
            cursor_pos[1] += c_pos_dy_step
            cursor_vel[0] = c_vel_x_step
            cursor_vel[1] = c_vel_y_step
            
            # Convert back to screen coordinates
            screen_x = cursor_pos[0] / screen_width_m * screen_width
            screen_y = cursor_pos[1] / screen_height_m * screen_height
            
            # Add to trajectory
            if return_timestamps:
                trajectory.append((screen_x, screen_y, current_time))
            else:
                trajectory.append((screen_x, screen_y, self.interval))
            
            current_time += self.interval
        
        if return_reference_path:
            return trajectory, reference_path
        return trajectory
