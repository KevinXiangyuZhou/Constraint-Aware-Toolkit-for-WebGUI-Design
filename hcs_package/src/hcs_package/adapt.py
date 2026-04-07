"""
Adaptive precomputation utilities for MPCC and reference-path generation.

Both functions are pure: they take path/constraint objects and return numpy
arrays.  No state is mutated and neither function imports from model.py.
"""

import numpy as np
from typing import Optional, Tuple, List

from .constraints import ConstraintType, RectangleConstraint, PolygonConstraint
from .constraint_utils import _point_in_polygon, _distance_to_polygon_boundary


def compute_local_curvature_integral(
    ref_path,
    s_samples: np.ndarray,
    window: float = 0.1,
) -> np.ndarray:
    """
    Compute phi_k = integral of |kappa(s)| ds over a window around each sample.

    phi_k is the total turning angle (radians) accumulated within
    [s_k - window/2, s_k + window/2].  It grows with both local sharpness
    (a tight 90-degree corner contributes ~pi/2 radians) and turn density
    (three such corners contribute ~3*pi/2 radians), making it a single
    signal that unifies both context factors without peak detection or
    normalization.

    Args:
        ref_path:  ReferencePath object.
        s_samples: 1-D array of arc-length positions at which to evaluate.
        window:    Arc-length window width in the same units as s_samples.

    Returns:
        phi: 1-D array of total turning angles (radians), same length as s_samples.
    """
    s_samples = np.asarray(s_samples, dtype=float)
    kappa = np.array([abs(ref_path.curvature(float(s))) for s in s_samples])
    half_w = window / 2.0
    n = len(s_samples)
    phi = np.empty(n)
    for i in range(n):
        s_lo = s_samples[i] - half_w
        s_hi = s_samples[i] + half_w
        mask = (s_samples >= s_lo) & (s_samples <= s_hi)
        s_win = s_samples[mask]
        k_win = kappa[mask]
        if len(s_win) >= 2:
            phi[i] = float(np.trapz(k_win, s_win))
        elif len(s_win) == 1:
            # Single sample in window — estimate as kappa * window
            phi[i] = float(k_win[0] * min(window, s_samples[-1] - s_samples[0] + 1e-9))
        else:
            phi[i] = 0.0
    return phi


