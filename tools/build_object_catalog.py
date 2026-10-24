"""Build the object-type catalog for .gsp files.

Run from the repository root:

    python -I tools/build_object_catalog.py

Inputs (local only; see .gitignore):
  reference/format/recovery-object-dispatch.json  constraint rows, parent template words, genera table
  reference/features/resource-text.json           resource strings (description templates)
  original/sketchpad5/**/*.gsp                    corpus, parsed with tools/inspect_gsp.parse_records

Outputs:
  spec/objects/catalog.json   schema gsp-object-catalog-v1
  spec/objects/catalog.md     generated table; do not edit by hand

The output is deterministic: no timestamps, sorted keys and lists, LF newlines.
Structural problems in the corpus (parse stops, unclosed or nested kind 2000
records, kind 2007 without an opener) and a constraint row whose selector
bytes disagree with the stored field stop the run before anything is written.
IDs seen in the corpus but missing from the constraint table are recorded in
the JSON, not treated as errors.
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "tools"))
from inspect_gsp import parse_records  # noqa: E402

DISPATCH_REL = "reference/format/recovery-object-dispatch.json"
RESOURCE_REL = "reference/features/resource-text.json"
CORPUS_REL = "original/sketchpad5"
OUT_DIR_REL = "spec/objects"

ROW_BYTES = 112
DESC_INDEX_OFFSET = 0x18      # u16 index 12 of the 56-word constraint row
SELECTOR_OFFSET = 0x12        # byte column behind the template_selector_u16_at_12 field
DESC_RESOURCE_BASE = 4416     # description resource id = base + description template index
EXAMPLE_LIMIT = 3
OBJECT_OPEN = 2000
OBJECT_CLOSE = 2007


def to_ascii(text: str) -> str:
    """Make a message printable on any console encoding."""
    return text.encode("ascii", "backslashreplace").decode("ascii")


def sha256_of(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


def template_words(raw: list[int]) -> list[int]:
    """Raw template words up to and including the first 0 (whole list if there is no 0)."""
    if 0 in raw:
        return raw[: raw.index(0) + 1]
    return list(raw)


def scan_corpus(corpus: Path, table_ids: set[int]) -> dict:
    """Walk every .gsp file and collect kind 2000/2007 object statistics."""
    files = sorted(
        (p for p in corpus.rglob("*") if p.is_file() and p.suffix.lower() == ".gsp"),
        key=lambda p: p.relative_to(corpus).as_posix(),
    )
    anomalies: list[str] = []
    unknown: set[int] = set()
    objects = 0
    object_count: Counter = Counter()
    file_sets: dict[int, set[str]] = defaultdict(set)
    file_bytes: dict[str, int] = {}
    child_count: dict[int, Counter] = defaultdict(Counter)
    child_sizes: dict[int, dict[int, Counter]] = defaultdict(lambda: defaultdict(Counter))

    for path in files:
        rel = path.relative_to(corpus).as_posix()
        data = path.read_bytes()
        file_bytes[rel] = len(data)
        records, err = parse_records(data)
        if err is not None:
            anomalies.append(f"{rel}: record parse stopped: {err}")
        open_at = None  # (ext_id, record index) of the currently open kind 2000
        for i, rec in enumerate(records):
            kind = rec["kind"]
            if kind == OBJECT_OPEN:
                if open_at is not None:
                    anomalies.append(f"{rel}: kind 2000 nested inside another object at record {i}")
                    continue
                if rec["payload_size"] < 2:
                    anomalies.append(f"{rel}: kind 2000 payload shorter than 2 bytes at record {i}")
                    continue
                ext = struct.unpack_from("<H", data, rec["payload_offset"])[0]
                open_at = (ext, i)
            elif kind == OBJECT_CLOSE:
                if open_at is None:
                    anomalies.append(f"{rel}: kind 2007 without an open kind 2000 at record {i}")
                    continue
                ext, start = open_at
                open_at = None
                objects += 1
                object_count[ext] += 1
                file_sets[ext].add(rel)
                if ext not in table_ids:
                    unknown.add(ext)
                for child in records[start + 1 : i]:
                    child_count[ext][child["kind"]] += 1
                    child_sizes[ext][child["kind"]][child["payload_size"]] += 1
        if open_at is not None:
            anomalies.append(f"{rel}: kind 2000 never closed (record {open_at[1]})")

    return {
        "files": len(files),
        "objects": objects,
        "object_count": object_count,
        "file_sets": file_sets,
        "file_bytes": file_bytes,
        "child_count": child_count,
        "child_sizes": child_sizes,
        "unknown": sorted(unknown),
        "anomalies": anomalies,
    }


def build_constraints(dispatch: dict, strings: dict[int, str], scan: dict) -> tuple[list[dict], list[str]]:
    templates = {
        t["index"]: t["raw_u32"]
        for t in dispatch["tables"]["parent_template_pointer_table"]["templates"]
    }
    problems: list[str] = []
    constraints: list[dict] = []
    rows = sorted(dispatch["tables"]["constraints"]["rows"], key=lambda r: r["raw_u32"][0])
    for row in rows:
        ext, main_kind, genera = row["raw_u32"][0], row["raw_u32"][1], row["raw_u32"][2]
        raw = bytes.fromhex(row["raw_hex"])
        if len(raw) != ROW_BYTES:
            problems.append(f"constraint {ext}: raw row is {len(raw)} bytes, expected {ROW_BYTES}")
            continue
        words = struct.unpack_from("<56H", raw)
        selector = row["template_selector_u16_at_12"]
        if words[SELECTOR_OFFSET // 2] != selector:
            problems.append(f"constraint {ext}: selector field {selector} differs from raw u16 at 0x12")
        desc_index = words[DESC_INDEX_OFFSET // 2]
        desc_id = DESC_RESOURCE_BASE + desc_index
        raw_template = templates.get(selector)
        # Selector 62 is outside the 62-entry pointer table (index 0..61); recorded as null.
        parent_words = template_words(raw_template) if raw_template is not None else None
        used_files = sorted(
            scan["file_sets"].get(ext, ()),
            key=lambda rel: (scan["file_bytes"][rel], rel),
        )[:EXAMPLE_LIMIT]
        counts = scan["child_count"].get(ext, Counter())
        sizes_by_kind = scan["child_sizes"].get(ext, {})
        child_records = {}
        for kind in sorted(counts):
            sizes = sizes_by_kind[kind]
            child_records[str(kind)] = {
                "count": counts[kind],
                "sizes": {str(size): sizes[size] for size in sorted(sizes)},
            }
        constraints.append({
            "ext_id": ext,
            "table_row": row["index"],
            "main_kind": main_kind,
            "genera": genera,
            "parent_template_index": selector,
            "parent_template_words": parent_words,
            "description_template_index": desc_index,
            "description_template_id": desc_id,
            "description_template": strings.get(desc_id),
            "object_count": scan["object_count"].get(ext, 0),
            "file_count": len(scan["file_sets"].get(ext, ())),
            "child_records": child_records,
            "example_files": used_files,
        })
    return constraints, problems


def md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def render_markdown(constraints: list[dict], n_files: int, n_objects: int) -> str:
    used = sum(1 for c in constraints if c["object_count"] > 0)
    lines = [
        "# 对象目录",
        "",
        "> 生成文件，请勿手工编辑。由 `tools/build_object_catalog.py` 生成，数据见同目录 `catalog.json`。",
        "",
        f"约束表 {len(constraints)} 项，语料中出现 {used} 项；语料 {n_files} 个 .gsp 文件，"
        f"{n_objects} 个对象（kind 2000）。",
        "",
        "| ext_id | main_kind | genera | 父模板词 | 对象数 | 文件数 | 描述模板 |",
        "|---:|---:|---:|---|---:|---:|---|",
    ]
    for c in constraints:
        if c["parent_template_words"] is None:
            words = f"越界（索引 {c['parent_template_index']}）"
        else:
            words = " ".join(str(w) for w in c["parent_template_words"])
        desc = c["description_template"] if c["description_template"] is not None else "（无）"
        lines.append(
            f"| {c['ext_id']} | {c['main_kind']} | {c['genera']} | {words} | "
            f"{c['object_count']} | {c['file_count']} | {md_cell(desc)} |"
        )
    return "\n".join(lines) + "\n"


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def main() -> int:
    dispatch = json.loads((ROOT / DISPATCH_REL).read_text(encoding="utf-8"))
    resource = json.loads((ROOT / RESOURCE_REL).read_text(encoding="utf-8"))
    strings: dict[int, str] = {}
    for s in resource["strings"]:
        if s["id"] in strings:
            raise SystemExit(f"duplicate resource string id {s['id']}")
        strings[s["id"]] = s["text"]

    genera_rows = sorted(dispatch["tables"]["genera_taxonomy"]["rows"], key=lambda r: r["index"])
    table_ids = {r["raw_u32"][0] for r in dispatch["tables"]["constraints"]["rows"]}
    if len(table_ids) != len(dispatch["tables"]["constraints"]["rows"]):
        raise SystemExit("duplicate external IDs in the constraint table")

    scan = scan_corpus(ROOT / CORPUS_REL, table_ids)
    constraints, problems = build_constraints(dispatch, strings, scan)
    problems = problems + scan["anomalies"]
    if problems:
        for p in problems[:50]:
            print("ERROR: " + to_ascii(p), file=sys.stderr)
        print(f"{len(problems)} problem(s) found; nothing written", file=sys.stderr)
        return 1

    catalog = {
        "schema": "gsp-object-catalog-v1",
        "generated_by": "tools/build_object_catalog.py",
        "inputs": {rel: sha256_of(rel) for rel in sorted([DISPATCH_REL, RESOURCE_REL])},
        "corpus": {"root": CORPUS_REL, "files": scan["files"], "objects": scan["objects"]},
        "constraints": constraints,
        "unknown_ext_ids_in_corpus": scan["unknown"],
        "genera_taxonomy": [{"index": r["index"], "raw_u32": r["raw_u32"]} for r in genera_rows],
    }
    out_dir = ROOT / OUT_DIR_REL
    write_text(out_dir / "catalog.json", json.dumps(catalog, ensure_ascii=False, indent=1) + "\n")
    write_text(out_dir / "catalog.md", render_markdown(constraints, scan["files"], scan["objects"]))

    used = sum(1 for c in constraints if c["object_count"] > 0)
    print(f"files {scan['files']}, objects {scan['objects']}, constraints {len(constraints)} "
          f"(used {used}), unknown ext ids {len(scan['unknown'])}")
    print(f"wrote {OUT_DIR_REL}/catalog.json and {OUT_DIR_REL}/catalog.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
