#!/usr/bin/env python3
"""Offline survey behind the arc (79-83) and transform (16-34, 75) cards. Never launches Sketchpad.

Subcommands
  match IDS [--cache DIR] [--out PKL]
        predict each object of the listed constraints, find the unique measured EMF primitive and print
        match/miss counts. The cache is built by `tools/m4_cache.py`. Offsets are the conservative
        free-point vote ("vote") or, when that is ambiguous, an analysis-only scored fit ("scored");
        only "vote" belongs in committed assertions.
  arcmeta   stats of computable 79/80/81 parents over every page of every file
            (|OA|-|OB|, endpoints off the circle, circumradius, zero sweeps)
  payload   2003 consistency of 21/24/27 (direction pair vs angle value and unit) and the distance
            fields of 17/18/19/21/22/23 (pixel vs unit value)
  htmlnum   compare HTML transform numbers with the decoded 2003 parameters
  state     cross-tabulate object state with HTML `hidden` on uniquely bound objects
"""
from __future__ import annotations

import argparse
import math
import pickle
import struct
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m4_common import *  # noqa: E402,F401
import m4_transforms as T  # noqa: E402
import emf_match  # noqa: E402
from emf_match import predict, match_error, color_for, bind_html, parse_html, circumcircle, ccw_between  # noqa: E402
from m4_cache import cache_name  # noqa: E402


def cmd_match(args):
    ids = {int(x) for x in args.ids.split(",")}
    T.C_VERIFIED.update(i for i in ids if 16 <= i <= 34 or i == 75)
    results = []
    for rel in sorted(rows()):
        cp = args.cache / cache_name(rel)
        if not cp.exists():
            continue
        cached = pickle.load(open(cp, "rb"))
        if "error" in cached or not cached["emf"]:
            continue
        try:
            doc = native_document(ROOT / rel)
        except Exception:
            continue
        objs = doc["pages"][doc["activePageIndex"] - 1]["objects"]
        if not any(o["constraint"] in ids for o in objs):
            continue
        hints, elig = predict(objs)
        offset, how = cached["offset"], "vote"
        if offset is None:
            offset, _, _ = fit_offset_scored(objs, cached["measured"], hints)
            how = "scored"
        if offset is None:
            results.append((rel, None, "nooffset", sum(o["constraint"] in ids for o in objs)))
            continue
        measured = [translated(p, offset) for p in cached["measured"]
                    if not any(v is None for k in ("point", "a", "b", "center") if k in p for v in p[k])]
        for o in objs:
            c, i = o["constraint"], o["objectIndex"]
            if c not in ids:
                continue
            if i not in hints:
                results.append((rel, i, "nohint", c, o["mainKind"], elig.get(i), o["state"]))
                continue
            g = hints[i]
            best, best_p = math.inf, None
            for p in measured:
                if p["kind"] != {"segment": "edge", "line": "edge"}.get(g["kind"], g["kind"]):
                    continue
                e = match_error(g, p)
                if e < best:
                    best, best_p = e, p
            ok = best <= 0.075
            colour = ok and (color_for(best_p) or "").lower() == o["color"].lower()
            results.append((rel, i, "match" if ok else "miss", c, o["mainKind"], g["kind"], o["state"], colour, best, how,
                            tuple((hints.get(q) or {}).get("kind") for q in o["parents"]),
                            g.get("sweepAngle"), g.get("radius")))
    if args.out:
        pickle.dump(results, open(args.out, "wb"))
    count = Counter()
    for r in results:
        if r[2] == "nooffset":
            count[("nooffset",)] += r[3]
        elif r[2] == "nohint":
            count[(r[3], "nohint", r[5])] += 1
        else:
            # (constraint, geometry kind, match|miss, visible and colour agrees)
            count[(r[3], r[5], r[2], r[6] == 0 and r[7])] += 1
    for k, v in sorted(count.items(), key=str):
        print(k, v)


