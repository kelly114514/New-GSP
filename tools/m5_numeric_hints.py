#!/usr/bin/env python3
"""Numeric search hints for transforms driven by a measured value (cards 24/25/29/31/33).

Like every predictor in emf_match, these values ONLY select a unique original EMF primitive;
the expected geometry is always read back from that primitive. This module is written on the
spec side, independently of impl/, so a wrong implementation cannot make its own assertion
disappear by predicting the same wrong value.

Values are returned in base units: length page px, angle radians, number unitless.
Evaluation model (spec/acceptance/m5-measures.md): a calculation is evaluated in page display
units, trig follows the page angle unit, and the result dimension comes from the object genera.
Anything outside the verified subset returns None, which leaves the dependent object unasserted.
"""
import math
import struct

from m5_measures import FUNCTIONS, OPERATORS, record_fields

GENERA_DIMENSION = {48: "length", 49: "angle", 50: "area", 51: "number"}
# Free numeric objects (constraint 0, main kind 11): genera 79/80/81 are unitless/length/angle parameters.
FREE_GENERA_DIMENSION = {79: "number", 80: "length", 81: "angle"}
REQUIRED_DIMENSION = {24: {1: "length"}, 25: {4: "length"}, 29: {2: "angle"}, 33: {2: "number"}}


def length_scale(page):
    """px per display length unit, or None when the page preference is missing or unverified."""
    unit, dpi = page.get("preference10041"), page.get("dpi")
    if unit == 0:
        return 1.0
    if unit in (1, 2) and dpi:
        return dpi / 2.54 if unit == 1 else float(dpi)
    return None


def angle_scale(page):
    """radians per display angle unit."""
    unit = page.get("preference10042")
    return 1.0 if unit == 0 else math.pi / 180 if unit in (1, 2) else None


def base_scale(dimension, page):
    if dimension == "number":
        return 1.0
    if dimension == "length":
        return length_scale(page)
    if dimension == "angle":
        return angle_scale(page)
    if dimension == "area":
        s = length_scale(page)
        return None if s is None else s * s
    return None


def _evaluate_tokens(tokens, parents, page):
    """Display-unit infix evaluation of the verified token subset; raises ValueError otherwise."""
    at = 0
    a_scale = angle_scale(page)

    def literal_suffix(value):
        nonlocal at
        if at < len(tokens) and tokens[at] in (0x100, 0x101, 0x201):
            u = tokens[at]
            at += 1
            if u == 0x201:
                s = length_scale(page)
                if s is None or not page.get("dpi"):
                    raise ValueError("length unit")
                return value * (page["dpi"] / 2.54) / s
            if a_scale is None:
                raise ValueError("angle unit")
            return value * (1.0 if u == 0x100 else math.pi / 180) / a_scale
        return value

    def parse(minimum=0):
        nonlocal at
        if at >= len(tokens):
            raise ValueError("missing operand")
        t = tokens[at]
        at += 1
        if t == 0x1001:
            value = -parse(25)
        elif t == 11 or 0x2000 <= t <= 0x200C:
            inner = parse()
            if at >= len(tokens) or tokens[at] != 12:
                raise ValueError("unclosed group")
            at += 1
            value = inner if t == 11 else _function(FUNCTIONS[t - 0x2000], inner, a_scale)
        elif 0 <= t <= 10:
            digits = [t]
            while at < len(tokens) and 0 <= tokens[at] <= 10:
                digits.append(tokens[at])
                at += 1
            value = literal_suffix(float("".join("." if v == 10 else str(v) for v in digits)))
        elif t in (13, 14):
            value = literal_suffix(math.pi if t == 13 else math.e)
        elif 0x6000 <= t < 0x6000 + len(parents):
            value = parents[t - 0x6000]
        else:
            raise ValueError("unverified token " + hex(t))
        while at < len(tokens) and tokens[at] in OPERATORS:
            op = OPERATORS[tokens[at]]
            priority = {"+": 10, "-": 10, "*": 20, "/": 20, "^": 30}[op]
            if priority < minimum:
                break
            at += 1
            right = parse(priority if op == "^" else priority + 1)
            if op == "+":
                value += right
            elif op == "-":
                value -= right
            elif op == "*":
                value *= right
            elif op == "/":
                if right == 0:
                    raise ValueError("division by zero")
                value /= right
            else:
                value = math.pow(value, right)
        return value

    value = parse()
    if at != len(tokens):
        raise ValueError("unconsumed tokens")
    return value


