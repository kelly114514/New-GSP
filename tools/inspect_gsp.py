"""Read-only corpus inspection; never loads or executes Sketchpad code.

Run: python tools/inspect_gsp.py --root original/sketchpad5 --out <output dir>
All reported offsets are zero-based file byte offsets. No guessed semantic
field names are assigned to record types.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics
import struct


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_records(data: bytes, endian: str = "<", alignment: int = 2) -> tuple[list[dict], dict | None]:
    records = []
    offset = 4
    while offset < len(data):
        if len(data) - offset < 8:
            return records, {"offset": offset, "reason": "short_header", "remaining": len(data)-offset}
        size, kind = struct.unpack_from(endian + "II", data, offset)
        end = offset + 8 + size
        if end > len(data):
            return records, {"offset": offset, "reason": "out_of_bounds", "size": size, "kind": kind, "end": end}
        next_offset = end + (-end % alignment)
        if next_offset > len(data):
            return records, {"offset": offset, "reason": "missing_padding", "end": end}
        records.append({"offset": offset, "payload_offset": offset+8, "payload_size": size,
                        "kind": kind, "next_offset": next_offset,
                        "padding_hex": data[end:next_offset].hex()})
        offset = next_offset
    return records, None


def entropy(data: bytes) -> float:
    n = len(data)
    return -sum((c/n)*math.log2(c/n) for c in Counter(data).values()) if n else 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    root, out = args.root.resolve(), args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    files = sorted((p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".gsp"), key=lambda p: str(p.relative_to(root)))
    inventory = []
    type_counts = Counter()
    type_files = Counter()
    magic_counts = Counter()
    header_0c = Counter()
    header_0e = Counter()
    header_first_kind = Counter()
    type_sizes = defaultdict(Counter)
    type_prefixes = defaultdict(Counter)
    duplicate_hashes = defaultdict(list)
    failures = []
    alignment_failures = Counter()
    padding_values = Counter()
    be_failures = Counter()
    kinds_per_file = {}
    samples = {}
    signature_definitions = {
        "zip": b"PK\x03\x04", "gzip": b"\x1f\x8b\x08", "png": b"\x89PNG\r\n\x1a\n",
        "jpeg": b"\xff\xd8\xff", "ole": bytes.fromhex("d0cf11e0a1b11ae1"),
        "zlib_789c": b"\x78\x9c", "zlib_78da": b"\x78\xda", "zlib_7801": b"\x78\x01",
    }
    signature_files = Counter()
    for p in files:
        b = p.read_bytes()
        rel = str(p.relative_to(root))
        sha = digest(b)
        duplicate_hashes[sha].append(rel)
        magic_counts[b[:4].hex()] += 1
        h0c, h0e = struct.unpack_from("<HH", b, 12)
        header_0c[h0c] += 1
        header_0e[h0e] += 1
        records, failure = parse_records(b)
        for alignment in (1,4):
            _, align_failure = parse_records(b, alignment=alignment)
            alignment_failures[alignment] += int(align_failure is not None)
        _, be_failure = parse_records(b, ">")
        be_failures[be_failure["offset"] if be_failure else "none"] += 1
        if failure:
            failures.append({"path": rel, **failure})
        counter = Counter(r["kind"] for r in records)
        kinds_per_file[rel] = counter
        type_counts.update(counter)
        type_files.update(counter.keys())
        header_first_kind[records[0]["kind"] if records else None] += 1
        for r in records:
            kind, size = r["kind"], r["payload_size"]
            type_sizes[kind][size] += 1
            if r["padding_hex"]:
                padding_values[r["padding_hex"]] += 1
            if len(type_prefixes[kind]) < 50:
                type_prefixes[kind][b[r["payload_offset"]:r["payload_offset"]+min(size,16)].hex()] += 1
        signatures = {}
        for name, sig in signature_definitions.items():
            first = b.find(sig)
            if first >= 0:
                signatures[name] = first
                signature_files[name] += 1
        entry = {"path": rel, "absolute_path": str(p), "bytes": len(b), "sha256": sha,
                 "magic_hex": b[:4].hex(), "header_0c_u16le": h0c, "header_0e_u16le": h0e,
                 "record_count": len(records), "parse_error": failure,
                 "first_record_kind": records[0]["kind"] if records else None,
                 "last_record_kind": records[-1]["kind"] if records else None,
                 "entropy_bits_per_byte": round(entropy(b),5),
                 "signature_candidates_first_offsets": signatures}
        inventory.append(entry)
        samples[rel] = (b,records)

    representatives = []
    smallest = sorted(inventory, key=lambda e: (e["bytes"],e["path"]))[:3]
    representatives.extend(e["path"] for e in smallest)
    for value in sorted(header_0c):
        representatives.append(min((e for e in inventory if e["header_0c_u16le"]==value),key=lambda e:e["bytes"])["path"])
    for value in [2,3,max(header_0e)]:
        representatives.append(min((e for e in inventory if e["header_0e_u16le"]==value),key=lambda e:e["bytes"])["path"])
    representatives = list(dict.fromkeys(representatives))
    detailed = []
    for rel in representatives:
        b, records = samples[rel]
        selected_records = records if len(records)<=600 else [r for i,r in enumerate(records) if i<100 or i>=len(records)-30 or r["kind"] in {900,901,902,903,1000,1001,1002,1003,1006,1007}]
        detailed.append({"path": rel, "sha256": digest(b), "bytes":len(b), "header_hex": b[:40].hex(" "),
                        "record_type_counts": sorted(Counter(r["kind"] for r in records).items()),
                        "records_total":len(records),"records_shown":len(selected_records),"records_complete":len(records)==len(selected_records),
                        "records": [{**r, "payload_hex_prefix": b[r["payload_offset"]:r["payload_offset"]+min(r["payload_size"],64)].hex(" ")} for r in selected_records]})
        if rel == representatives[0]:
            lines = []
            for i in range(0,len(b),16):
                chunk=b[i:i+16]
                lines.append(f"{i:08x}  {chunk.hex(' '):47}  {''.join(chr(x) if 32<=x<127 else '.' for x in chunk)}")
            (out/"gsp-smallest.hex.txt").write_text("\n".join(lines)+"\n",encoding="utf-8")

    types = [{"kind":kind,"records":type_counts[kind],"files":type_files[kind],
              "payload_size_counts":sorted(type_sizes[kind].items()),
              "payload_prefixes_bounded_to_first_50_distinct":type_prefixes[kind]}
             for kind in sorted(type_counts)]
    summary = {
        "script_sha256":digest(Path(__file__).read_bytes()),"root":str(root),
        "count":len(files),"total_bytes":sum(e["bytes"] for e in inventory),
        "unique_sha256":len(duplicate_hashes),
        "duplicate_groups":[{"sha256":k,"paths":v} for k,v in duplicate_hashes.items() if len(v)>1],
        "min_bytes":min(e["bytes"] for e in inventory),"max_bytes":max(e["bytes"] for e in inventory),
        "median_bytes":statistics.median(e["bytes"] for e in inventory),
        "magic_counts":magic_counts,"header_0c_u16le_counts":header_0c,"header_0e_u16le_counts":header_0e,
        "record_format_hypothesis":"4-byte magic followed by repeated u32le payload_length, u32le kind, payload[payload_length], zero pad to next 2-byte boundary",
        "parse_failures":failures,"big_endian_failure_offsets":be_failures,
        "alternative_alignment_failure_counts":alignment_failures,"padding_values_counts":padding_values,
        "total_records":sum(type_counts.values()),"distinct_record_kinds":len(type_counts),
        "first_record_kind_counts":header_first_kind,
        "last_record_kind_counts":Counter(e["last_record_kind"] for e in inventory),
        "signature_files_counts":signature_files,
        "header_0e_equals_type1000_count":sum(e["header_0e_u16le"]==kinds_per_file[e["path"]][1000] for e in inventory),
        "header_0e_equals_type1001_count":sum(e["header_0e_u16le"]==kinds_per_file[e["path"]][1001] for e in inventory),
        "smallest":smallest,"largest":sorted(inventory,key=lambda e:e["bytes"],reverse=True)[:3],
        "representatives":representatives,
        "types":types,
    }
    for name, value in [("gsp-inventory.json", inventory),("gsp-summary.json",summary),("gsp-record-samples.json",detailed)]:
        (out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    compact = {k:v for k,v in summary.items() if k not in {"types","duplicate_groups","smallest","largest","parse_failures"}}
    compact["parse_failure_count"]=len(failures)
    print(json.dumps(compact,ensure_ascii=True,indent=2))
    print("most frequent kinds",type_counts.most_common(30))


if __name__ == "__main__":
    main()
