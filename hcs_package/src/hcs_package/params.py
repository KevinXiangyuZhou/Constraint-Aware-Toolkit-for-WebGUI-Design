"""Typed parameter structures for steering models."""

from dataclasses import dataclass, field
from typing import Any, List, Optional, Sequence, Tuple


@dataclass
class BumpParams:
    """Parameters for the intermittent BUMP planning model."""
    pred_horizon: int
    Tp: int
    nc: Sequence[float]


@dataclass
class EnvParams:
    """Environment and device parameters."""
    interval: float


@dataclass
class TunnelInfo:
    """Centerline path and width of the tunnel environment."""
    tunnel_path: List[Tuple[float, float]]
    tunnel_width: float
    top_wall: Optional[List[Tuple[float, float]]] = None  # Top wall boundary path
    bottom_wall: Optional[List[Tuple[float, float]]] = None  # Bottom wall boundary path


@dataclass
class HOCLParams:
    """Open-loop correction pulse parameters (HOCL)."""
    mL: float
    mR: float
    Krb: float
    Trb: float


@dataclass
class SteeringModelInput:
    """Structured input for steering models.

    - state_cog: (cursor_x, cursor_y, cursor_vx, cursor_vy) - cursor position and velocity
    - bump: Bump planning parameters
    - env: Environment parameters
    - tunnel: Tunnel geometry
    """
    state_cog: Tuple[float, float, float, float]
    bump: BumpParams
    env: EnvParams
    tunnel: TunnelInfo
    # Optional MPC planning knobs
    planner_weights: Optional[dict] = None  # e.g., {"contour":100.0, "progress":10.0, "control":1.0, "jerk":10.0}
    planner_margin: Optional[float] = None  # safety margin from walls
    reference_path: Optional[object] = None  # ReferencePath object for MPC
    current_acc: Optional[Tuple[float, float]] = None # Current acceleration (ax, ay)
    corridor_bounds: Optional[Tuple] = None  # (left_bound, right_bound) for path-relative corridor constraints
    cartesian_constraints: Optional[List[Any]] = None  # List[ConstraintRegion] for world-space polygon/rectangle constraints
    clearance_profile: Optional[Tuple] = None  # (s_array, clearance_array) for steering-law speed scaling
    curvature_rate_profile: Optional[Tuple] = None  # (s_array, rate_array) for stop-and-go speed modulation
    curvature_profile: Optional[Tuple] = None  # (s_array, kappa_array) for curvature-responsive speed scaling
    speed_model: Optional[Any] = None  # SpeedModel instance (overrides parametric default)
