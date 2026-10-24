#!/usr/bin/env python3
"""Compare original-derived M2 assertions with core geometry JSON. No oracle launch.

Use --case CASE --actual JSON, or --index INDEX --runner node adapter.mjs {input}.
The runner receives GSP_M2_OPERATION (JSON) for a drag case, and emits ONLY the
gsp-core-geometry-v1 JSON on stdout. It must read and evaluate the actual input.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def line_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    return abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / n if n > 1e-12 else math.inf


def finite_geometry(value):
    if isinstance(value, bool):
        return False
    if isinstance(value, (float, int)):
        return math.isfinite(value)
    if isinstance(value, list):
        return bool(value) and all(finite_geometry(x) for x in value)
    if isinstance(value, dict):
        return bool(value) and all(finite_geometry(x) for x in value.values())
    return False


def geometry_error(kind, expected, actual):
    if not finite_geometry(actual):
        return math.inf
    try:
        if kind == "point":
            return distance([expected["x"], expected["y"]], [actual["x"], actual["y"]])
        if kind == "segment":
            return min(max(distance(expected["a"], actual["a"]), distance(expected["b"], actual["b"])),
                       max(distance(expected["a"], actual["b"]), distance(expected["b"], actual["a"])))
        if kind in ("circle", "disk"):
            if actual["radius"] < 0:
                return math.inf
            return max(distance(expected["center"], actual["center"]), abs(expected["radius"] - actual["radius"]))
        if kind == "line":
            return max(line_distance(expected["a"], actual["a"], actual["b"]),
                       line_distance(expected["b"], actual["a"], actual["b"]))
        if kind == "ray":
            if distance(actual["a"], actual["b"]) < 1e-12:
                return math.inf
            d = [actual["b"][j] - actual["a"][j] for j in (0, 1)]
            if any(sum((expected[k][j] - actual["a"][j]) * d[j] for j in (0, 1)) < -0.01 for k in ("a", "b")):
                return math.inf
            return max(line_distance(expected["a"], actual["a"], actual["b"]),
                       line_distance(expected["b"], actual["a"], actual["b"]))
        if kind == "polygon":
            a, b = expected["vertices"], actual["vertices"]
            if len(a) != len(b) or not a:
                return math.inf
            n = len(a)
            return min(max(distance(a[j], seq[(i + j) % n]) for j in range(n))
                       for seq in (b, list(reversed(b))) for i in range(n))
    except (KeyError, IndexError, TypeError, ValueError):
        return math.inf
    return math.inf


def compare(case, actual):
    if not isinstance(actual, dict) or actual.get("schema") != "gsp-core-geometry-v1":
        raise ValueError("actual schema must be gsp-core-geometry-v1")
    pages = [p for p in actual.get("pages", []) if p.get("pageIndex") == case["pageIndex"]]
    if len(pages) != 1:
        raise ValueError("missing or duplicate pageIndex")
    items = pages[0].get("objects", [])
    objects = {o["objectIndex"]: o for o in items}
    if len(items) != len(objects):
        raise ValueError("duplicate objectIndex")
    results = []
    if "expectedObjectCount" in case:
        results.append({"check": "objectCount", "passed": len(items) == case["expectedObjectCount"],
                        "expected": case["expectedObjectCount"], "actual": len(items)})
    for assertion in case["assertions"]:
        obj = objects.get(assertion["objectIndex"])
        error = math.inf
        if obj and obj.get("exists") is True and obj.get("kind") == assertion["kind"]:
            error = geometry_error(assertion["kind"], assertion["geometry"], obj.get("geometry"))
        results.append({"objectIndex": assertion["objectIndex"], "kind": assertion["kind"],
                        "passed": error <= assertion["tolerancePx"], "errorPx": error if math.isfinite(error) else None,
                        "reason": None if math.isfinite(error) else "missing_wrong_kind_nonexistent_or_invalid_geometry"})
    excluded = case.get("coverage", {}).get("excludedAObjects", len(case.get("excluded", [])))
    other = sum(p.get("AObjects", 0) for p in case.get("otherPages", []))
    return {"source": case["source"]["path"], "pageIndex": case["pageIndex"], "operation": case.get("operation"),
            "passed": sum(r["passed"] for r in results), "failed": sum(not r["passed"] for r in results),
            "assertedObjects": len(case["assertions"]), "uncoveredAObjects": excluded + other,
            "styleAndLabelsCovered": False, "fullM2Accepted": False, "results": results}


def verify_source(case):
    path = ROOT / case["source"]["path"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != case["source"]["sha256"]:
        raise ValueError("source SHA-256 mismatch: " + str(path))
    return path


def run_case(case, runner, timeout):
    source = verify_source(case)
    env = dict(os.environ)
    env["GSP_M2_OPERATION"] = json.dumps(case.get("operation"), separators=(",", ":"))
    argv = [arg.replace("{input}", str(source)) for arg in runner]
    proc = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    if proc.returncode:
        raise ValueError(f"runner exited {proc.returncode}: {proc.stderr[-1000:]}")
    return json.loads(proc.stdout)


def self_test():
    """Exercise rejection paths and committed original baseline integrity; no impl import."""
    p = ROOT / "spec/acceptance/m2/baseline-midpoint.json"
    case = json.loads(p.read_text(encoding="utf-8"))
    verify_source(case)
    objects = [{"objectIndex": a["objectIndex"], "exists": True, "kind": a["kind"], "geometry": dict(a["geometry"])} for a in case["assertions"]]
    actual = {"schema": "gsp-core-geometry-v1", "pages": [{"pageIndex": 1, "objects": objects}]}
    assert compare(case, actual)["failed"] == 0
    objects[3]["geometry"]["x"] += 1
    assert compare(case, actual)["failed"] == 1
    objects[3]["geometry"]["x"] = float("nan")
    assert compare(case, actual)["failed"] == 1
    objects[3]["exists"] = False
    assert compare(case, actual)["failed"] == 1
    assert geometry_error("segment", {"a": [0, 0], "b": [3, 4]}, {"a": [3, 4], "b": [0, 0]}) == 0
    assert math.isinf(geometry_error("line", {"a": [0, 0], "b": [3, 4]}, {"a": [0, 0], "b": [0, 0]}))
    index = json.loads((p.parent / "baseline-index.json").read_text(encoding="utf-8"))
    for item in index["cases"]:
        fixture = json.loads((p.parent / item["case"]).read_text(encoding="utf-8"))
        verify_source(fixture)
        assert fixture["baselineGeometryComplete"]
        assert len(fixture["assertions"]) == fixture["expectedObjectCount"]
        assert not fixture["excluded"]
        if fixture["assertions"]:
            assert fixture["oracle"]["emfSha256"]
            assert all(a["provenance"]["source"] == "original_emf_primitive" for a in fixture["assertions"])
    print("M2 comparator rejection paths and 6 original baseline fixture identities PASS; this is not core acceptance")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    select = parser.add_mutually_exclusive_group(required=True)
    select.add_argument("--case", type=Path)
    select.add_argument("--index", type=Path)
    select.add_argument("--self-test", action="store_true")
    parser.add_argument("--actual", type=Path)
    parser.add_argument("--actual-dir", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--require-full", action="store_true")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--runner", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.case:
        paths = [args.case]
    else:
        index = json.loads(args.index.read_text(encoding="utf-8"))
        paths = [args.index.parent / x["case"] for x in index["cases"]]
    results = []
    for path in paths:
        case = json.loads(path.read_text(encoding="utf-8"))
        try:
            if args.runner:
                actual = run_case(case, args.runner, args.timeout)
            elif args.actual or args.actual_dir:
                verify_source(case)
                actual_path = args.actual or args.actual_dir / path.name
                actual = json.loads(actual_path.read_text(encoding="utf-8"))
            else:
                parser.error("--actual, --actual-dir or --runner is required")
            results.append(compare(case, actual))
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            results.append({"source": case["source"]["path"], "passed": 0, "failed": 1,
                            "uncoveredAObjects": case["coverage"]["activePageAObjects"], "error": str(exc)})
    report = {"schema": "gsp-m2-acceptance-report-v1", "cases": len(results),
              "passedChecks": sum(r["passed"] for r in results), "failedChecks": sum(r["failed"] for r in results),
              "uncoveredAObjects": sum(r["uncoveredAObjects"] for r in results),
              "fullM2Accepted": False, "results": results}
    content = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(content, encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "results"}, ensure_ascii=False))
    if report["failedChecks"]:
        sys.exit(1)
    if args.require_full and (report["uncoveredAObjects"] or not report["fullM2Accepted"]):
        sys.exit(2)


if __name__ == "__main__":
    main()