def compute_sharpness_profile(
    ref_path,
    s_samples: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute curvature and normalized curvature-rate (sharpness) along the path.

    Args:
        ref_path:  ReferencePath object.
        s_samples: 1-D array of arc-length positions at which to evaluate.

    Returns:
        sigma   : Normalized |∂κ/∂s| ∈ [0, 1].  Near 1 at sharp corners,
                  near 0 on straight or gently curved sections.
        kappa   : |κ(s)| at each sample.
        dkappa  : |∂κ/∂s| (un-normalized) at each sample.
    """
    s_samples = np.asarray(s_samples, dtype=float)
    kappa = np.array([abs(ref_path.curvature(float(s))) for s in s_samples])
    dkappa = np.abs(np.gradient(kappa, s_samples))
    sigma = dkappa / (np.max(dkappa) + 1e-9)
    return sigma, kappa, dkappa


def compute_curvature_rate_profile(
    ref_path,
    s_samples: np.ndarray,
    smooth_sigma: float = 4.0,
    trim_fraction: float = 0.05,
) -> np.ndarray:
    """
    Compute corner difficulty signal along the reference path.

    Uses a combined signal: κ(s) × |∂κ/∂s| (curvature × curvature rate).
    This fires strongly ONLY where curvature is both high AND changing fast,
    which is uniquely characteristic of corners.

    Args:
        ref_path:     ReferencePath object.
        s_samples:    1-D array of arc-length positions at which to evaluate.
        smooth_sigma: Gaussian smoothing sigma (in samples).
        trim_fraction: Fraction of samples to trim at boundaries.

    Returns:
        signal: 1-D array, same length as s_samples.
    """
    from scipy.ndimage import gaussian_filter1d

    s_samples = np.asarray(s_samples, dtype=float)
    n = len(s_samples)
    if n < 2:
        return np.zeros(n)

    kappa = np.array([abs(ref_path.curvature(float(s))) for s in s_samples])
    dkappa_ds = np.abs(np.gradient(kappa, s_samples))

    if smooth_sigma > 0:
        dkappa_ds = gaussian_filter1d(dkappa_ds, sigma=smooth_sigma)
        kappa_smooth = gaussian_filter1d(kappa, sigma=smooth_sigma)
    else:
        kappa_smooth = kappa

    signal = kappa_smooth * dkappa_ds

    # Trim boundary artifacts
    if trim_fraction > 0 and n > 10:
        trim_samples = max(1, int(n * trim_fraction))
        signal[:trim_samples] = signal[trim_samples]
        signal[-trim_samples:] = signal[-trim_samples - 1]

    return signal


def compute_curvature_spike_profile(
    ref_path,
    s_samples: np.ndarray,
    window_samples: int = 30,
    smooth_sigma: float = 2.0,
) -> np.ndarray:
    """
    Compute curvature rate SPIKE metric — how much the local rate exceeds
    the local baseline.

    This metric distinguishes CORNER tunnels (low baseline + sharp spikes)
    from SIGMOIDAL tunnels (continuously elevated rate, no spikes).

    spike[k] = max(0, rate[k] - local_median[k])

    For sigmoidal tunnels: rate ≈ local_median → spike ≈ 0 (no slowdown)
    For corner straights:  rate ≈ local_median (both low) → spike ≈ 0
    For corner AT turn:    rate >> local_median → spike > 0 → slowdown

    Args:
        ref_path:       ReferencePath object.
        s_samples:      1-D array of arc-length positions at which to evaluate.
        window_samples: Window size (in samples) for computing local baseline.
        smooth_sigma:   Gaussian smoothing sigma for the raw rate profile.

    Returns:
        spike: 1-D array of spike values, same length as s_samples.
               0 = no spike (rate ≈ local baseline), >0 = spike detected.
    """
    from scipy.ndimage import gaussian_filter1d, median_filter

    s_samples = np.asarray(s_samples, dtype=float)
    n = len(s_samples)
    if n < 2:
        return np.zeros(n)

    kappa = np.array([abs(ref_path.curvature(float(s))) for s in s_samples])
    rate = np.abs(np.gradient(kappa, s_samples))

    if smooth_sigma > 0:
        rate = gaussian_filter1d(rate, sigma=smooth_sigma)

    local_baseline = median_filter(rate, size=window_samples, mode='reflect')

    spike = np.maximum(0.0, rate - local_baseline)

    return spike


def _ray_to_polygon_boundary(origin: np.ndarray, direction: np.ndarray,
                              vertices: np.ndarray) -> float:
    """Distance from origin along direction to the nearest polygon edge.

    Returns inf if the ray doesn't hit any edge.
    """
    min_t = float('inf')
    n = len(vertices)
    dx, dy = float(direction[0]), float(direction[1])
    ox, oy = float(origin[0]), float(origin[1])

    for i in range(n):
        j = (i + 1) % n
        ex, ey = float(vertices[i][0]), float(vertices[i][1])
        fx, fy = float(vertices[j][0]), float(vertices[j][1])

        # Edge vector
        sx, sy = fx - ex, fy - ey
        denom = dx * sy - dy * sx
        if abs(denom) < 1e-12:
            continue  # parallel

        t = ((ex - ox) * sy - (ey - oy) * sx) / denom  # ray parameter
        u = ((ex - ox) * dy - (ey - oy) * dx) / denom  # edge parameter

        if t > 1e-9 and 0.0 <= u <= 1.0:
            min_t = min(min_t, t)

    return min_t


def compute_clearance_profile(
    ref_path,
    s_samples: np.ndarray,
    corridor_bounds=None,
    cartesian_constraints: Optional[List] = None,
) -> np.ndarray:
    """
    Compute local clearance — the minimum distance from the reference path to
    the nearest active constraint boundary — at each arc-length sample.

    Clearance is the geometry-agnostic generalisation of tunnel width:
    * PathConstraint  (via corridor_bounds): w_left(s) + w_right(s)
    * PolygonConstraint KEEP_IN:             distance to polygon boundary
    * RectangleConstraint KEEP_IN:           distance to nearest rect edge

    Unconstrained sample points (no active constraint nearby) are assigned the
    maximum finite clearance so they do not artificially cap speed.

    Args:
        ref_path:              ReferencePath object.
        s_samples:             1-D arc-length array.
        corridor_bounds:       Tuple (left_bound, right_bound) — each a float
                               or callable f(s) -> float.  May be None.
        cartesian_constraints: List of ConstraintRegion objects.  May be None.

    Returns:
        clearance: 1-D array, same length as s_samples.
    """
    s_samples = np.asarray(s_samples, dtype=float)
    n = len(s_samples)
    clearance = np.full(n, np.inf)

    for i, s_i in enumerate(s_samples):
        p = ref_path(float(s_i))

        # --- PathConstraint via corridor_bounds ---
        if corridor_bounds is not None:
            b_left_in, b_right_in = corridor_bounds
            wl = b_left_in(s_i) if callable(b_left_in) else float(b_left_in)
            wr = b_right_in(s_i) if callable(b_right_in) else float(b_right_in)
            clearance[i] = min(clearance[i], wl + wr)

        # --- Cartesian constraints ---
        if cartesian_constraints:
            for region in cartesian_constraints:
                geom = region.geometry

                if isinstance(geom, PolygonConstraint):
                    if region.constraint_type == ConstraintType.KEEP_IN:
                        verts = np.array(geom.vertices, dtype=float)
                        if _point_in_polygon(p, verts):
                            d = _distance_to_polygon_boundary(p, verts)
                            clearance[i] = min(clearance[i], d)

                elif isinstance(geom, RectangleConstraint):
                    if region.constraint_type == ConstraintType.KEEP_IN:
                        d_left   = p[0] - geom.x
                        d_right  = geom.x + geom.width  - p[0]
                        d_bottom = p[1] - geom.y
                        d_top    = geom.y + geom.height - p[1]
                        d = min(d_left, d_right, d_bottom, d_top)
                        if d > 0:
                            clearance[i] = min(clearance[i], d)

    # Replace inf (unconstrained) with max finite value so normalization works.
    finite_mask = np.isfinite(clearance)
    if finite_mask.any():
        clearance[~finite_mask] = float(np.max(clearance[finite_mask]))
    else:
        clearance[:] = 1.0  # fully unconstrained path — use uniform clearance

    return clearance


def compute_qp_bounds(
    centerline,
    s_knots: np.ndarray,
    C: np.ndarray,
    N_right: np.ndarray,
    tunnel_half_w: np.ndarray,
    cartesian_constraints: Optional[List] = None,
    margin: float = 0.001,
    n_probe: int = 40,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Compute per-knot lateral lower/upper bounds for the reference-path QP.

    For each knot k the reference path model is  p(s_k) = C(s_k) + d_k * n_R(s_k).
    We find the maximum |d| in each direction such that the resulting point
    stays inside every active KEEP_IN constraint.

    When no Cartesian constraints are present the bounds fall back to the
    symmetric tunnel half-width ``tunnel_half_w`` (the original behaviour).

    Args:
        centerline:            ReferencePath for the tunnel centerline.
        s_knots:               Arc-length samples (N,).
        C:                     Centerline positions at the knots, shape (N, 2).
        N_right:               Right-pointing unit normals at the knots, (N, 2).
        tunnel_half_w:         Fallback half-width array (N,).
        cartesian_constraints: List[ConstraintRegion] — only KEEP_IN regions
                               are used.  May be None.
        margin:                Safety margin subtracted from bounds.
        n_probe:               Number of probe offsets per side for the binary
                               search that finds the tightest feasible d.

    Returns:
        lb, ub: Lower and upper bound arrays of shape (N,).
                lb <= 0, ub >= 0  (lateral offset convention).
    """
    N = len(s_knots)
    lb = -tunnel_half_w.copy()
    ub =  tunnel_half_w.copy()

    if not cartesian_constraints:
        return lb, ub

    # Collect all KEEP_IN geometries once.
    keep_in_geoms = []
    for region in cartesian_constraints:
        if region.constraint_type != ConstraintType.KEEP_IN:
            continue
        geom = region.geometry
        if isinstance(geom, PolygonConstraint):
            keep_in_geoms.append(('polygon', np.array(geom.vertices, dtype=float)))
        elif isinstance(geom, RectangleConstraint):
            keep_in_geoms.append(('rect', geom))

    if not keep_in_geoms:
        return lb, ub

    def _inside_all(pt):
        """Return True if *pt* is inside every KEEP_IN geometry."""
        for gtype, gdata in keep_in_geoms:
            if gtype == 'polygon':
                if not _point_in_polygon(pt, gdata):
                    return False
            else:  # rect
                g = gdata
                if not (g.x <= pt[0] <= g.x + g.width and
                        g.y <= pt[1] <= g.y + g.height):
                    return False
        return True

    # Probe offsets in [0, max_d] to find the valid feasible range.
    # Use a finer grid for better accuracy.
    max_d = float(np.max(tunnel_half_w)) * 2.0  # generous upper range
    probe_offsets = np.linspace(0.0, max_d, n_probe)

    for k in range(N):
        c_k = C[k]
        n_k = N_right[k]

        # Build a mask of which probe offsets are inside all constraints
        # for both positive and negative directions.

        # --- positive direction (ub) ---
        # Find the largest contiguous feasible d starting from 0.
        # If centerline is outside, find valid range and clamp to 0.
        inside_pos = np.array([_inside_all(c_k + d * n_k) for d in probe_offsets])
        if inside_pos[0]:
            # Centerline is inside — find first exit point
            exit_idx = np.argmin(inside_pos)  # First False
            if inside_pos[exit_idx]:  # All True
                best_pos = probe_offsets[-1]
            else:
                best_pos = probe_offsets[max(0, exit_idx - 1)]
        else:
            # Centerline is outside — no valid positive range from origin
            best_pos = 0.0
        ub[k] = min(ub[k], max(best_pos - margin, 0.0))

        # --- negative direction (lb) ---
        inside_neg = np.array([_inside_all(c_k - d * n_k) for d in probe_offsets])
        if inside_neg[0]:
            # Centerline is inside — find first exit point
            exit_idx = np.argmin(inside_neg)  # First False
            if inside_neg[exit_idx]:  # All True
                best_neg = probe_offsets[-1]
            else:
                best_neg = probe_offsets[max(0, exit_idx - 1)]
        else:
            # Centerline is outside — no valid negative range from origin
            best_neg = 0.0
        lb[k] = max(lb[k], -max(best_neg - margin, 0.0))

    return lb, ub
