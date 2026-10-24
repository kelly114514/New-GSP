#!/usr/bin/env python3
"""C-group (transform) prediction helpers for the offline oracle matcher.

A transform image is `p' = M p + t` with a 2x2 similarity matrix `M` in page coordinates
(x right, y down). `matrix_for` derives M/t from the object's kind 2003 payload and the
already predicted parents; `apply_matrix` maps a predicted geometry. Predictions only pick
a unique measured EMF primitive, they never become expected values.
"""
from __future__ import annotations

import math
import struct

ANGLE_VARIANT = 1
C_VERIFIED = {16, 17, 21, 27, 28, 30, 32, 34, 75}  # numerically matched against original EMF, see spec/objects/cards


def identity():
    return (1.0, 0.0, 0.0, 1.0), (0.0, 0.0)


def translation(dx, dy):
    return (1.0, 0.0, 0.0, 1.0), (dx, dy)


def rotation(center, degrees):
    """Positive angle = visually counter-clockwise on the page (y down)."""
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    m = (c, s, -s, c)
    return m, (center[0] - (m[0] * center[0] + m[1] * center[1]), center[1] - (m[2] * center[0] + m[3] * center[1]))


def dilation(center, ratio):
    return (ratio, 0.0, 0.0, ratio), (center[0] * (1 - ratio), center[1] * (1 - ratio))


def reflection(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    if n == 0:
        return None
    dx, dy = dx / n, dy / n
    m = (2 * dx * dx - 1, 2 * dx * dy, 2 * dx * dy, 2 * dy * dy - 1)
    return m, (a[0] - (m[0] * a[0] + m[1] * a[1]), a[1] - (m[2] * a[0] + m[3] * a[1]))


def point_map(matrix, p):
    (a, b, c, d), (tx, ty) = matrix
    return [a * p[0] + b * p[1] + tx, c * p[0] + d * p[1] + ty]


def determinant(matrix):
    (a, b, c, d), _ = matrix
    return a * d - b * c


def scale_of(matrix):
    return math.sqrt(abs(determinant(matrix)))


def _heading(center, point):
    return math.degrees(math.atan2(point[1] - center[1], point[0] - center[0]))


def apply_matrix(matrix, g):
    """Image of a predicted geometry (None when the kind cannot be transformed)."""
    kind = g["kind"]
    if kind == "point":
        return {"kind": "point", "point": point_map(matrix, g["point"])}
    if kind in ("segment", "line", "ray"):
        return {"kind": kind, "a": point_map(matrix, g["a"]), "b": point_map(matrix, g["b"])}
    if kind in ("circle", "disk"):
        return {"kind": kind, "center": point_map(matrix, g["center"]), "radius": g["radius"] * scale_of(matrix)}
    if kind == "polygon":
        return {"kind": kind, "vertices": [point_map(matrix, v) for v in g["vertices"]]}
    if kind in ("arc", "sector", "circularSegment"):
        center = point_map(matrix, g["center"])
        first = point_map(matrix, g["a"])
        sweep = g["sweepAngle"] * (1 if determinant(matrix) > 0 else -1)
        radius = g["radius"] * scale_of(matrix)
        start = -_heading(center, first)
        a = [center[0] + radius * math.cos(math.radians(start)), center[1] - radius * math.sin(math.radians(start))]
        end = start + sweep
        b = [center[0] + radius * math.cos(math.radians(end)), center[1] - radius * math.sin(math.radians(end))]
        return {"kind": kind, "center": center, "radius": radius, "startAngle": start, "sweepAngle": sweep, "a": a, "b": b}
    return None


def extra_f64(obj, offset):
    data = obj.get("constraintExtra", b"")
    if len(data) < offset + 8:
        return None
    value, = struct.unpack_from("<d", data, offset)
    return value if math.isfinite(value) else None


def stored_angle_degrees(obj):
    """Angle of a 27/21/24 payload from its unit-independent pair (a, b) = (-sin t, cos t), t visually counter-clockwise."""
    a, b = extra_f64(obj, 4), extra_f64(obj, 12)
    if a is None or b is None or abs(math.hypot(a, b) - 1) > 1e-6:
        return None
    return math.degrees(math.atan2(-a, b))


def matrix_for(obj, ps, objects):
    """Transform matrix for a C-group object given predicted parents `ps` (parents[0] is the source)."""
    c = obj["constraint"]
    pts = [q["point"] for q in ps[1:] if q is not None and q["kind"] == "point"]
    if c == 75 and len(ps) >= 2:
        return identity()  # dynamic colour: geometry equals the source, only the colour is driven by the parameters
    if c == 16 and len(ps) == 3 and len(pts) == 2:
        return translation(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
    if c == 17 and len(ps) == 1:
        dx, dy = extra_f64(obj, 4), extra_f64(obj, 24)
        if dx is not None and dy is not None:
            return translation(dx, -dy)
    if c == 21 and len(ps) == 1:
        angle, distance = stored_angle_degrees(obj), extra_f64(obj, 32)
        if angle is not None and distance is not None:
            return translation(distance * math.cos(math.radians(angle)), -distance * math.sin(math.radians(angle)))
    if c == 27 and len(ps) == 2 and len(pts) == 1:
        angle = stored_angle_degrees(obj)
        if angle is not None:
            return rotation(pts[0], angle)
    if c == 30 and len(ps) == 2 and len(pts) == 1:
        ratio = extra_f64(obj, 4)
        if ratio is not None:
            return dilation(pts[0], ratio)
    if c == 34 and len(ps) == 2 and ps[1] is not None and ps[1]["kind"] in ("segment", "line", "ray"):
        return reflection(ps[1]["a"], ps[1]["b"])
    if c == 28 and len(ps) == 5 and len(pts) == 4:
        center, p1, p2, p3 = pts
        u, v = (p1[0] - p2[0], p1[1] - p2[1]), (p3[0] - p2[0], p3[1] - p2[1])
        if math.hypot(*u) > 0 and math.hypot(*v) > 0:
            # visual-counter-clockwise angle from p2->p1 to p2->p3 (page y is down)
            theta = (math.degrees(math.atan2(u[1], u[0])) - math.degrees(math.atan2(v[1], v[0]))) % 360.0
            return rotation(center, ANGLE_VARIANT * theta)
    if c == 31 and len(ps) == 4 and len(pts) == 1 and ps[2] is not None and ps[3] is not None             and ps[2]["kind"] == "segment" and ps[3]["kind"] == "segment":
        def length(g):
            return math.hypot(g["b"][0] - g["a"][0], g["b"][1] - g["a"][1])
        if length(ps[3]) > 0:
            return dilation(pts[0], length(ps[2]) / length(ps[3]))
    if c == 32 and len(ps) == 5 and len(pts) == 4:
        center, d, e, f = pts
        base = math.hypot(e[0] - d[0], e[1] - d[1])
        if base > 0:
            # Ratio of the distances D->F over D->E along their common line; negative when F lies on the other side of D.
            sign = -1.0 if (f[0] - d[0]) * (e[0] - d[0]) + (f[1] - d[1]) * (e[1] - d[1]) < 0 else 1.0
            return dilation(center, sign * math.hypot(f[0] - d[0], f[1] - d[1]) / base)
    return None