def _function(name, x, a_scale):
    if name in ("sin", "cos", "tan", "asin", "acos", "atan") and a_scale is None:
        raise ValueError("angle unit")
    if name == "sin":
        return math.sin(x * a_scale)
    if name == "cos":
        return math.cos(x * a_scale)
    if name == "tan":
        return math.tan(x * a_scale)
    if name == "asin":
        return math.asin(x) / a_scale
    if name == "acos":
        return math.acos(x) / a_scale
    if name == "atan":
        return math.atan(x) / a_scale
    if name == "abs":
        return abs(x)
    if name == "sqrt":
        return math.sqrt(x)
    if name == "ln":
        return math.log(x)
    if name == "log":
        return math.log10(x)
    if name == "sgn":
        return float((x > 0) - (x < 0))
    if name == "round":
        return math.floor(x + 0.5)
    if name == "trunc":
        return float(math.trunc(x))
    raise ValueError(name)


def _point(g):
    return g["point"] if g is not None and g["kind"] == "point" else None


def _measure_base(obj, ps, page):
    """Measures 36/37/40/41/46/47 from predicted parent geometry, in base units."""
    c = obj["constraint"]
    if c == 36 and len(ps) == 1 and ps[0] is not None and ps[0]["kind"] == "segment":
        return math.dist(ps[0]["a"], ps[0]["b"]), "length"
    if c == 37 and len(ps) == 2 and all(_point(p) for p in ps):
        return math.dist(_point(ps[0]), _point(ps[1])), "length"
    if c in (40, 46) and len(ps) == 1 and ps[0] is not None and ps[0]["kind"] in ("circle", "disk"):
        return ps[0]["radius"] * (2 * math.pi if c == 40 else 1), "length"
    if c == 41 and len(ps) == 3 and all(_point(p) for p in ps):
        a, b, d = (_point(p) for p in ps)
        u, v = (a[0] - b[0], a[1] - b[1]), (d[0] - b[0], d[1] - b[1])
        if math.hypot(*u) * math.hypot(*v) < 1e-10:
            return None
        w = math.atan2(u[1] * v[0] - u[0] * v[1], u[0] * v[0] + u[1] * v[1])
        mode = page.get("preference10042")
        if mode not in (0, 1, 2):
            return None
        return (abs(w) if mode == 1 else w), "angle"
    if c == 47 and len(ps) == 2 and all(p is not None and p["kind"] == "segment" for p in ps):
        den = math.dist(ps[1]["a"], ps[1]["b"])
        return (math.dist(ps[0]["a"], ps[0]["b"]) / den, "number") if den > 1e-10 else None
    if c == 47 and len(ps) == 3 and all(_point(p) for p in ps):
        a, b, d = (_point(p) for p in ps)
        ab, ad = math.dist(a, b), math.dist(a, d)
        if ab < 1e-10 or abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])) > 1e-4 * max(1, ab * ad):
            return None
        return math.copysign(ad / ab, (b[0] - a[0]) * (d[0] - a[0]) + (b[1] - a[1]) * (d[1] - a[1])), "number"
    return None


def numeric_hint(obj, ps, page):
    """{"kind": "number", "value": base-unit value, "dimension": ...} or None."""
    if page is None:
        return None
    c = obj["constraint"]
    result = None
    try:
        if c == 0 and obj["mainKind"] == 11 and obj["genera"] in FREE_GENERA_DIMENSION and not obj["parents"]:
            fields = record_fields(obj.get("measureRecord", b""), obj.get("measureRecordKind"))
            if fields and "tokens" in fields:
                dimension = FREE_GENERA_DIMENSION[obj["genera"]]
                scale = base_scale(dimension, page)
                if scale is not None:
                    result = _evaluate_tokens(fields["tokens"], [], page) * scale, dimension
        elif c == 48 and obj["genera"] in GENERA_DIMENSION and all(p is not None and p["kind"] == "number" for p in ps):
            fields = record_fields(obj.get("measureRecord", b""), obj.get("measureRecordKind"))
            dimension = GENERA_DIMENSION[obj["genera"]]
            scale = base_scale(dimension, page)
            if fields and "tokens" in fields and scale is not None:
                display = []
                for p in ps:
                    s = base_scale(p["dimension"], page)
                    if s is None:
                        return None
                    display.append(p["value"] / s)
                result = _evaluate_tokens(fields["tokens"], display, page) * scale, dimension
        elif c in (36, 37, 40, 41, 46, 47):
            result = _measure_base(obj, ps, page)
    except (ValueError, OverflowError, ZeroDivisionError, KeyError, struct.error):
        return None
    if result is None or not math.isfinite(result[0]):
        return None
    return {"kind": "number", "value": result[0], "dimension": result[1]}


def parameter_of(c, ps, slot):
    """Base-unit parameter when the parent has the dimension the card requires; else None."""
    p = ps[slot] if slot < len(ps) else None
    if p is None or p["kind"] != "number" or p["dimension"] != REQUIRED_DIMENSION[c][slot]:
        return None
    return p["value"]