def cmd_arcmeta(_):
    stats = Counter()
    worst = {"80 |OA|-|OB|": 0.0, "79 endpoint off circle": 0.0, "81 circumradius": 0.0}
    zero = []
    for rel in sorted(rows()):
        try:
            doc = native_document(ROOT / rel)
        except Exception:
            continue
        for page in doc["pages"]:
            objs = page["objects"]
            if not any(o["constraint"] in (79, 80, 81) for o in objs):
                continue
            hints, _ = predict(objs)
            for o in objs:
                c = o["constraint"]
                if c not in (79, 80, 81):
                    continue
                ps = [hints.get(p) for p in o["parents"]]
                if not all(ps):
                    stats[(c, "parents not computable")] += 1
                    continue
                stats[(c, "computable")] += 1
                if c == 80:
                    centre, a, b = [p["point"] for p in ps]
                    worst["80 |OA|-|OB|"] = max(worst["80 |OA|-|OB|"], abs(distance(centre, a) - distance(centre, b)))
                    if ccw_between(centre, a, b) == 0:
                        zero.append((rel, page["pageIndex"], o["objectIndex"], o["state"]))
                elif c == 79 and ps[0]["kind"] == "circle":
                    for p in ps[1:]:
                        worst["79 endpoint off circle"] = max(
                            worst["79 endpoint off circle"], abs(distance(ps[0]["center"], p["point"]) - ps[0]["radius"]))
                elif c == 81:
                    cc = circumcircle(*[p["point"] for p in ps])
                    worst["81 circumradius"] = max(worst["81 circumradius"], cc[1] if cc else math.inf)
    print(dict(stats))
    print(worst)
    print("zero-sweep 80 objects (file, page, object, state):", zero)


def cmd_payload(_):
    angle, dist = Counter(), Counter()
    fields_by_constraint = {17: [(4, 12, 20), (24, 32, 40)], 21: [(32, 40, 48)], 18: [(4, 12, 20)],
                            19: [(4, 12, 20)], 22: [(4, 12, 20)], 23: [(4, 12, 20)]}
    for rel in sorted(rows()):
        try:
            doc = native_document(ROOT / rel)
        except Exception:
            continue
        for page in doc["pages"] + doc["tools"]:
            for o in page["objects"]:
                c, p = o["constraint"], o.get("constraintExtra")
                if not p:
                    continue
                if c in (21, 24, 27):
                    a, b, th = struct.unpack_from("<ddd", p, 4)
                    unit = struct.unpack_from("<I", p, 28)[0]
                    if abs(math.hypot(a, b) - 1) > 1e-6:
                        angle[(c, "not a unit pair")] += 1
                        continue
                    value = th if unit in (1, 2) else math.degrees(th)
                    diff = (value - math.degrees(math.atan2(-a, b)) + 180) % 360 - 180
                    angle[(c, unit, "ok" if abs(diff) < 1e-6 else "mismatch")] += 1
                for fo in fields_by_constraint.get(c, []):
                    px, value = struct.unpack_from("<dd", p, fo[0])
                    unit = struct.unpack_from("<I", p, fo[2])[0]
                    dist[(c, unit, round(px / value, 3) if value else "zero")] += 1
    for k, v in sorted(angle.items(), key=str):
        print("angle", k, v)
    for k, v in sorted(dist.items(), key=str):
        print("distance", k, v)


def cmd_htmlnum(_):
    count = Counter()
    for rel in sorted(rows()):
        try:
            doc = native_document(ROOT / rel)
        except Exception:
            continue
        objs = doc["pages"][doc["activePageIndex"] - 1]["objects"]
        html_path = rows()[rel]["outputs"].get("html", {}).get("path")
        if len(objs) > 3000 or not html_path:
            continue
        # transform_numbers_agree narrows candidates inside bind_html; bind a copy without it to measure agreement.
        saved = emf_match.transform_numbers_agree
        emf_match.transform_numbers_agree = lambda obj, step, objects: True
        try:
            bound = bind_html(objs, parse_html(Path(html_path)))
        finally:
            emf_match.transform_numbers_agree = saved
        for i, step in bound.items():
            o = objs[i - 1]
            if o["constraint"] in (17, 21, 27, 30) and step.get("numbers"):
                count[(o["constraint"], saved(o, step, objs))] += 1
    print(sorted(count.items()))


def cmd_state(_):
    count = Counter()
    for rel in sorted(rows()):
        try:
            doc = native_document(ROOT / rel)
        except Exception:
            continue
        objs = doc["pages"][doc["activePageIndex"] - 1]["objects"]
        html_path = rows()[rel]["outputs"].get("html", {}).get("path")
        if len(objs) > 3000 or not html_path:
            continue
        for i, step in bind_html(objs, parse_html(Path(html_path))).items():
            count[(objs[i - 1]["state"], step["hidden"])] += 1
    print(sorted(count.items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("match")
    m.add_argument("ids")
    m.add_argument("--cache", type=Path, default=ROOT / "oracle/w2/cache2")
    m.add_argument("--out", type=Path)
    for name in ("arcmeta", "payload", "htmlnum", "state"):
        sub.add_parser(name)
    args = ap.parse_args()
    {"match": cmd_match, "arcmeta": cmd_arcmeta, "payload": cmd_payload, "htmlnum": cmd_htmlnum, "state": cmd_state}[args.cmd](args)


if __name__ == "__main__":
    main()
