"""
Utility functions for parsing constraints from JSON.

PathConstraints are converted to path-relative corridor_bounds for the MPC.
PolygonConstraints / RectangleConstraints are kept as Cartesian constraints.
"""

import numpy as np
from typing import List, Tuple, Optional, Dict, Any, Callable
from .constraints import (
    ConstraintConfig, ConstraintRegion, ConstraintType,
    PathConstraint, PolygonConstraint, RectangleConstraint
)


def parse_constraints_from_json(constraints_dict: Dict[str, Any]) -> Optional[ConstraintConfig]:
    """
    Parse constraints from a JSON dictionary.
    
    Args:
        constraints_dict: Dictionary containing constraint configuration
        
    Returns:
        ConstraintConfig object or None if no constraints
    """
    if not constraints_dict:
        return None
    
    regions = []
    
    # Handle simple boundary constraints
    if "left_boundary" in constraints_dict and "right_boundary" in constraints_dict:
        left_boundary = constraints_dict["left_boundary"]
        right_boundary = constraints_dict["right_boundary"]
        
        # Create path constraints for boundaries
        if left_boundary:
            regions.append(ConstraintRegion(
                constraint_type=ConstraintType.KEEP_IN,
                geometry=PathConstraint(
                    path=[tuple(p) for p in left_boundary],
                    width=None
                )
            ))
        
        if right_boundary:
            regions.append(ConstraintRegion(
                constraint_type=ConstraintType.KEEP_IN,
                geometry=PathConstraint(
                    path=[tuple(p) for p in right_boundary],
                    width=None
                )
            ))
    
    # Handle region-based constraints
    if "regions" in constraints_dict:
        for region_dict in constraints_dict["regions"]:
            if not region_dict.get("enabled", True):
                continue
            
            constraint_type_str = region_dict.get("constraint_type", "keep_out")
            constraint_type = ConstraintType.KEEP_OUT if constraint_type_str == "keep_out" else ConstraintType.KEEP_IN
            
            geometry_dict = region_dict.get("geometry", {})
            geometry_type = geometry_dict.get("type", "")
            
            geometry = None
            if geometry_type == "rectangle":
                geometry = RectangleConstraint(
                    x=geometry_dict["x"],
                    y=geometry_dict["y"],
                    width=geometry_dict["width"],
                    height=geometry_dict["height"]
                )
            elif geometry_type == "polygon":
                geometry = PolygonConstraint(
                    vertices=[tuple(v) for v in geometry_dict["vertices"]]
                )
            elif geometry_type == "line" or geometry_type == "path":
                path_points = geometry_dict.get("path", [])
                if not path_points and "start" in geometry_dict and "end" in geometry_dict:
                    path_points = [geometry_dict["start"], geometry_dict["end"]]
                geometry = PathConstraint(
                    path=[tuple(p) for p in path_points],
                    width=geometry_dict.get("width")
                )
            
            if geometry is not None:
                region = ConstraintRegion(
                    constraint_type=constraint_type,
                    geometry=geometry
                )
                # Store margin in the region if provided
                if "margin" in region_dict:
                    region.margin = region_dict["margin"]
                regions.append(region)
    
    if not regions:
        return None
    
    config = ConstraintConfig(regions=regions)
    config.coordinate_system = constraints_dict.get("coordinate_system", "normalized")
    config.default_margin = constraints_dict.get("default_margin", 0.0)
    
    return config


def convert_constraints_to_corridor_bounds(
    constraints: Optional[ConstraintConfig],
    reference_path,
    default_margin: float = 0.0,
    screen_width: Optional[float] = None,
    screen_height: Optional[float] = None
) -> Optional[Tuple[Callable, Callable]]:
    """Convert PathConstraint regions to path-relative corridor bounds.

    The returned functions ``left_bound(s)`` and ``right_bound(s)`` give the
    maximum allowed lateral deviation from the reference path at arc-length
    *s*.  Only :class:`PathConstraint` regions with a ``width`` attribute are
    considered; Rectangle / Polygon regions are ignored (they are enforced
    separately as Cartesian constraints).

    Returns:
        ``(left_bound_func, right_bound_func)`` or *None* when no
        PathConstraint regions with a width are found.
    """
    if constraints is None:
        return None

    margin = getattr(constraints, 'default_margin', default_margin)

    # Collect the tightest half-width across all PathConstraint regions
    half_widths: List[float] = []
    for region in constraints.regions:
        geom = region.geometry
        if isinstance(geom, PathConstraint) and geom.width is not None:
            region_margin = getattr(region, 'margin', None)
            if region_margin is None:
                region_margin = margin
            half_widths.append(max(0.0, geom.width / 2.0 - region_margin))

    if not half_widths:
        return None

    # Use the tightest (smallest) half-width
    bound_value = min(half_widths)

    num_samples = max(50, int(reference_path.total_length / 0.01))
    s_samples = np.linspace(0, reference_path.total_length, num_samples)

    left_bounds = np.full(num_samples, bound_value)
    right_bounds = np.full(num_samples, bound_value)

    # Clamp to reasonable values
    max_bound = 0.1
    left_bounds = np.clip(left_bounds, 0.0, max_bound)
    right_bounds = np.clip(right_bounds, 0.0, max_bound)

    def left_bound_func(s):
        idx = np.clip(int(s / reference_path.total_length * (num_samples - 1)),
                       0, num_samples - 1)
        return float(left_bounds[idx])

    def right_bound_func(s):
        idx = np.clip(int(s / reference_path.total_length * (num_samples - 1)),
                       0, num_samples - 1)
        return float(right_bounds[idx])

    return (left_bound_func, right_bound_func)


def _point_in_polygon(point: np.ndarray, vertices: np.ndarray) -> bool:
    """Ray-casting point-in-polygon test."""
    n = len(vertices)
    inside = False
    px, py = float(point[0]), float(point[1])
    j = n - 1
    for i in range(n):
        xi, yi = float(vertices[i][0]), float(vertices[i][1])
        xj, yj = float(vertices[j][0]), float(vertices[j][1])
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _distance_to_polygon_boundary(point: np.ndarray, vertices: np.ndarray) -> float:
    """Minimum distance from a point to any edge of the polygon."""
    min_dist = float('inf')
    n = len(vertices)
    for i in range(n):
        j = (i + 1) % n
        a = vertices[i]
        b = vertices[j]
        ab = b - a
        ab_sq = np.dot(ab, ab)
        if ab_sq < 1e-15:
            dist = np.linalg.norm(point - a)
        else:
            t = np.clip(np.dot(point - a, ab) / ab_sq, 0.0, 1.0)
            closest = a + t * ab
            dist = np.linalg.norm(point - closest)
        min_dist = min(min_dist, dist)
    return min_dist
