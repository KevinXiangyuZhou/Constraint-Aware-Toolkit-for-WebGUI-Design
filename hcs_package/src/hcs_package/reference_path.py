"""
Reference path construction and optimization.

Provides ReferencePath class for smooth path representation using cubic splines,
and functions for generating optimal reference paths within tunnels.
"""

import numpy as np
from scipy.interpolate import splprep, splev
from scipy.ndimage import gaussian_filter1d
from .adapt import compute_local_curvature_integral, compute_qp_bounds, compute_clearance_profile


class ReferencePath:
    """Smooth reference path constructed from tunnel centerline using cubic splines."""
    def __init__(self, waypoints, s=0.0, k=3):
        """
        Args:
            waypoints: List of (x, y) points defining the centerline
            s: Smoothing factor (0 = interpolation, >0 = smoothing)
            k: Spline degree (3 = cubic)
        """
        # Validate and prepare waypoints
        waypoints = self._validate_and_prepare_waypoints(waypoints)
        
        # Parameterize by cumulative chord length
        self.waypoints = waypoints
        max_k = min(k, waypoints.shape[0] - 1)
        if max_k < 1:
            max_k = 1
        
        try:
            self.tck, self.u = splprep([waypoints[:, 0], waypoints[:, 1]], s=s, k=max_k)
        except ValueError as e:
            # If splprep fails, try with linear spline (k=1)
            if max_k > 1:
                try:
                    self.tck, self.u = splprep([waypoints[:, 0], waypoints[:, 1]], s=s, k=1)
                except ValueError:
                    raise ValueError(f"splprep failed with waypoints shape {waypoints.shape}: {e}")
            else:
                raise ValueError(f"splprep failed with waypoints shape {waypoints.shape}: {e}")
        
        # Compute approximate arclength mapping
        u_dense = np.linspace(0, 1, 1000)
        xy_dense = np.array(splev(u_dense, self.tck))
        diffs = np.diff(xy_dense, axis=1)
        ds = np.sqrt(np.sum(diffs**2, axis=0))
        self.arclengths = np.concatenate([[0], np.cumsum(ds)])
        self.u_dense = u_dense
        self.total_length = self.arclengths[-1]
    
    def __call__(self, theta):
        """Evaluate position at arclength theta."""
        u = self._theta_to_u(theta)
        xy = splev(u, self.tck)
        return np.array(xy, dtype=float)
    
    def _validate_and_prepare_waypoints(self, waypoints):
        """
        Validate and prepare waypoints for spline fitting.
        
        Args:
            waypoints: Array of (x, y) points
        
        Returns:
            Cleaned and validated waypoints array
        """
        waypoints = np.asarray(waypoints, dtype=float)
        
        # Remove any NaN or inf values
        valid_mask = np.isfinite(waypoints).all(axis=1)
        if not valid_mask.all():
            waypoints = waypoints[valid_mask]
            if len(waypoints) == 0:
                raise ValueError("All waypoints are invalid (NaN or inf)")
        
        # Remove duplicate consecutive points
        if len(waypoints) > 1:
            diffs = np.diff(waypoints, axis=0)
            dists = np.linalg.norm(diffs, axis=1)
            # Keep first point and points that are not duplicates
            keep_mask = np.concatenate([[True], dists > 1e-10])
            waypoints = waypoints[keep_mask]
        
        # Ensure we have at least 2 points
        if waypoints.shape[0] < 2:
            raise ValueError(f"Need at least 2 distinct waypoints, got {waypoints.shape[0]}")
        
        # If we have exactly 2 points, add a middle point to make it 3
        if waypoints.shape[0] == 2:
            mid_point = (waypoints[0] + waypoints[1]) / 2.0
            waypoints = np.vstack([waypoints[0:1], mid_point.reshape(1, -1), waypoints[1:2]])
        
        # If we have 3 points, add one more to make it 4 for cubic spline
        if waypoints.shape[0] == 3:
            # Add a point slightly offset from the middle to avoid collinearity
            mid_point = waypoints[1]
            # Create a small perpendicular offset
            dir_vec = waypoints[2] - waypoints[0]
            perp = np.array([-dir_vec[1], dir_vec[0]])
            perp = perp / (np.linalg.norm(perp) + 1e-10)
            offset_point = mid_point + perp * 1e-6
            waypoints = np.vstack([waypoints[0:1], waypoints[1:2], offset_point.reshape(1, -1), waypoints[2:3]])
        
        # Check for collinearity - if all points are collinear, add a small perpendicular offset
        if waypoints.shape[0] >= 3:
            # Check if points are collinear
            vec1 = waypoints[1] - waypoints[0]
            vec2 = waypoints[-1] - waypoints[0]
            cross = vec1[0] * vec2[1] - vec1[1] * vec2[0]
            if abs(cross) < 1e-10:
                # Points are collinear, add a small perpendicular offset to middle point
                mid_idx = len(waypoints) // 2
                dir_vec = waypoints[-1] - waypoints[0]
                perp = np.array([-dir_vec[1], dir_vec[0]])
                perp = perp / (np.linalg.norm(perp) + 1e-10)
                waypoints[mid_idx] = waypoints[mid_idx] + perp * 1e-6
        
        return waypoints
    
    def tangent(self, theta):
        """Return unit tangent vector at arclength theta."""
        u = self._theta_to_u(theta)
        dxy = splev(u, self.tck, der=1)
        t = np.array([dxy[0], dxy[1]], dtype=float)
        norm = np.linalg.norm(t)
        if norm < 1e-9:
            return np.array([1.0, 0.0])
        return t / norm
    
    def normal(self, theta):
        """Return right-pointing unit normal vector at arclength theta."""
        t = self.tangent(theta)
        return np.array([t[1], -t[0]], dtype=float)
    
    def curvature(self, theta):
        """Compute curvature κ at arclength theta."""
        u = self._theta_to_u(theta)
        k = self.tck[2] if hasattr(self.tck, '__len__') else 3
        if k < 2:
            return 0.0  # linear spline has zero curvature
        dxy = splev(u, self.tck, der=1)
        ddxy = splev(u, self.tck, der=2)
        dx, dy = dxy[0], dxy[1]
        ddx, ddy = ddxy[0], ddxy[1]
        num = dx * ddy - dy * ddx
        den = (dx**2 + dy**2)**1.5
        if den < 1e-12:
            return 0.0
        return num / den
    
    def find_closest_theta(self, pos, initial_guess=None, min_theta=None):
        """Find arclength θ of closest point on path to given position.
        
        Uses a two-stage approach:
        1. Coarse search through sampled points to find initial guess
        2. Fine optimization using scipy.optimize.minimize_scalar
        
        Args:
            pos: Target position (x, y)
            initial_guess: Optional initial guess for theta (for faster convergence)
            min_theta: Optional minimum theta value (to enforce forward progress)
        
        Returns:
            Arclength theta of closest point on path
        """
        pos = np.asarray(pos, dtype=float)
        px, py = float(pos[0]), float(pos[1])

        # --- 1) Get initial guess in spline parameter u ∈ [0, 1] ---

        if initial_guess is not None:
            # initial_guess is in arclength θ, clip and map to u
            theta0 = float(np.clip(initial_guess, 0.0, self.total_length))
            u0 = float(np.interp(theta0, self.arclengths, self.u_dense))
        else:
            # Coarse search over pre-sampled path (vectorized, cheap)
            xy = np.array(splev(self.u_dense, self.tck))
            dx = xy[0] - px
            dy = xy[1] - py
            dist2 = dx * dx + dy * dy
            idx = int(np.argmin(dist2))
            u0 = float(self.u_dense[idx])
        
        # If min_theta is specified, ensure we only search forward
        min_u = 0.0
        if min_theta is not None:
            min_theta_val = float(min_theta)
            min_u = float(np.interp(min_theta_val, self.arclengths, self.u_dense))
            # Clip u0 to be at least min_u
            u0 = max(u0, min_u)

        # --- 2) Refine with a few Newton steps on f(u) = ||c(u) - pos||^2 ---
        #     Skip for linear splines (k=1) since der=2 is undefined.

        spline_k = self.tck[2] if hasattr(self.tck, '__len__') else 3
        if spline_k < 2:
            theta = float(np.interp(u0, self.u_dense, self.arclengths))
            return theta

        max_iter = 5
        tol = 1e-6

        for _ in range(max_iter):
            # Position c(u), first and second derivatives
            c = splev(u0, self.tck, der=0)
            c1 = splev(u0, self.tck, der=1)
            c2 = splev(u0, self.tck, der=2)

            rx = c[0] - px
            ry = c[1] - py
            c1x, c1y = c1[0], c1[1]
            c2x, c2y = c2[0], c2[1]

            # f(u) = (c(u) - pos)·(c(u) - pos)
            # f'(u) = 2 (c - pos)·c'
            # f''(u) = 2 (|c'|^2 + (c - pos)·c'')
            f_prime = 2.0 * (rx * c1x + ry * c1y)
            f_second = 2.0 * ((c1x * c1x + c1y * c1y) + (rx * c2x + ry * c2y))

            if abs(f_second) < 1e-12:
                break  # avoid division by zero / ill-conditioned

            du = -f_prime / f_second
            if abs(du) < tol:
                break

            u_new = u0 + du
            # Keep u in valid range (enforce min_u if min_theta was specified)
            u_new = float(np.clip(u_new, min_u, 1.0))

            if abs(u_new - u0) < tol:
                u0 = u_new
                break

            u0 = u_new

        # --- 3) Map refined u back to arclength θ ---

        theta = float(np.interp(u0, self.u_dense, self.arclengths))
        return theta
    
    def _theta_to_u(self, theta):
        """Convert arclength θ to spline parameter u ∈ [0, 1]."""
        theta = np.clip(theta, 0.0, self.total_length)
        u = np.interp(theta, self.arclengths, self.u_dense)
        if np.ndim(theta) == 0:
            return float(u)
        return u


