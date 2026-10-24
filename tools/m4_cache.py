#!/usr/bin/env python3
"""Build per-file caches of measured EMF primitives + fitted translation (local analysis aid).

Usage: python tools/m4_cache.py --out DIR [--max-emf-bytes N]
Never launches Sketchpad; reads oracle/full exports only."""
from __future__ import annotations
import argparse, hashlib, pickle, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from m4_common import *


def cache_name(rel):
    return hashlib.sha256(rel.encode("utf-8")).hexdigest()[:16] + ".pkl"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-emf-bytes", type=int, default=50_000_000)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    done = 0
    for rel, row in sorted(rows().items()):
        target = args.out / cache_name(rel)
        if target.exists():
            continue
        try:
            L = load(rel, args.max_emf_bytes)
        except Exception as exc:  # keep going; record the failure
            pickle.dump({"rel": rel, "error": str(exc)}, open(target, "wb"))
            continue
        pickle.dump({"rel": rel, "offset": L["offset"], "measured": L["measured"], "html": L["html"],
                     "active": L["doc"]["activePageIndex"], "emf": bool(L["emf"])}, open(target, "wb"))
        done += 1
        if done % 50 == 0:
            print(done, flush=True)
    print("done", done)


if __name__ == "__main__":
    main()
