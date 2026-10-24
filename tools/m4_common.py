"""Shared helpers for the W2 arc / transform analysis scripts (offline, never launches Sketchpad)."""
from __future__ import annotations
import json, math, struct, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from emf_match import (ROOT, native_document, parse_html, bind_html, measured_primitives, fit_offset,
                       read_manifests, translated, add, sub, mul, distance)
from emf_dump import parse_emf

_ROWS = None


def rows():
    global _ROWS
    if _ROWS is None:
        _ROWS, _ = read_manifests([ROOT / "oracle/full/manifest.jsonl"])
    return _ROWS


def load(rel, max_emf=50_000_000):
    """Return dict(doc, page, objects, emf, offset, html) for an exported corpus file."""
    row = rows()[rel]
    doc = native_document(ROOT / rel)
    page = doc["pages"][doc["activePageIndex"] - 1]
    objs = page["objects"]
    emfp = row["outputs"].get("emf", {}).get("path")
    emf = None
    offset = None
    measured = []
    if emfp and Path(emfp).is_file() and Path(emfp).stat().st_size <= max_emf:
        emf = parse_emf(Path(emfp).read_bytes(), with_records=False)
        measured = measured_primitives(emf)
        offset, info = fit_offset(objs, measured)
    html = parse_html(Path(row["outputs"]["html"]["path"])) if row["outputs"].get("html", {}).get("path") else None
    return {"rel": rel, "doc": doc, "page": page, "objects": objs, "emf": emf, "offset": offset, "html": html,
            "measured": measured}


def _key(p):
    return (round(p[0] / 0.2), round(p[1] / 0.2))


def fit_offset_scored(objects, measured, hints, min_score=3, margin=1):
    """Analysis-only fallback translation fit (NOT used for assertions).

    Candidates come from (free point, red dot) pairs; each is scored by how many predicted
    points / circles / segments find a measured primitive. Returns (offset, score, runner_up)."""
    dots = [p for p in measured if p["kind"] == "point"]
    circles = [p for p in measured if p["kind"] in ("circle", "disk")]
    edges = [p for p in measured if p["kind"] == "edge"]
    anchors = [o for o in objects if "savedPoint" in o and o["state"] != 4]
    cands = {}
    for o in anchors:
        for p in dots:
            if o["color"].lower() != ((p.get("brush") or {}).get("color") or "").lower():
                continue
            off = sub(o["savedPoint"], p["point"])
            cands.setdefault((round(off[0] / 0.05), round(off[1] / 0.05)), off)
    if not cands:
        return None, 0, 0
    pts = [h["point"] for h in hints.values() if h["kind"] == "point"]
    cir = [h for h in hints.values() if h["kind"] == "circle"]
    seg = [h for h in hints.values() if h["kind"] == "segment"]
    dotset = {}
    for p in dots:
        dotset.setdefault((round(p["point"][0] / 0.25), round(p["point"][1] / 0.25)), []).append(p["point"])

    def has_dot(q):
        cx, cy = round(q[0] / 0.25), round(q[1] / 0.25)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for r in dotset.get((cx + dx, cy + dy), ()):
                    if distance(r, q) <= 0.1:
                        return True
        return False

    scored = []
    for off in cands.values():
        s = 0
        seen = set()
        for q in pts:
            k = (round(q[0], 2), round(q[1], 2))
            if k in seen:
                continue
            seen.add(k)
            if has_dot(sub(q, off)):
                s += 1
        for h in cir:
            c = sub(h["center"], off)
            for m in circles:
                if distance(c, m["center"]) <= 0.1 and abs(h["radius"] - m["radius"]) <= 0.1:
                    s += 1
                    break
        for h in seg:
            if any(v is None for v in (*h["a"], *h["b"])):
                continue
            a, b = sub(h["a"], off), sub(h["b"], off)
            for m in edges:
                if any(v is None for v in (*m["a"], *m["b"])):
                    continue
                if (distance(a, m["a"]) <= 0.1 and distance(b, m["b"]) <= 0.1) or (distance(a, m["b"]) <= 0.1 and distance(b, m["a"]) <= 0.1):
                    s += 1
                    break
        scored.append((s, off))
    scored.sort(key=lambda t: -t[0])
    best = scored[0]
    second = scored[1][0] if len(scored) > 1 else 0
    if best[0] >= min_score and best[0] - second >= margin:
        return best[1], best[0], second
    return None, best[0], second