def _has_loop(path_points: np.ndarray, tol: float = 1e-6) -> bool:
    """
    Check if a path has self-intersections (loops).
    
    Args:
        path_points: Array of shape (N, 2) representing path points
        tol: Tolerance for intersection detection
    
    Returns:
        True if path has loops, False otherwise
    """
    if len(path_points) < 4:
        return False
    
    for i in range(len(path_points) - 1):
        p0 = path_points[i]
        p1 = path_points[i + 1]
        
        # Check if this segment intersects with any future segment (not adjacent)
        for j in range(i + 2, len(path_points) - 1):
            p2 = path_points[j]
            p3 = path_points[j + 1]
            
            # Line segment intersection check
            denom = (p1[0] - p0[0]) * (p3[1] - p2[1]) - (p1[1] - p0[1]) * (p3[0] - p2[0])
            
            if abs(denom) > tol:
                t = ((p2[0] - p0[0]) * (p3[1] - p2[1]) - (p2[1] - p0[1]) * (p3[0] - p2[0])) / denom
                u = ((p2[0] - p0[0]) * (p1[1] - p0[1]) - (p2[1] - p0[1]) * (p1[0] - p0[0])) / denom
                
                # If segments intersect at interior points, this is a loop
                if tol < t < 1.0 - tol and tol < u < 1.0 - tol:
                    return True
    
    return False


