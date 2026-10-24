#!/usr/bin/env python3
"""Summarise a directory of generated M2/M4 oracle cases (counts by constraint and exclusion reason). Offline."""
from __future__ import annotations
import argparse, json
from collections import Counter, defaultdict
from pathlib import Path

A_GROUP = set(range(16)) | {63, 64, 79, 80, 81, 82, 83, 93, 98}
C_GROUP = set(range(16, 35)) | {75, 117, 118, 119}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("directory", type=Path)
    args = ap.parse_args()
    index = json.loads((args.directory / "index.json").read_text(encoding="utf-8"))
    asserted = Counter()
    excluded = defaultdict(Counter)
    for item in index["cases"]:
        case = json.loads((args.directory / item["case"]).read_text(encoding="utf-8"))
        for a in case["assertions"]:
            asserted[a["constraint"]] += 1
        for x in case["excluded"]:
            group = "C" if x["constraint"] in C_GROUP else "A"
            excluded[group][x["reason"]] += 1
            excluded[(group, x["constraint"])][x["reason"]] += 1
    out = {"cases": len(index["cases"]), "totals": index["totals"], "assertionsByConstraint": dict(sorted(asserted.items())),
           "assertionsA": sum(v for k, v in asserted.items() if k in A_GROUP),
           "assertionsC": sum(v for k, v in asserted.items() if k in C_GROUP),
           "excludedA": dict(excluded["A"].most_common()), "excludedC": dict(excluded["C"].most_common()),
           "excludedByConstraint": {f"{k[0]}{k[1]}": dict(v.most_common()) for k, v in excluded.items() if isinstance(k, tuple)},
           "corpusInventory": index.get("corpusInventory"), "corpusCoverage": index.get("corpusCoverage")}
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
