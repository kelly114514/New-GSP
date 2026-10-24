#!/usr/bin/env python3
"""Offline native-object / original EMF matcher. Never launches Sketchpad.

Predictions select a unique measured primitive; they NEVER supply oracle values.
Skipped or ambiguous objects remain explicit coverage gaps. Standard library only.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys

from inspect_gsp import parse_records
from emf_dump import parse_emf

ROOT = Path(__file__).resolve().parents[1]
A_GROUP = set(range(16)) | {63, 64, 79, 80, 81, 82, 83, 93, 98}
MATCH_PX = 0.075
TOLERANCE_PX = 0.1


def sha(data):
    return hashlib.sha256(data).hexdigest()


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def add(a, b):
    return [a[0] + b[0], a[1] + b[1]]


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1]]


def mul(a, s):
    return [a[0] * s, a[1] * s]


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, list):
        return [rounded(x) for x in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value


def native_document(path):
    data = path.read_bytes()
    if data[:4] != b"GSP4":
        raise ValueError("unsupported magic")
    records, error = parse_records(data)
    if error:
        raise ValueError(str(error))
    pages, tools, page, obj = [], [], None, None
    header = None
    for rec in records:
        k = rec["kind"]
        p = data[rec["payload_offset"]:rec["payload_offset"] + rec["payload_size"]]
        if k == 900:
            header = struct.unpack("<14H", p)
        elif k == 1000:
            page = {"pageIndex": len(pages) + 1, "objects": []}
            pages.append(page)
        elif k == 1002:
            page = {"toolIndex": len(tools) + 1, "objects": []}
            tools.append(page)
        elif k in (1001, 1003):
            page = None
        elif k == 2000 and page is not None:
            c, state, field04, main, genera, style = struct.unpack_from("<6H", p)
            obj = {"objectIndex": len(page["objects"]) + 1, "constraint": c,
                   "mainKind": main, "genera": genera, "state": state,
                   "styleWord": style, "color": "#" + p[12:15].hex(), "parents": []}
            page["objects"].append(obj)
        elif k == 2007:
            obj = None
        elif obj is not None:
            if k == 2002:
                n, = struct.unpack_from("<I", p)
                obj["parents"] = list(struct.unpack_from("<" + "I" * n, p, 4))
            elif k == 2201:
                obj["savedPoint"] = list(struct.unpack("<dd", p))
            elif k == 2003:
                obj["constraintExtra"] = p
            elif k == 2005 and len(p) >= 6:
                obj["labelFlags"] = list(struct.unpack_from("<3H", p))
                if len(p) >= 24:
                    obj["labelByteLength"], = struct.unpack_from("<H", p, 22)
    if header is None:
        raise ValueError("missing document header")
    return {"sha256": sha(data), "pages": pages, "tools": tools, "activePageIndex": header[8] + 1,
            "layout": header[0]}


def parse_html(path):
    if path is None or not path.is_file():
        return None
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    steps = []
    # Line-anchored bounded matches: large exports must not trigger quadratic regex.
    for line in text.splitlines():
        m = re.match(r"\s*\{(\d+)\}\s*([A-Za-z][A-Za-z0-9 _]*)\(([^\r\n]*)", line)
        if not m:
            continue
        tail = m[3]
        args = tail.split(")", 1)[0]
        step = {"step": int(m[1]), "type": m[2], "hidden": bool(re.search(r"(?:\[|,)hidden(?:,|\])", tail))}
        step["hasLabel"] = bool(re.search(r"(?:\[|,)label\(", tail))
        step["styleTokens"] = [name for name in ("hairline", "thin", "mediumLine", "thick", "dotted", "dashed", "dot", "smallPoint", "mediumPoint", "large", "largePoint")
                               if re.search(r"(?:\[|,)" + name + r"(?:,|\])", tail)]
        if m[2] in ("Midpoint", "Segment", "Circle", "Perpendicular", "Parallel", "Bisector", "Polygon", "Intersect", "Intersect1", "Intersect2", "Line", "Ray"):
            try:
                step["parents"] = [int(x) for x in args.split(",")]
            except ValueError:
                pass
        elif m[2] == "Point on object":
            try:
                values = args.split(",")
                step["parents"] = [int(values[0])]
                step["pathParameter"] = float(values[1])
            except (ValueError, IndexError):
                pass
        if m[2] in ("Point", "FixedPoint"):
            try:
                xy = [float(x) for x in args.split(",")]
                if len(xy) == 2:
                    step["point"] = xy
            except ValueError:
                pass
        steps.append(step)
    canvas = re.search(r"<APPLET\b[^>]*\bWIDTH=(\d+)\s+HEIGHT=(\d+)", text, re.I)
    return {"sha256": sha(raw), "steps": steps,
            "canvas": [int(canvas[1]), int(canvas[2])] if canvas else None}


def bind_html(objects, html):
    """Unique graph binding. Never equate native object index with HTML step id."""
    if not html:
        return {}
    direct_points = [s for s in html["steps"] if "point" in s]
    native_points = [o for o in objects if "savedPoint" in o]
    shifted = None
    if len(native_points) * len(direct_points) <= 1_000_000:
        neutral_objects = [{**o, "color": "#000000", "state": 0} for o in native_points]
        neutral_primitives = [{"kind": "point", "point": s["point"], "primitiveIndex": s["step"], "brush": {"color": "#000000"}}
                              for s in direct_points]
        shifted, _ = fit_offset(neutral_objects, neutral_primitives)
    if shifted is None:
        return {}
    types = {1: {"Midpoint"}, 2: {"Segment"}, 3: {"Circle"}, 4: {"Circle"},
             5: {"Perpendicular"}, 6: {"Parallel"}, 7: {"Bisector"}, 8: {"Polygon"},
             9: {"Intersect"}, 11: {"Intersect1"}, 12: {"Intersect2"},
             13: {"Intersect1"}, 14: {"Intersect2"}, 15: {"Point on object"}, 63: {"Line"}, 64: {"Ray"}}
    bindings = {}
    for obj in objects:
        i, c = obj["objectIndex"], obj["constraint"]
        candidates = []
        if "savedPoint" in obj:
            # Native duplicates (including hidden objects) make coordinate identity ambiguous.
            duplicates = [o for o in objects if "savedPoint" in o and distance(o["savedPoint"], obj["savedPoint"]) <= MATCH_PX]
            if len(duplicates) == 1:
                candidates = [s for s in direct_points if distance(add(s["point"], shifted), obj["savedPoint"]) <= MATCH_PX]
        elif c in types and obj["parents"] and all(p in bindings for p in obj["parents"]):
            signature = sorted(bindings[p]["step"] for p in obj["parents"])
            candidates = [s for s in html["steps"] if s["type"] in types[c] and sorted(s.get("parents", [])) == signature]
            if c == 15 and len(obj.get("constraintExtra", b"")) == 12:
                t, = struct.unpack_from("<d", obj["constraintExtra"], 4)
                candidates = [s for s in candidates if abs(s.get("pathParameter", math.inf) - t) <= max(0.0001, abs(t) * 0.00001)]
            elif c == 15 and len(obj.get("constraintExtra", b"")) == 20:
                parent = objects[obj["parents"][0] - 1]
                if parent["mainKind"] == 3:
                    u, v = struct.unpack_from("<dd", obj["constraintExtra"], 4)
                    t = (math.atan2(v, u) / (2 * math.pi)) % 1
                    candidates = [s for s in candidates if math.isfinite(s.get("pathParameter", math.inf))
                                  and abs((s["pathParameter"] - t + 0.5) % 1 - 0.5) <= 0.00001]
        if len(candidates) == 1:
            bindings[i] = candidates[0]
    owners = Counter(s["step"] for s in bindings.values())
    bindings = {i: s for i, s in bindings.items() if owners[s["step"]] == 1}
    for obj in objects:
        i = obj["objectIndex"]
        if i in bindings and any(parent not in bindings for parent in obj["parents"]):
            del bindings[i]
    return bindings


def within_linear(linear, parameter):
    """Native range check for a parameter on a segment, ray or line."""
    slack = 64 * sys.float_info.epsilon * max(1.0, abs(parameter))
    if linear["kind"] == "line":
        return True
    if linear["kind"] == "ray":
        return parameter >= -slack
    return parameter <= 1 + slack


def linear_circle_root(linear, circle, prefer_smaller):
    """Candidate intersection predicted from the cards, never an expected value.

    Constraints 11 and 12 differ only in which root they prefer: the smaller or the
    larger parameter along the line basis. A preferred root outside the parent range
    falls back to the other one.
    """
    origin, d = linear["a"], sub(linear["b"], linear["a"])
    qa = d[0] * d[0] + d[1] * d[1]
    if qa == 0:
        return None
    offset = sub(origin, circle["center"])
    qb = 2 * (d[0] * offset[0] + d[1] * offset[1])
    qc = offset[0] * offset[0] + offset[1] * offset[1] - circle["radius"] ** 2
    discriminant = qb * qb - 4 * qa * qc
    tolerance = 64 * sys.float_info.epsilon * (qb * qb + abs(4 * qa * qc))
    if discriminant < -tolerance:
        return None
    if discriminant <= tolerance:
        roots = [-qb / (2 * qa)]
    else:
        root = math.sqrt(discriminant)
        roots = sorted(((-qb - root) / (2 * qa), (-qb + root) / (2 * qa)))
    for t in roots if prefer_smaller else list(reversed(roots)):
        if within_linear(linear, t):
            return add(origin, mul(d, t))
    return None


def circle_circle_root(a, b, prefer_first):
    """Constraint 13 prefers +h*(ey,-ex), 14 prefers -h*(ey,-ex) in page coordinates."""
    delta = sub(b["center"], a["center"])
    span = math.hypot(*delta)
    if span == 0:
        return None
    ex, ey = delta[0] / span, delta[1] / span
    r1, r2 = a["radius"], b["radius"]
    along = (r1 * r1 - r2 * r2 + span * span) / (2 * span)
    h2 = r1 * r1 - along * along
    tolerance = 64 * sys.float_info.epsilon * (r1 * r1 + along * along)
    if h2 < -tolerance:
        return None
    h = 0.0 if h2 <= tolerance else math.sqrt(h2)
    sign = 1 if prefer_first else -1
    base = add(a["center"], mul([ex, ey], along))
    return [base[0] + sign * h * ey, base[1] - sign * h * ex]


def predict(objects, html_bindings=None):
    """Conservative geometric search hints, NOT oracle assertions.

    Ambiguous orientation, path parameters, arcs and arc-bounded regions are deliberately
    deferred. Every emitted assertion is read back from an original EMF primitive.
    """
    out = {}
    eligible = {}
    html_bindings = html_bindings or {}
    for obj in objects:
        i, c, parents = obj["objectIndex"], obj["constraint"], obj["parents"]
        eligible[i] = c in A_GROUP and (c != 0 or obj["mainKind"] == 1) and all(eligible.get(p, False) for p in parents)
        ps = [out.get(p) for p in parents]
        g = None
        if not eligible[i]:
            continue
        if c == 0 and "savedPoint" in obj:
            g = {"kind": "point", "point": obj["savedPoint"]}
        elif all(ps):
            points = [p["point"] for p in ps if p["kind"] == "point"]
            lines = [p for p in ps if p["kind"] in ("segment", "line", "ray")]
            circles = [p for p in ps if p["kind"] == "circle"]
            if c == 1 and len(ps) == 1 and len(lines) == 1:
                g = {"kind": "point", "point": mul(add(lines[0]["a"], lines[0]["b"]), 0.5)}
            elif c in (2, 63, 64) and len(points) == 2:
                g = {"kind": {2: "segment", 63: "line", 64: "ray"}[c], "a": points[0], "b": points[1]}
            elif c == 3 and len(points) == 2:
                g = {"kind": "circle", "center": points[0], "radius": distance(*points)}
            elif c == 4 and len(points) == 1 and len(lines) == 1:
                g = {"kind": "circle", "center": points[0], "radius": distance(lines[0]["a"], lines[0]["b"])}
            elif c in (5, 6) and len(points) == 1 and len(lines) == 1:
                d = sub(lines[0]["b"], lines[0]["a"])
                if c == 5:
                    d = [-d[1], d[0]]
                g = {"kind": "line", "a": points[0], "b": add(points[0], d)}
            elif c == 8 and len(points) == len(ps) and len(points) >= 3:
                g = {"kind": "polygon", "vertices": points}
            elif c == 9 and len(lines) == 2 and len(ps) == 2:
                a, b = lines
                d, e, v = sub(a["b"], a["a"]), sub(b["b"], b["a"]), sub(b["a"], a["a"])
                cross = d[0] * e[1] - d[1] * e[0]
                if abs(cross) > 1e-12 * max(1, math.hypot(*d) * math.hypot(*e)):
                    t = (v[0] * e[1] - v[1] * e[0]) / cross
                    u = (v[0] * d[1] - v[1] * d[0]) / cross
                    def within(line, parameter):
                        return line["kind"] == "line" or parameter >= 0 and (line["kind"] == "ray" or parameter <= 1)
                    if within(a, t) and within(b, u):
                        g = {"kind": "point", "point": add(a["a"], mul(d, t))}
            elif c in (11, 12) and len(ps) == 2 and ps[0]["kind"] in ("segment", "line", "ray") and ps[1]["kind"] == "circle":
                root = linear_circle_root(ps[0], ps[1], prefer_smaller=c == 11)
                if root is not None:
                    g = {"kind": "point", "point": root}
            elif c in (13, 14) and len(ps) == 2 and ps[0]["kind"] == "circle" and ps[1]["kind"] == "circle":
                root = circle_circle_root(ps[0], ps[1], prefer_first=c == 13)
                if root is not None:
                    g = {"kind": "point", "point": root}
            elif c == 15 and len(ps) == 1 and len(lines) == 1:
                extra = obj.get("constraintExtra", b"")
                parent = objects[parents[0] - 1]
                if len(extra) == 12 and parent["constraint"] in (2, 63, 64):
                    t, = struct.unpack_from("<d", extra, 4)
                    if math.isfinite(t):
                        g = {"kind": "point", "point": add(lines[0]["a"], mul(sub(lines[0]["b"], lines[0]["a"]), t))}
            elif c == 15 and len(ps) == 1 and len(circles) == 1:
                extra = obj.get("constraintExtra", b"")
                if len(extra) == 20:
                    u, v = struct.unpack_from("<dd", extra, 4)
                    if math.isfinite(u) and math.isfinite(v) and abs(u * u + v * v - 1) <= 1e-9:
                        circle = circles[0]
                        g = {"kind": "point", "point": add(circle["center"], [circle["radius"] * u, -circle["radius"] * v])}
            elif c == 10 and len(circles) == 1 and len(ps) == 1:
                g = {**circles[0], "kind": "disk"}
        if g is not None:
            out[i] = g
    return out, eligible


def measured_primitives(emf):
    out = []
    for i, p in enumerate(emf["primitives"]):
        pts = p.get("px96", [])
        d = {"primitiveIndex": i, "layer": p.get("layer"), "pen": p.get("pen"), "brush": p.get("brush")}
        if p["kind"] == "ellipse" and len(pts) == 2:
            w, h = abs(pts[1][0] - pts[0][0]), abs(pts[1][1] - pts[0][1])
            center = mul(add(*pts), 0.5)
            if abs(w - h) < MATCH_PX:
                if p.get("fill") and 2 <= w <= 18:
                    out.append({**d, "kind": "point", "point": center, "diameter": (w + h) / 2})
                if w > 18:
                    out.append({**d, "kind": "disk" if p.get("fill") else "circle", "center": center, "radius": (w + h) / 4})
        elif p["kind"] in ("path", "line", "polyline", "polygon"):
            if p["kind"] == "path":
                subs = p.get("subpaths", [])
                if len(subs) != 1 or any(op[0] not in ("M", "L") for op in subs[0].get("ops", [])):
                    continue
            if len(pts) == 2 and p.get("mode") != "fill":
                out.append({**d, "kind": "edge", "a": pts[0], "b": pts[1]})
            elif len(pts) >= 3 and (p.get("fill") or p.get("mode") == "fill"):
                if distance(pts[0], pts[-1]) < MATCH_PX:
                    pts = pts[:-1]
                out.append({**d, "kind": "polygon", "vertices": pts})
    return out


def color_for(p):
    return (p.get("brush") or p.get("pen") or {}).get("color")


def fit_offset(objects, measured):
    anchors = [o for o in objects if "savedPoint" in o and o["state"] != 4]
    dots = [p for p in measured if p["kind"] == "point"]
    # Identical filled primitives are not independent anchors.
    unique = {}
    for p in dots:
        unique[(tuple(p["point"]), color_for(p))] = p
    dots = list(unique.values())
    votes = defaultdict(list)
    for o in anchors:
        for p in dots:
            if o["color"].lower() != (color_for(p) or "").lower():
                continue
            offset = sub(o["savedPoint"], p["point"])
            key = tuple(round(x / 0.05) for x in offset)
            votes[key].append((o["objectIndex"], p["primitiveIndex"], offset))
    scored = []
    for key, pairs in votes.items():
        n = min(len({a for a, _, _ in pairs}), len({b for _, b, _ in pairs}))
        scored.append((n, key, pairs))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        return None, {"reason": "no_free_point_anchor"}
    n, _, pairs = scored[0]
    if len(scored) > 1 and scored[1][0] == n:
        return None, {"reason": "ambiguous_translation", "bestAnchorCount": n}
    if n < 2 and not (len(anchors) == 1 and len(dots) == 1):
        return None, {"reason": "insufficient_translation_anchors", "bestAnchorCount": n}
    offset = [sum(v[2][d] for v in pairs) / len(pairs) for d in (0, 1)]
    # Two coincident native points must not count as two spatial anchors.
    locations = {tuple(o["savedPoint"]) for o in anchors if o["objectIndex"] in {p[0] for p in pairs}}
    if n >= 2 and len(locations) < 2:
        return None, {"reason": "coincident_translation_anchors"}
    return offset, {"method": "unique_free_point_color_translation_vote", "anchorCount": n,
                    "anchorPairs": [[a, b] for a, b, _ in pairs], "documentMinusEmfPx96": rounded(offset)}


def translated(p, offset):
    q = dict(p)
    for key in ("point", "a", "b", "center"):
        if key in q:
            q[key] = add(q[key], offset)
    if "vertices" in q:
        q["vertices"] = [add(v, offset) for v in q["vertices"]]
    return q


def polygon_error(a, b):
    if len(a) != len(b):
        return math.inf
    n = len(a)
    return min(max(distance(a[j], seq[(i + j) % n]) for j in range(n))
               for seq in (b, list(reversed(b))) for i in range(n))


def line_distance(p, a, b):
    d = sub(b, a)
    n = math.hypot(*d)
    return abs(d[0] * (a[1] - p[1]) - (a[0] - p[0]) * d[1]) / n if n > 1e-12 else math.inf


def match_error(g, p):
    kind = g["kind"]
    if kind == "point" and p["kind"] == "point":
        return distance(g["point"], p["point"])
    if kind in ("circle", "disk") and p["kind"] == kind:
        return max(distance(g["center"], p["center"]), abs(g["radius"] - p["radius"]))
    if kind == "segment" and p["kind"] == "edge":
        return min(max(distance(g["a"], p["a"]), distance(g["b"], p["b"])),
                   max(distance(g["a"], p["b"]), distance(g["b"], p["a"])))
    if kind == "line" and p["kind"] == "edge":
        return max(line_distance(p["a"], g["a"], g["b"]), line_distance(p["b"], g["a"], g["b"]))
    # Ray origin/order still awaits the independently reviewed object card.
    if kind == "polygon" and p["kind"] == "polygon":
        return polygon_error(g["vertices"], p["vertices"])
    return math.inf


def geometry_of(p, kind):
    if kind == "point":
        return {"x": p["point"][0], "y": p["point"][1]}
    if kind in ("segment", "line", "ray"):
        return {"a": p["a"], "b": p["b"]}
    if kind in ("circle", "disk"):
        return {"center": p["center"], "radius": p["radius"]}
    if kind == "polygon":
        return {"vertices": p["vertices"]}
    raise ValueError(kind)


def appearance_of(p, emf):
    if p["kind"] == "point":
        # Fill and stroke are two EMF+ records for one dot, never two objects.
        matches = []
        for i, other in enumerate(emf["primitives"]):
            xy = other.get("px96", [])
            if other["kind"] != "ellipse" or len(xy) != 2 or not other.get("pen"):
                continue
            center = mul(add(*xy), 0.5)
            diameter = abs(xy[1][0] - xy[0][0])
            if distance(center, p["point"]) <= MATCH_PX and abs(diameter - p["diameter"]) <= MATCH_PX:
                matches.append((i, other))
        result = {"diameterPx": p["diameter"], "fill": color_for(p), "fillPrimitiveIndex": p["primitiveIndex"]}
        if len(matches) == 1:
            i, stroke = matches[0]
            result.update(stroke=stroke["pen"].get("color"), strokeWidthPx=stroke["pen"].get("width_px96"), strokePrimitiveIndex=i)
        else:
            result["strokeUncoveredReason"] = "missing_or_ambiguous_matching_outline"
        return result
    pen, brush = p.get("pen") or {}, p.get("brush") or {}
    return {"stroke": pen.get("color"), "strokeWidthPx": pen.get("width_px96"), "fill": brush.get("color")}


def make_case(source, emf_path=None, html_path=None, emf_unavailable_reason=None):
    doc = native_document(source)
    page = doc["pages"][doc["activePageIndex"] - 1]
    objects = page["objects"]
    html = parse_html(html_path)
    html_bindings = bind_html(objects, html)
    hints, eligible = predict(objects, html_bindings)
    raw = emf_path.read_bytes() if emf_path is not None and emf_path.is_file() and not emf_unavailable_reason else None
    emf = parse_emf(raw, with_records=False) if raw else None
    if emf and not emf["validation"]["ok"]:
        raise ValueError("invalid EMF: " + str(emf["validation"]["issues"]))
    measured = measured_primitives(emf) if emf else []
    offset, alignment = fit_offset(objects, measured) if emf else (None, {"reason": emf_unavailable_reason or "no_emf"})
    assertions, excluded, candidates = [], [], {}
    in_document = [translated(p, offset) for p in measured] if offset is not None else []
    for obj in objects:
        i, c = obj["objectIndex"], obj["constraint"]
        if c not in A_GROUP or c == 0 and obj["mainKind"] != 1:
            continue
        reason = None
        if not eligible.get(i):
            reason = "ancestor_outside_A_group"
        elif i in html_bindings and html_bindings[i]["hidden"]:
            reason = "hidden_html_no_emf_expectation"
        elif obj["state"] == 4:
            reason = "hidden_state_4_no_emf_expectation"
        elif i not in hints:
            reason = "geometry_matcher_not_yet_implemented"
        elif offset is None:
            reason = alignment["reason"]
        elif i not in html_bindings:
            reason = "native_html_mapping_not_unique"
        else:
            g = hints[i]
            ps = [p for p in in_document if match_error(g, p) <= MATCH_PX
                  and (color_for(p) or "").lower() == obj["color"].lower()]
            if len(ps) != 1:
                reason = "no_primitive_or_clipped" if not ps else "ambiguous_primitives"
            else:
                candidates[i] = ps[0]
        if reason:
            excluded.append({"objectIndex": i, "constraint": c, "reason": reason})
    owners = defaultdict(list)
    for i, p in candidates.items():
        owners[p["primitiveIndex"]].append(i)
    for i, p in candidates.items():
        obj = objects[i - 1]
        if len(owners[p["primitiveIndex"]]) > 1:
            excluded.append({"objectIndex": i, "constraint": obj["constraint"], "reason": "primitive_shared_by_multiple_objects"})
            continue
        kind = hints[i]["kind"]
        assertions.append({"objectIndex": i, "constraint": obj["constraint"], "kind": kind,
                           "exists": True, "geometry": rounded(geometry_of(p, kind)), "tolerancePx": TOLERANCE_PX,
                           "appearance": rounded(appearance_of(next(q for q in measured if q["primitiveIndex"] == p["primitiveIndex"]), emf)),
                           "provenance": {"source": "original_emf_primitive", "primitiveIndex": p["primitiveIndex"],
                                          "layer": p["layer"], "mapping": "unique_geometry_and_color_then_unique_object_owner",
                                          "htmlStep": html_bindings[i]["step"], "htmlMapping": "unique_free_point_or_parent_graph",
                                          "matchingPredictionUsed": True, "pen": p["pen"], "brush": p["brush"]}})
    try:
        rel = source.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        rel = str(source.resolve())
    a_count = sum(o["constraint"] in A_GROUP and (o["constraint"] != 0 or o["mainKind"] == 1) for o in objects)
    other_pages = [{"pageIndex": p["pageIndex"], "objects": len(p["objects"]),
                    "AObjects": sum(o["constraint"] in A_GROUP and (o["constraint"] != 0 or o["mainKind"] == 1) for o in p["objects"]),
                    "reason": "non_current_page_no_export"} for p in doc["pages"] if p is not page]
    return {"schema": "gsp-m2-oracle-case-v1", "source": {"path": rel, "sha256": doc["sha256"]},
            "pageIndex": page["pageIndex"], "pageCount": len(doc["pages"]),
            "oracle": {"emfSha256": sha(raw) if raw else None, "htmlSha256": html["sha256"] if html else None,
                       "canvas": html["canvas"] if html else None, "layer": emf["primitives_layer"] if emf else None,
                       "alignment": alignment}, "assertions": assertions, "excluded": excluded, "otherPages": other_pages,
            "coverage": {"activePageObjects": len(objects), "activePageAObjects": a_count,
                         "eligibleWithAAncestors": sum(eligible.values()), "assertedObjects": len(assertions),
                         "excludedAObjects": len(excluded), "styleAndLabelsAccepted": False,
                         "toolAObjects": sum(o["constraint"] in A_GROUP and (o["constraint"] != 0 or o["mainKind"] == 1)
                                             for tool in doc["tools"] for o in tool["objects"]),
                         "fullM2Accepted": False}}


def output_path(value):
    # Manifest paths are absolute Windows paths, but source lookup remains repo based.
    return Path(value) if value else None


def sha_file(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_manifests(manifests):
    rows, snapshots = {}, []
    for manifest in manifests:
        raw = manifest.read_bytes()
        lines = raw.splitlines(keepends=True)
        trailing_ignored = bool(lines and not lines[-1].endswith((b"\n", b"\r")))
        if trailing_ignored:
            lines = lines[:-1]
        try:
            manifest_name = manifest.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            manifest_name = str(manifest.resolve())
        snapshots.append({"path": manifest_name, "snapshotSha256": sha(raw),
                          "completeLines": len(lines), "incompleteTrailingLineIgnored": trailing_ignored})
        for number, line in enumerate(lines, 1):
            try:
                row = json.loads(line)
            except (ValueError, UnicodeDecodeError) as exc:
                raise ValueError(f"complete manifest line {manifest}:{number} invalid: {exc}") from exc
            if row.get("status") == "ok":
                rows[row["input"].replace("\\", "/")] = row
    return rows, snapshots


def corpus_inventory():
    corpus_root = ROOT / "original/sketchpad5"
    counts = Counter()
    file_counts = {}
    for path in sorted(corpus_root.rglob("*.gsp")):
        doc = native_document(path)
        counts["files"] += 1
        counts["allObjects"] += sum(len(p["objects"]) for p in doc["pages"] + doc["tools"])
        raw_a = sum(o["constraint"] in A_GROUP for p in doc["pages"] + doc["tools"] for o in p["objects"])
        counts["allAConstraintsIncludingNonPointConstraint0"] += raw_a
        current, other, tool = 0, 0, 0
        for page in doc["pages"]:
            a = sum(o["constraint"] in A_GROUP and (o["constraint"] != 0 or o["mainKind"] == 1) for o in page["objects"])
            if page["pageIndex"] == doc["activePageIndex"]:
                current += a
            else:
                other += a
        tool = sum(o["constraint"] in A_GROUP and (o["constraint"] != 0 or o["mainKind"] == 1)
                   for section in doc["tools"] for o in section["objects"])
        counts["currentPageGeometricAObjects"] += current
        counts["nonCurrentPageGeometricAObjects"] += other
        counts["toolGeometricAObjects"] += tool
        file_counts[path.relative_to(ROOT).as_posix()] = {"currentPageAObjects": current, "otherPageAObjects": other, "toolAObjects": tool}
    return dict(counts), file_counts


def build_batch(manifests, output, max_emf_bytes):
    rows, manifest_snapshots = read_manifests(manifests)
    output.mkdir(parents=True, exist_ok=True)
    index, failures = [], []
    for rel, row in sorted(rows.items()):
        source = ROOT / rel
        emf = output_path(row.get("outputs", {}).get("emf", {}).get("path"))
        html = output_path(row.get("outputs", {}).get("html", {}).get("path"))
        try:
            if sha(source.read_bytes()) != row["input_sha256"]:
                raise ValueError("manifest/input SHA-256 mismatch")
            emf_reason = "emf_size_limit_explicitly_uncovered" if emf is not None and emf.is_file() and emf.stat().st_size > max_emf_bytes else None
            case = make_case(source, emf, html, emf_reason)
            # Validate actual local output identity, not just manifest status.
            for key, path in (("emf", emf), ("html", html)):
                item = row.get("outputs", {}).get(key, {})
                if path is not None and path.is_file() and item.get("sha256") and sha_file(path) != item["sha256"]:
                    raise ValueError(key + " manifest/output SHA-256 mismatch")
            name = sha(rel.encode("utf-8"))[:16] + ".json"
            (output / name).write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            index.append({"case": name, "source": case["source"], "pageIndex": case["pageIndex"],
                          "coverage": case["coverage"],
                          "exclusionReasons": dict(Counter(x["reason"] for x in case["excluded"])),
                          "byConstraint": dict(Counter(str(x["constraint"]) for x in case["assertions"])),
                          "nonCurrentPageAObjects": sum(p["AObjects"] for p in case["otherPages"])})
        except (OSError, ValueError, IndexError, struct.error) as exc:
            failures.append({"source": rel, "reason": str(exc)})
    totals = {key: sum(x["coverage"][key] for x in index)
              for key in ("activePageObjects", "activePageAObjects", "eligibleWithAAncestors", "assertedObjects", "excludedAObjects", "toolAObjects")}
    reasons = Counter()
    constraints = Counter()
    for item in index:
        reasons.update(item["exclusionReasons"])
        constraints.update(item["byConstraint"])
    inventory, corpus_files = corpus_inventory()
    covered_paths = {x["source"]["path"] for x in index}
    corpus_cases = [x for x in index if x["source"]["path"] in corpus_files]
    corpus_assertions = sum(x["coverage"]["assertedObjects"] for x in corpus_cases)
    report = {"schema": "gsp-m2-oracle-index-v1", "generator": "tools/emf_match.py", "generatorSha256": sha_file(Path(__file__)),
              "manifestSnapshots": manifest_snapshots,
              "manifestEntries": len(rows), "cases": index, "failures": failures,
              "totals": {**totals, "nonCurrentPageAObjects": sum(x["nonCurrentPageAObjects"] for x in index)},
              "assertionsByConstraint": dict(constraints), "exclusionReasons": dict(reasons),
              "corpusFileDenominator": inventory.get("files", 1431), "corpusInventory": inventory,
              "corpusCoverage": {"casesGenerated": len(corpus_cases), "assertedObjects": corpus_assertions,
                                 "currentPageAObjectsWithoutAssertions": inventory.get("currentPageGeometricAObjects", 0) - corpus_assertions,
                                 "filesWithoutGeneratedCases": len(set(corpus_files) - covered_paths),
                                 "currentPageAObjectsInFilesWithoutCases": sum(v["currentPageAObjects"] for p, v in corpus_files.items() if p not in covered_paths)},
              "fullM2Accepted": False,
              "limits": {"maxEmfBytes": max_emf_bytes, "allTypesCovered": False, "styleAndLabelsCovered": False}}
    (output / "index.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "cases"}, ensure_ascii=False, indent=2))
    return report


def build_baseline(oracle_dir, output):
    output.mkdir(parents=True, exist_ok=True)
    cases = []
    for name in ("empty", "point", "segment", "midpoint", "midpoint-moved"):
        source = ROOT / "samples/baseline/samples" / (name + ".gsp")
        case = make_case(source, oracle_dir / (name + ".emf"), oracle_dir / (name + ".htm"))
        count = len(native_document(source)["pages"][0]["objects"])
        if len(case["assertions"]) != count:
            raise ValueError(f"baseline {name} is not fully matched: {case['excluded']}")
        case["expectedObjectCount"] = count
        case["baselineGeometryComplete"] = True
        filename = "baseline-" + name + ".json"
        (output / filename).write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        cases.append(filename)
    moved = json.loads((output / "baseline-midpoint-moved.json").read_text(encoding="utf-8"))
    original = json.loads((output / "baseline-midpoint.json").read_text(encoding="utf-8"))
    moved["source"] = original["source"]
    moved["operation"] = {"type": "move_free_point", "pageIndex": 1, "objectIndex": 1, "to": [251, 174]}
    moved["oracle"]["savedAfterOperation"] = {
        "path": "samples/baseline/samples/midpoint-moved.gsp",
        "sha256": native_document(ROOT / "samples/baseline/samples/midpoint-moved.gsp")["sha256"]}
    (output / "baseline-midpoint-drag.json").write_text(json.dumps(moved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cases.append("baseline-midpoint-drag.json")
    (output / "baseline-index.json").write_text(json.dumps({"schema": "gsp-m2-oracle-index-v1", "cases": [{"case": x} for x in cases],
                                                            "fullM2Accepted": False}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"baselineCases": len(cases), "assertions": 16, "fullM2Accepted": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    one = subparsers.add_parser("one")
    one.add_argument("input", type=Path)
    one.add_argument("--emf", type=Path)
    one.add_argument("--html", type=Path)
    one.add_argument("--out", type=Path)
    batch = subparsers.add_parser("batch")
    batch.add_argument("--manifest", action="append", required=True, type=Path)
    batch.add_argument("--out", required=True, type=Path)
    batch.add_argument("--max-emf-bytes", type=int, default=50_000_000)
    baseline = subparsers.add_parser("baseline")
    baseline.add_argument("--oracle-dir", type=Path, default=ROOT / "oracle/validation/samples/baseline/samples")
    baseline.add_argument("--out", type=Path, default=ROOT / "spec/acceptance/m2")
    args = parser.parse_args()
    if args.command == "one":
        case = make_case(args.input, args.emf, args.html)
        content = json.dumps(case, ensure_ascii=False, indent=2) + "\n"
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(content, encoding="utf-8")
        else:
            print(content)
    elif args.command == "baseline":
        build_baseline(args.oracle_dir, args.out)
    else:
        build_batch(args.manifest, args.out, args.max_emf_bytes)


if __name__ == "__main__":
    main()
