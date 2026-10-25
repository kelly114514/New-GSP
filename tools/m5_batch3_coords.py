#!/usr/bin/env python3
"""Offline coordinate boundary evidence; never imports/calls product code or starts GSP.

Formula outputs are diagnostics. Expectations are copied unchanged from the frozen
r5 original-text assertions or read from independently identified original EMF dots.
The existing matcher and r5 are read-only inputs.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import struct

from emf_match import (color_for, fit_offset, measured_primitives,
                       modified_after_open, native_document, parse_emf,
                       predict, read_manifests, translated)
from m5_coords import axis_direction
from m5_coords import coordinates

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_PX = 1e-7
PARAMETER_EPS = 1e-9


def sha_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unsupported(reason, **details):
    return {"status": "unsupported", "reason": reason, **details}


def polygon_boundary_value(point, vertices):
    """Only boundary points with one logical perimeter parameter are established.

    The list is native parent order, not an EMF polygon's arbitrary starting vertex.
    A shared vertex may give two equal values. 0 and 1 deliberately remain distinct.
    """
    if len(vertices) < 3:
        return unsupported("polygon-vertex-count")
    lengths = [math.dist(a, vertices[(i + 1) % len(vertices)])
               for i, a in enumerate(vertices)]
    if any(length <= 1e-10 for length in lengths):
        return unsupported("polygon-zero-edge-unverified")
    perimeter = sum(lengths)
    candidates, prefix = [], 0.0
    for i, a in enumerate(vertices):
        b = vertices[(i + 1) % len(vertices)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        s = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengths[i] ** 2))
        q = [a[0] + s * dx, a[1] + s * dy]
        candidates.append({"edgeIndex": i, "localParameter": s,
                           "distancePx": math.dist(point, q), "point": q,
                           "value": (prefix + s * lengths[i]) / perimeter})
        prefix += lengths[i]
    distance = min(c["distancePx"] for c in candidates)
    if distance > BOUNDARY_PX:
        return unsupported("polygon-off-boundary-nearest-rule-unverified", distancePx=distance)
    nearest = [c for c in candidates if c["distancePx"] <= distance + BOUNDARY_PX]
    values = [c["value"] for c in nearest]
    if max(values) - min(values) > PARAMETER_EPS:
        return unsupported("polygon-nearest-logical-value-ambiguous", candidates=nearest)
    return {"status": "ok", "value": sum(values) / len(values),
            "distancePx": distance, "candidates": nearest, "perimeterPx": perimeter}


def arc_boundary_value(point, center, radius, start_angle, sweep_angle):
    """Angles in radians, mathematical y-up. Only ordinary, non-full boundary arcs."""
    tau = 2 * math.pi
    if radius <= 1e-10 or not 0 < abs(sweep_angle) < tau:
        return unsupported("arc-degenerate-or-full-unverified")
    dx, dy = point[0] - center[0], center[1] - point[1]
    if math.hypot(dx, dy) <= BOUNDARY_PX:
        return unsupported("arc-center-nearest-value-ambiguous")
    radial_error = abs(math.hypot(dx, dy) - radius)
    if radial_error > BOUNDARY_PX:
        return unsupported("arc-off-boundary-nearest-rule-unverified", radialErrorPx=radial_error)
    angle = math.atan2(dy, dx)
    # Compare positions at t=0/1 first: atan2 and modulo must not turn B into 0.
    at = lambda a: [center[0] + radius * math.cos(a), center[1] - radius * math.sin(a)]
    endpoint_values = [t for t in (0.0, 1.0)
                       if math.dist(point, at(start_angle + t * sweep_angle)) <= BOUNDARY_PX]
    if len(endpoint_values) > 1:
        return unsupported("arc-endpoint-logical-value-ambiguous")
    if endpoint_values:
        return {"status": "ok", "value": endpoint_values[0], "endpoint": True}
    delta = ((angle - start_angle) if sweep_angle > 0 else (start_angle - angle)) % tau
    t = delta / abs(sweep_angle)
    if not 0 <= t <= 1:
        return unsupported("arc-off-sweep-nearest-rule-unverified")
    return {"status": "ok", "value": t, "endpoint": False}


def axis_ancestor(objects, index):
    """Follow the geometric source, not every dependency of a transform."""
    obj = objects[index - 1]
    c = obj["constraint"]
    if c in (58, 59, 60):
        return obj
    if c in (5, 6) and len(obj["parents"]) == 2:
        return axis_ancestor(objects, obj["parents"][1])
    if c in set(range(16, 35)) | {75} and obj["parents"]:
        return axis_ancestor(objects, obj["parents"][0])
    return None


def orientation(objects, index):
    obj = objects[index - 1]
    if obj["constraint"] in (58, 59, 60):
        d = axis_direction(obj)
        return "horizontal" if d == 1 else "vertical" if d == 0 else None
    if obj["constraint"] in (5, 6):
        o = orientation(objects, obj["parents"][1])
        return ({"horizontal": "vertical", "vertical": "horizontal"}.get(o)
                if obj["constraint"] == 5 else o)
    return None


def labeled_point(obj, objects, emf, measured, offset):
    """Bind a shown label to the immediately preceding dot, without a position hint.

    Supports a literal label or the observed base + subscript text pair A[2].
    This is deliberately conservative and is not a general text-layout recognizer.
    """
    label = obj.get("labelText")
    if not label or obj.get("labelFlags", [0, 0])[1] != 1:
        return None
    if sum(q.get("labelText") == label and q["state"] == 0
           and q.get("labelFlags", [0, 0])[1] == 1 for q in objects) != 1:
        return None
    subscript = re.fullmatch(r"([A-Za-z])\[(\d+)\]", label)
    texts = [(i, p) for i, p in enumerate(emf["primitives"]) if p["kind"] == "text"]
    candidates = []
    for n, (i, text) in enumerate(texts):
        text_indices = [i]
        if subscript:
            if text.get("text") != subscript[1] or n + 1 >= len(texts):
                continue
            j, following = texts[n + 1]
            if following.get("text") != subscript[2] or j - i > 2:
                continue
            text_indices.append(j)
        elif text.get("text") != label:
            continue
        # A filled dot, its outline, then the label. No intervening filled dot.
        dots = [p for p in measured if p["kind"] == "point" and 0 < i - p["primitiveIndex"] <= 2
                and color_for(p) == obj["color"]]
        if len(dots) != 1 or len(text.get("px96", [])) != 1:
            continue
        dot = dots[0]
        if math.dist(dot["point"], text["px96"][0]) > 32:
            continue
        candidates.append((translated(dot, offset), {"label": label, "labelTextPrimitives": text_indices,
                           "mapping": "unique_native_visible_label_and_preceding_original_dot"}))
    return candidates[0] if len(candidates) == 1 else None


def parallel_incidence_point(obj, objects, emf, measured, offset):
    """Identify a hidden-label point on a horizontal parallel by labeled incidence.

    P lies on the horizontal through a saved point. A perpendicular through P meets
    another horizontal at a labeled intersection I. Thus x(P)=x(I); no t/basis used.
    """
    if obj["constraint"] != 15 or len(obj["parents"]) != 1:
        return None
    path = objects[obj["parents"][0] - 1]
    if path["constraint"] != 6 or orientation(objects, path["objectIndex"]) != "horizontal":
        return None
    anchor = objects[path["parents"][0] - 1]
    if "savedPoint" not in anchor:
        return None
    candidates = []
    for perpendicular in objects:
        if perpendicular["constraint"] != 5 or perpendicular["parents"][0] != obj["objectIndex"]:
            continue
        base = perpendicular["parents"][1]
        if orientation(objects, base) != "horizontal":
            continue
        for intersection in objects:
            if intersection["constraint"] != 9 or set(intersection["parents"]) != {base, perpendicular["objectIndex"]}:
                continue
            bound = labeled_point(intersection, objects, emf, measured, offset)
            if bound is None:
                continue
            dot, label_provenance = bound
            # Incidence selector uses independently read I.x and the native free P0.y.
            xy = [dot["point"][0], anchor["savedPoint"][1]]
            matching = [translated(p, offset) for p in measured if p["kind"] == "point"
                        and color_for(p) == obj["color"]
                        and math.dist(translated(p, offset)["point"], xy) <= .01]
            if len(matching) == 1:
                candidates.append((matching[0], {"mapping": "unique_dot_from_native_horizontal_parallel_and_labeled_perpendicular_incidence",
                                   "matchingPredictionUsed": True, "nativeParameterPredictionUsed": False,
                                   "incidencePredictionUsed": True,
                                   "parallelObject": path["objectIndex"], "savedAnchorObject": anchor["objectIndex"],
                                   "perpendicularObject": perpendicular["objectIndex"], "horizontalBaseObject": base,
                                   "labeledIntersectionObject": intersection["objectIndex"],
                                   "intersectionPrimitiveIndex": dot["primitiveIndex"], **label_provenance}))
    if len(candidates) != 1:
        return None
    dot, provenance = candidates[0]
    # Preserve the stronger incidence mapping, rather than the inner label mapping.
    provenance["mapping"] = "unique_dot_from_native_horizontal_parallel_and_labeled_perpendicular_incidence"
    return dot, provenance


def expected_point(obj, dot, identity, emf_sha):
    """Only the original dot supplies the assertion coordinate; never the hypothesis."""
    return {"objectIndex": obj["objectIndex"], "constraint": obj["constraint"], "kind": "point",
            "exists": True, "geometry": {"x": dot["point"][0], "y": dot["point"][1]},
            "tolerancePx": .1, "provenance": {"source": "original_emf_primitive",
            "primitiveIndex": dot["primitiveIndex"], "layer": dot.get("layer"),
            "emfSha256": emf_sha, "matchingPredictionUsed": False, **identity}}


def scan_inventory(doc, source, report):
    for page in doc["pages"]:
        objects = page["objects"]
        for obj in objects:
            c, i = obj["constraint"], obj["objectIndex"]
            entry = {"source": source, "pageIndex": page["pageIndex"], "objectIndex": i, "state": obj["state"]}
            if c == 15 and obj["parents"]:
                axis = axis_ancestor(objects, obj["parents"][0])
                if axis and (axis["constraint"] in (59, 60) or objects[obj["parents"][0] - 1]["constraint"] in set(range(16, 35))):
                    report["axisPathCandidates"].append({**entry, "axisConstraint": axis["constraint"],
                        "axisObject": axis["objectIndex"], "parentConstraint": objects[obj["parents"][0] - 1]["constraint"],
                        "axisDirection": axis_direction(axis)})
            if c == 94 and objects[obj["parents"][1] - 1]["mainKind"] == 9:
                report["axisLogicalValueCandidates"].append(entry)
            if c == 61:
                raw = obj.get("coordRecord", b"")
                mode = struct.unpack_from("<H", raw)[0] if len(raw) >= 2 else None
                report["coordinateSystemModes"][str(mode)] += 1
                if mode not in (1, 2):
                    report["otherCoordinateSystemModes"].append({**entry, "recordHex": raw.hex()})
            if c == 69:
                genera = [objects[p - 1]["genera"] for p in obj["parents"][:2]]
                if any(g in (48, 49, 50) for g in genera):
                    report["unitfulPlotCandidates"].append({**entry, "coordinateParentGenera": genera})


def run(baseline_index, page_index, manifests, out_dir):
    rows, snapshots = read_manifests(manifests)
    manifest_pages = defaultdict(list)
    source_docs = {}
    for row in rows.values():
        source = row["input"].replace("\\", "/")
        if source not in source_docs:
            source_docs[source] = native_document(ROOT / source)
        if source_docs[source]["sha256"] != row["input_sha256"]:
            raise ValueError("manifest source changed: " + source)
        page_index_1 = row["pageIndex"] + 1 if "pageIndex" in row else source_docs[source]["activePageIndex"]
        manifest_pages[(source, page_index_1)].append(row)
    report = {"schema": "gsp-m5-batch3-coordinates-evidence-v1", "readings": [], "axisPointEvidence": [],
              "axisPathCandidates": [], "axisLogicalValueCandidates": [], "unitfulPlotCandidates": [],
              "coordinateSystemModes": Counter(), "otherCoordinateSystemModes": [], "counts": Counter(),
              "unitfulPlotAudit": [],
              "limits": ["No original program was started.", "No product imports or calls.",
                         "Predicted values are diagnostics only; expectations are original dots/text.",
                         "No general off-path nearest-point or multiple-logical-value rule is established.",
                         "59 horizontal evidence does not establish vertical 59 or any 60 native basis."]}
    for source, doc in source_docs.items():
        scan_inventory(doc, source, report)
    report["inventoryInputFiles"] = len(source_docs)
    report["inventoryPages"] = sum(len(d["pages"]) for d in source_docs.values())
    report["inventoryPageObjects"] = sum(len(p["objects"]) for d in source_docs.values() for p in d["pages"])
    indexed_cases, seen = [], set()
    for index in (baseline_index, page_index):
        if index is None:
            continue
        for row in json.loads(index.read_text(encoding="utf8"))["cases"]:
            case = json.loads((index.parent / row["case"]).read_text(encoding="utf8"))
            key = (case["source"]["path"], case["pageIndex"])
            if key not in seen:
                indexed_cases.append((case, index, row["case"]))
                seen.add(key)
    out_dir.mkdir(parents=True, exist_ok=True)
    output_cases = []
    supported_counts = Counter()
    for case, input_index, input_name in indexed_cases:
        source, pi = case["source"]["path"], case["pageIndex"]
        doc = source_docs[source]
        if doc["sha256"] != case["source"]["sha256"]:
            raise ValueError("source changed: " + source)
        page = doc["pages"][pi - 1]
        objects = page["objects"]
        target_readings = [a for a in case["assertions"] if a["constraint"] == 94
                           and objects[objects[a["objectIndex"] - 1]["parents"][1] - 1]["constraint"] in (8, 79, 80, 81)]
        target_points = [o for o in objects if o["constraint"] == 15 and o["state"] == 0 and o["parents"]
                         and (axis_ancestor(objects, o["parents"][0]) or {}).get("constraint") in (59, 60)]
        unitful_targets = [o for o in objects if o["constraint"] == 69 and o["state"] == 0
                           and any(objects[p - 1]["genera"] in (48, 49, 50) for p in o["parents"][:2])]
        if not target_readings and not target_points and not unitful_targets:
            continue
        matching_rows = [r for r in manifest_pages[(source, pi)]
                         if r["outputs"].get("emf", {}).get("sha256") == case["oracle"]["emfSha256"]]
        if not matching_rows:
            raise ValueError("no manifest with exact original EMF identity: " + source)
        row = matching_rows[-1]
        export_state = {k: row.get(k) for k in ("busy_after_open", "animation_stop_sent", "dialogs")}
        hints, _ = predict(objects, page=page)
        unitful_ready = []
        for obj in unitful_targets:
            parents = [hints.get(p) for p in obj["parents"]]
            if not all(parents):
                report["unitfulPlotAudit"].append({"source": source, "pageIndex": pi,
                    "objectIndex": obj["objectIndex"], "status": "uncovered-parent-geometry-or-value-unavailable"})
            else:
                unitful_ready.append((obj, parents))
        if not target_readings and not target_points and not unitful_ready:
            continue
        emf_path = Path(row["outputs"]["emf"]["path"])
        emf_sha = sha_file(emf_path)
        if emf_sha != case["oracle"]["emfSha256"] or emf_sha != row["outputs"]["emf"]["sha256"]:
            raise ValueError("EMF changed: " + source)
        emf = parse_emf(emf_path.read_bytes(), with_records=False)
        if not emf["validation"]["ok"]:
            raise ValueError("invalid original EMF: " + source)
        assertions = []
        for assertion in target_readings:
            obj = objects[assertion["objectIndex"] - 1]
            point, path = [hints.get(i) for i in obj["parents"]]
            path_constraint = objects[obj["parents"][1] - 1]["constraint"]
            text_index = assertion["provenance"]["primitiveIndex"]
            primitive = emf["primitives"][text_index]
            if primitive["kind"] != "text" or assertion["measurement"]["displayNumber"] not in primitive.get("text", ""):
                raise ValueError("original text provenance no longer matches")
            if point is None or path is None:
                result = unsupported("parent-geometry-not-independently-available")
            elif path_constraint == 8 and path["kind"] == "polygon":
                result = polygon_boundary_value(point["point"], path["vertices"])
            elif path_constraint == 80 and path["kind"] == "arc":
                result = arc_boundary_value(point["point"], path["center"], path["radius"],
                                            math.radians(path["startAngle"]), math.radians(path["sweepAngle"]))
            else:
                result = unsupported("arc-parent-type-unverified")
            entry = {"source": source, "pageIndex": pi, "objectIndex": obj["objectIndex"],
                     "pathConstraint": path_constraint, "originalMeasurement": assertion["measurement"],
                     "originalText": primitive["text"], "originalTextPrimitiveIndex": text_index,
                     "emfSha256": emf_sha, "exportState": export_state, "documentModified": modified_after_open(row),
                     "parentHints": [point, path], "diagnostic": result}
            group = "94-polygon" if path_constraint == 8 else "94-arc"
            report["counts"][group + ":originalReadings"] += 1
            if result["status"] == "ok":
                measurement = assertion["measurement"]
                entry["passed"] = abs(result["value"] - measurement["displayValue"]) <= measurement["roundingTolerance"] + 1e-8
                report["counts"][group + (":passed" if entry["passed"] else ":mismatch")] += 1
                if not entry["passed"]:
                    raise ValueError("formula disagrees with original text: " + source)
                assertions.append(copy.deepcopy(assertion))
                supported_counts[group] += 1
            else:
                report["counts"][group + ":unsupported:" + result["reason"]] += 1
            report["readings"].append(entry)
        if unitful_ready:
            measured = measured_primitives(emf)
            offset, _ = fit_offset(objects, measured)
            for obj, parents in unitful_ready:
                identity = labeled_point(obj, objects, emf, measured, offset) if offset is not None else None
                diagnostic = {"source": source, "pageIndex": pi, "objectIndex": obj["objectIndex"],
                              "parentHints": parents, "exportState": export_state,
                              "status": "uncovered-identity-not-unique" if identity is None else "no-unitful-rule-established"}
                if identity:
                    dot, provenance = identity
                    diagnostic.update({"originalPoint": dot["point"], "identity": provenance,
                                       "originalCoordinateReadback": coordinates(dot["point"], parents[2]),
                                       "primitiveIndex": dot["primitiveIndex"], "emfSha256": emf_sha})
                report["unitfulPlotAudit"].append(diagnostic)
        if target_points:
            measured = measured_primitives(emf)
            offset, alignment = fit_offset(objects, measured)
            if offset is None:
                raise ValueError("cannot independently align original axis-point EMF")
            if modified_after_open(row) or row.get("busy_after_open") or row.get("animation_stop_sent") or row.get("dialogs"):
                raise ValueError("axis-point original frame state needs explicit review")
            for obj in target_points:
                axis = axis_ancestor(objects, obj["parents"][0])
                identity = (labeled_point(obj, objects, emf, measured, offset)
                            or parallel_incidence_point(obj, objects, emf, measured, offset))
                evidence = {"source": source, "pageIndex": pi, "objectIndex": obj["objectIndex"],
                            "axisObject": axis["objectIndex"], "axisConstraint": axis["constraint"],
                            "axisRecordHex": axis.get("coordRecord", b"").hex(), "axisDirection": axis_direction(axis),
                            "axisParentConstraints": [objects[p - 1]["constraint"] for p in axis["parents"]],
                            "exportState": export_state, "alignment": alignment}
                if identity is None:
                    evidence["status"] = "uncovered-identity-not-unique"
                    report["axisPointEvidence"].append(evidence)
                    continue
                dot, provenance = identity
                parent = objects[obj["parents"][0] - 1]
                base = hints.get(parent["objectIndex"])
                if base is None or axis["constraint"] != 59 or axis_direction(axis) != 1:
                    evidence["status"] = "uncovered-basis-diagnostic-unavailable"
                    report["axisPointEvidence"].append(evidence)
                    continue
                t = struct.unpack_from("<d", obj["constraintExtra"], 4)[0]
                hypothetical = [base["a"][j] + t * (base["b"][j] - base["a"][j]) for j in (0, 1)]
                error = math.dist(hypothetical, dot["point"])
                evidence.update({"status": "confirmed" if error <= .1 else "mismatch", "nativeParameter": t,
                                 "nativeParameterHypothesis": hypothetical, "originalPoint": dot["point"],
                                 "errorPx": error, "identity": provenance, "primitiveIndex": dot["primitiveIndex"],
                                 "axisUnitHint": hints[axis["objectIndex"]], "emfSha256": emf_sha})
                if error > .1:
                    raise ValueError("axis native basis hypothesis disagrees with independently bound dot")
                assertions.append(expected_point(obj, dot, provenance, emf_sha))
                supported_counts["15-axis59" if parent["constraint"] == 59 else "15-parallel-axis59"] += 1
                report["axisPointEvidence"].append(evidence)
        if assertions:
            name = hashlib.sha256((source + "#" + str(pi)).encode()).hexdigest()[:16] + ".json"
            derived = {"schema": "gsp-m2-oracle-case-v1", "source": case["source"], "pageIndex": pi,
                       "pageCount": case["pageCount"], "oracle": case["oracle"], "assertions": assertions,
                       "excluded": [], "coverage": {"assertedObjects": len(assertions)},
                       "subsetOf": {"index": str(input_index.relative_to(ROOT)), "case": input_name,
                                    "additionalOriginalDots": sum(a["kind"] == "point" for a in assertions)}}
            (out_dir / name).write_text(json.dumps(derived, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
            output_cases.append({"case": name, "source": case["source"], "pageIndex": pi,
                                 "assertionCount": len(assertions)})
    report["supportedAssertions"] = dict(supported_counts)
    report["reusedR5OriginalTextAssertions"] = sum(supported_counts[g] for g in ("94-polygon", "94-arc"))
    report["newOriginalDotAssertions"] = sum(supported_counts[g] for g in ("15-axis59", "15-parallel-axis59"))
    report["baselineIndexUnchanged"] = {"path": str(baseline_index.relative_to(ROOT)), "sha256": sha_file(baseline_index)}
    report["counts"] = dict(report["counts"])
    report["coordinateSystemModes"] = dict(report["coordinateSystemModes"])
    index = {"schema": "gsp-m2-oracle-index-v1", "generator": "tools/m5_batch3_coords.py",
             "generatorSha256": sha_file(Path(__file__)), "cases": output_cases,
             "assertionsBySubset": dict(supported_counts), "manifestSnapshots": snapshots,
             "readOnlyBaseline": {"path": str(baseline_index.relative_to(ROOT)), "sha256": sha_file(baseline_index)},
             "newOriginalDotAssertions": report["newOriginalDotAssertions"],
             "reusedR5OriginalTextAssertions": report["reusedR5OriginalTextAssertions"], "fullM5Accepted": False}
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    (out_dir / "evidence.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: report[k] for k in ("counts", "supportedAssertions", "newOriginalDotAssertions",
                                            "reusedR5OriginalTextAssertions", "coordinateSystemModes")}, ensure_ascii=False))
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline-index", type=Path, default=ROOT / "oracle/m5-cases-r5/index.json")
    ap.add_argument("--page-index", type=Path, default=ROOT / "oracle/m4-pages-cases/index.json")
    ap.add_argument("--manifest", action="append", type=Path)
    ap.add_argument("--out-dir", type=Path, default=ROOT / "oracle/m5-batch3-coordinates")
    args = ap.parse_args()
    manifests = args.manifest or [ROOT / "oracle/full/manifest.jsonl", ROOT / "oracle/pages-batch1/manifest.jsonl",
                                 ROOT / "oracle/pages-example46/manifest.jsonl"]
    run(args.baseline_index.resolve(), args.page_index.resolve(), manifests, args.out_dir.resolve())