def _remove_loops_from_path(path_points: np.ndarray, tol: float = 1e-6) -> np.ndarray:
    """
    Remove loops from a path by detecting self-intersections and removing looped segments.
    
    Uses a greedy approach: when a loop is detected, skip the segment that causes the loop.
    
    Args:
        path_points: Array of shape (N, 2) representing path points
        tol: Tolerance for intersection detection
    
    Returns:
        Cleaned path points with loops removed
    """
    if len(path_points) < 4:
        return path_points
    
    # First check if there are any loops
    if not _has_loop(path_points, tol):
        return path_points
    
    # Use a more aggressive approach: remove points that cause intersections
    cleaned_indices = [0]  # Always keep first point
    i = 1
    
    while i < len(path_points):
        # Try adding this point
        test_indices = cleaned_indices + [i]
        test_path = path_points[test_indices]
        
        # Check if adding this point creates a loop
        has_intersection = False
        if len(test_indices) >= 4:
            # Check if the last segment intersects with any previous segment
            last_seg_start = test_indices[-2]
            last_seg_end = test_indices[-1]
            p2 = path_points[last_seg_start]
            p3 = path_points[last_seg_end]
            
            for j in range(len(test_indices) - 3):
                p0 = path_points[test_indices[j]]
                p1 = path_points[test_indices[j + 1]]
                
                denom = (p1[0] - p0[0]) * (p3[1] - p2[1]) - (p1[1] - p0[1]) * (p3[0] - p2[0])
                
                if abs(denom) > tol:
                    t = ((p2[0] - p0[0]) * (p3[1] - p2[1]) - (p2[1] - p0[1]) * (p3[0] - p2[0])) / denom
                    u = ((p2[0] - p0[0]) * (p1[1] - p0[1]) - (p2[1] - p0[1]) * (p1[0] - p0[0])) / denom
                    
                    if tol < t < 1.0 - tol and tol < u < 1.0 - tol:
                        has_intersection = True
                        break
        
        if not has_intersection:
            cleaned_indices.append(i)
        
        i += 1
    
    # Always ensure we end with the final point
    if cleaned_indices[-1] != len(path_points) - 1:
        cleaned_indices.append(len(path_points) - 1)
    
    cleaned_path = path_points[cleaned_indices]
    
    # Verify no loops remain
    if _has_loop(cleaned_path, tol):
        # If still has loops, use a more aggressive approach: keep only every Nth point
        # This is a fallback
        step = max(2, len(path_points) // 20)
        cleaned_path = path_points[::step]
        if len(cleaned_path) > 0 and not np.array_equal(cleaned_path[-1], path_points[-1]):
            cleaned_path = np.vstack([cleaned_path, path_points[-1:]])
    
    return cleaned_path


def _smooth_offsets(
    d: np.ndarray,
    s: np.ndarray,
    lb: np.ndarray,
    ub: np.ndarray,
    sigma_frac: float = 0.015,
) -> np.ndarray:
    """Gaussian-smooth the lateral-offset profile and clip to bounds.

    The kernel must be narrow relative to each turn's arc length so that
    offsets within a single turn are preserved.  A wide kernel spans multiple
    turns of opposite sign and cancels the offsets to near-zero.
    sigma_frac = 0.015 means sigma ≈ 1.5% of total arc length, which blends
    only the transition zone at inflection points (kappa sign changes).

    Args:
        d:           Raw offset profile (N,).
        s:           Arc-length samples (N,).
        lb, ub:      Per-knot lower/upper bounds.
        sigma_frac:  Smoothing kernel half-width as fraction of total arc length.
                     Keep well below (half-wavelength / arc-length) to avoid
                     inter-turn cancellation.

    Returns:
        Smoothed offsets clipped to [lb, ub].
    """
    L = s[-1] - s[0]
    sigma = max(sigma_frac * L, 1e-9)
    n = len(d)
    d_smooth = np.empty(n)
    for i in range(n):
        w = np.exp(-0.5 * ((s - s[i]) / sigma) ** 2)
        w /= w.sum()
        d_smooth[i] = w @ d
    return np.clip(d_smooth, lb, ub)


def generate_optimal_reference_path(
    tunnel_path,
    tunnel_width,
    margin=0.001,
    num_knots=None,
    w_cut=0.01,          # base corner-cutting aggressiveness (0 = stay on centerline)
    w_suppress=0.0,      # suppression sensitivity: exp(-w_suppress * phi_k)
                         # 0 = always cut; larger = suppress in dense/sharp regions
    w_width_exp=1.0,     # width sensitivity exponent (0 = ignore width, 1 = linear)
    cut_window_frac=0.05,  # window for phi_k as fraction of path length (scale-invariant)
    global_clearance_ref=0.025,  # reference clearance for absolute task scaling (2.5cm default)
    cartesian_constraints=None,  # List[ConstraintRegion] for constraint-aware bounds
    corridor_bounds=None,  # Optional (left_bound, right_bound) for path-relative constraints
    centerline_cache=None,  # Optional pre-built ReferencePath to avoid redundant spline creation
):
    """
    Generate a race-tracing reference path inside the tunnel.

    Path model (right-normal Frenet frame):
        p(s) = C(s) + d(s) * n_R(s),   n_R(s) = [t_y, -t_x]

    n_R points to the RIGHT of travel.  Signed curvature convention:
        kappa > 0  →  left turn  →  inside is -n_R  →  d < 0 (toward lb)
        kappa < 0  →  right turn →  inside is +n_R  →  d > 0 (toward ub)

    Corner-cutting follows the research insight that width ENABLES cutting while
    curvature MOTIVATES it.  The desired offset at each knot is:

        width_factor_k = (clearance_k / clearance_ref) ^ w_width_exp
        kappa_factor_k = |kappa_k| / max(|kappa|)
        cut_fraction_k = w_cut * width_factor_k * kappa_factor_k * exp(-w_suppress * phi_k)
        d_k = cut_fraction_k * lb_k   if kappa_k >= 0   (left turn, cut left)
            = cut_fraction_k * ub_k   if kappa_k <  0   (right turn, cut right)

    This means:
        - Narrow sections suppress cutting regardless of curvature (width_factor low)
        - Straight sections don't cut regardless of width (kappa_factor low)
        - Wide + curved sections allow maximum cutting (both factors high)

    phi_k is the total turning angle integral |kappa| ds over a local window,
    capturing both local sharpness and turn density in one signal.

    A final cubic spline provides C2 continuity.

    Args:
        tunnel_path:           List[(x,y)] centerline samples (entry->exit).
        tunnel_width:          Scalar corridor width (fallback when no constraints).
        margin:                Safety margin to walls.
        num_knots:             Discretization along arc length (auto if None).
        w_cut:                 Cutting fraction in [0, 1].  0 = centerline,
                               1 = cut fully to the inside wall.
        w_suppress:            Suppression sensitivity.  0 = always cut at
                               full w_cut fraction; larger values reduce cutting
                               where phi_k is high (dense/sharp turns).
        w_width_exp:           Width sensitivity exponent.  0 = ignore width
                               (old behavior), 1 = linear scaling with clearance,
                               >1 = only cut in very wide sections.
        cut_window_frac:       Window for phi_k as fraction of total path length.
                               Scale-invariant (e.g., 0.05 = 5% of path).
        cartesian_constraints: List[ConstraintRegion] for constraint-aware bounds.
                               Works with cascading menus and polygon keep-in regions.
        corridor_bounds:       Optional (left_bound, right_bound) tuple for
                               path-relative corridor constraints.

    Returns:
        ReferencePath for the optimised path (cubic spline through waypoints).
    """
    waypoints = np.asarray(tunnel_path, dtype=float)
    centerline = centerline_cache if centerline_cache is not None else ReferencePath(waypoints, s=0.0, k=3)
    L = centerline.total_length

    # Discretize along arclength
    if num_knots is None:
        num_knots = max(40, min(300, 2 * len(waypoints)))
    s_knots = np.linspace(0.0, L, num_knots)

    # Evaluate C(s), t(s), n_R(s), κ(s)
    C       = np.stack([centerline(theta) for theta in s_knots], axis=0)         # (N,2)
    T       = np.stack([centerline.tangent(theta) for theta in s_knots], axis=0) # (N,2)
    N_right = np.stack([[t[1], -t[0]] for t in T], axis=0)                       # (N,2)
    kappa   = np.array([centerline.curvature(theta) for theta in s_knots])       # (N,)
    ds      = np.diff(s_knots, prepend=s_knots[0])
    ds[0]   = ds[1] if len(ds) > 1 else 0.0

    # Corridor bounds — symmetric half-width fallback
    half_w = np.full(num_knots, 0.5 * float(tunnel_width) - float(margin))
    half_w = np.maximum(half_w, 1e-6)

    N = num_knots

    # Constraint-aware per-knot bounds
    lb, ub = compute_qp_bounds(
        centerline, s_knots, C, N_right, half_w,
        cartesian_constraints=cartesian_constraints,
        margin=float(margin),
    )

    # Pin endpoints on the centerline
    lb[0] = ub[0] = 0.0
    lb[-1] = ub[-1] = 0.0

    # Compute clearance profile — works for tunnels, cascading menus, or mixed.
    # Clearance is the distance from centerline to nearest constraint boundary.
    clearance = compute_clearance_profile(
        centerline, s_knots,
        corridor_bounds=corridor_bounds,
        cartesian_constraints=cartesian_constraints,
    )

    # If no constraints provided, fall back to the computed lateral bounds.
    # Use minimum of |lb| and |ub| as local half-width clearance.
    if np.isinf(clearance).all() or (clearance == clearance[0]).all():
        clearance = np.minimum(np.abs(lb), np.abs(ub))
        clearance = np.maximum(clearance, 1e-6)

    # Width factor has TWO components for proper task differentiation:
    #
    # 1. ABSOLUTE (task-level): wider TASKS allow more cutting overall
    #    - Uses global_clearance_ref as the reference for "typical wide tunnel"
    #    - task_scale = tanh(task_clearance / global_ref) ∈ [0, 1]
    #    - Narrow tasks (e.g., 1cm) get task_scale ≈ 0.4
    #    - Wide tasks (e.g., 5cm) get task_scale ≈ 1.0
    #
    # 2. RELATIVE (within-task): wider SPOTS within a task allow more cutting
    #    - Normalized to the task's own clearance distribution
    #    - Creates spatial gradient of cutting within the task
    #
    # Task-level reference: typical clearance in this specific task
    task_clearance_ref = np.percentile(clearance, 90)
    if task_clearance_ref < 1e-6:
        task_clearance_ref = np.max(clearance)
    
    # ABSOLUTE component: wider tasks allow more cutting overall (saturating)
    task_scale = np.tanh(task_clearance_ref / global_clearance_ref) if task_clearance_ref > 1e-6 else 0.0
    
    # RELATIVE component: spatial gradient within the task
    local_norm = np.clip(clearance / task_clearance_ref, 0.0, 2.0) if task_clearance_ref > 1e-6 else np.ones(N)
    local_factor = local_norm ** w_width_exp
    
    # Combined: absolute scales overall, relative creates spatial gradient
    # Width ENABLES cutting — narrow tasks AND narrow spots suppress cutting.
    width_factor = task_scale * local_factor

    # Compute phi_k: total turning angle in window around each knot.
    # Window is now a fraction of path length (scale-invariant).
    cut_window = max(cut_window_frac * L, 1e-6)
    phi = compute_local_curvature_integral(centerline, s_knots, window=cut_window)

    # Smooth kappa before computing the cutting weight.
    # For sharp-corner paths, the cubic spline creates extreme narrow curvature
    # spikes at waypoint corners.  Smoothing spreads the corner signal over
    # ~sigma_knots knots, giving a smooth bell-shaped transition.
    sigma_knots = max(5.0, 0.03 * N)
    kappa_smoothed = gaussian_filter1d(kappa.astype(float), sigma=sigma_knots)

    # Curvature MOTIVATES cutting — sharper curves trigger more cutting desire.
    kappa_sm_abs = np.abs(kappa_smoothed)
    kappa_sm_max = float(np.max(kappa_sm_abs))
    kappa_factor = (kappa_sm_abs / kappa_sm_max) if kappa_sm_max > 1e-6 else np.zeros_like(kappa)

    # Per-knot cutting fraction combines width (enabling) and curvature (motivating).
    # This implements the research insight: "Width is the enabling factor;
    # curvature is the motivating factor."
    #   - Narrow task → task_scale low → overall less cutting
    #   - Narrow spot within task → local_factor low → locally less cutting
    #   - Wide + straight → kappa_factor low → no cutting (no motivation)
    #   - Wide + curved → all factors high → maximum cutting
    cut_fraction = np.clip(w_cut, 0.0, 1.0) * width_factor * kappa_factor * np.exp(-w_suppress * phi)

    # Race-tracing direction: cut to the INSIDE of each turn.
    # kappa_smoothed > 0 → left turn  → inside is LEFT (-N_right) → d targets lb
    # kappa_smoothed < 0 → right turn → inside is RIGHT (+N_right) → d targets ub
    # When kappa_smoothed ≈ 0 (straights), cut_fraction ≈ 0 → d ≈ 0 (centerline).
    d_desired = np.where(
        kappa_smoothed >= 0,
        cut_fraction * lb,    # left turn: cut toward left (inside)
        cut_fraction * ub,    # right turn: cut toward right (inside)
    )
    d_opt = np.clip(d_desired, lb, ub)

    # Re-pin endpoints: kappa_smoothed may be non-zero near endpoints due to
    # boundary effects of gaussian_filter1d, so explicitly zero them.
    d_opt[0] = 0.0
    d_opt[-1] = 0.0

    # Reconstruct the 2D path
    P = C + d_opt[:, None] * N_right
    P = np.asarray(P)

    # Remove any self-intersections introduced by aggressive cutting
    P = _remove_loops_from_path(P)

    # Cubic spline through optimised waypoints provides smoothness
    return ReferencePath(P, s=0.0, k=3)
