#!/usr/bin/env python3
"""Offline unique native/HTML binding statistics; no product code or original launch."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from emf_match import ROOT, native_document, parse_html, bind_html, read_manifests


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, action="append", required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    sources, snapshots = read_manifests(args.manifest)
    styles, visibility, labels, order = Counter(), Counter(), Counter(), defaultdict(Counter)
    examples = defaultdict(list)
    bound_count = 0
    for rel, row in sorted(sources.items()):
        hp = Path(row.get("outputs", {}).get("html", {}).get("path", ""))
        if not hp.is_file():
            continue
        doc = native_document(ROOT / rel)
        html = parse_html(hp)
        objs = doc["pages"][doc["activePageIndex"] - 1]["objects"]
        bindings = bind_html(objs, html)
        bound_count += len(bindings)
        for i, step in bindings.items():
            obj = objs[i - 1]
            words = [(obj["styleWord"] >> shift) & 15 for shift in (0, 4, 8)]
            key = (doc["layout"], obj["mainKind"], *words, ",".join(step["styleTokens"]), step["hidden"])
            styles[key] += 1
            visibility[(obj["state"], step["hidden"])] += 1
            labels[(tuple(obj.get("labelFlags", [])), step["hasLabel"], obj["state"], step["hidden"], obj.get("labelByteLength", 0) == 0, obj["mainKind"])] += 1
            if obj["parents"] and all(parent in bindings for parent in obj["parents"]) and step.get("parents"):
                parent_steps = [bindings[parent]["step"] for parent in obj["parents"]]
                kind = "same" if parent_steps == step["parents"] else "reverse" if list(reversed(parent_steps)) == step["parents"] else "other"
                order[obj["constraint"]][kind] += 1
                if len(examples[obj["constraint"]]) < 3:
                    examples[obj["constraint"]].append({"source": rel, "objectIndex": i,
                                                       "nativeParentsAsHtmlSteps": parent_steps, "htmlParents": step["parents"], "order": kind})
    result = {"schema": "gsp-m2-unique-html-observations-v1", "sourceFiles": len(sources), "uniquelyBoundObjects": bound_count,
              "manifestSnapshots": snapshots,
              "parentOrderByConstraint": {str(c): dict(v) for c, v in sorted(order.items())},
              "parentOrderExamples": {str(c): v for c, v in sorted(examples.items())},
              "styles": [{"layout": k[0], "mainKind": k[1], "w0": k[2], "w1": k[3], "w2": k[4],
                          "htmlTokens": k[5].split(",") if k[5] else [], "htmlHidden": k[6], "count": n} for k, n in sorted(styles.items())],
              "visibility": [{"nativeState": k[0], "htmlHidden": k[1], "count": n} for k, n in sorted(visibility.items())],
              "labels": [{"nativeFlags": list(k[0]), "htmlLabel": k[1], "nativeState": k[2], "htmlHidden": k[3], "nativeLabelEmpty": k[4], "mainKind": k[5], "count": n}
                         for k, n in sorted(labels.items())],
              "limitations": ["Only uniquely matched exported current-page objects; missing types/ambiguous nodes excluded.",
                              "Parent-order observations do not by themselves establish solver parameter direction.",
                              "HTML omission of a style token can indicate a default; do not infer numerical width from omission."]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sourceFiles": len(sources), "uniquelyBoundObjects": bound_count,
                      "parentOrderByConstraint": result["parentOrderByConstraint"], "visibility": result["visibility"]}))


if __name__ == "__main__":
    main()
