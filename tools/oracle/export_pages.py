"""Export explicitly selected pages through the original application.

Only the active-page u16 in a disposable input copy is changed. The original
document, geometry, preferences and source hash remain untouched. This avoids
screen coordinates and keeps the saved canvas size used by the normal oracle.
Page indices in the manifest are zero based; CLI page numbers are one based.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import gsp_oracle as oracle


def document_pages(raw):
    if len(raw) < 40 or raw[:4] != b"GSP4":
        raise ValueError("not a GSP4 document")
    size, kind = struct.unpack_from("<II", raw, 4)
    if (size, kind) != (28, 900):
        raise ValueError("unexpected document header")
    layout, count = struct.unpack_from("<HH", raw, 12)
    active, = struct.unpack_from("<H", raw, 28)
    if layout not in (4, 5) or count < 1 or active >= count:
        raise ValueError("invalid page header")
    # Verify the declared count against record boundaries before modifying bytes.
    pos, actual = 4, 0
    while pos < len(raw):
        if pos + 8 > len(raw):
            raise ValueError("truncated record header")
        length, record_kind = struct.unpack_from("<II", raw, pos)
        pos += 8 + length
        pos += pos % 2
        if pos > len(raw):
            raise ValueError("truncated record payload")
        actual += record_kind == 1000
    if actual != count:
        raise ValueError("page count mismatch")
    return count, active


def select_page(raw, index):
    count, _ = document_pages(raw)
    if index < 0 or index >= count:
        raise ValueError("page index out of range")
    copy = bytearray(raw)
    struct.pack_into("<H", copy, 28, index)
    return bytes(copy)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", required=True, help="input path, glob, or text list")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--pages", default="all", help="all, inactive, or comma separated 1-based numbers")
    ap.add_argument("--max-pages", type=int, default=0)
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--keep-work-files", action="store_true", required=True)
    args = ap.parse_args(argv)
    out = Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    manifest = out / "manifest.jsonl"
    if manifest.exists() and not args.resume:
        ap.error("existing manifest: use --resume or a new output directory")
    done = {}
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            done[(row["input"], row["pageIndex"])] = row
    jobs = []
    for source in oracle.expand_list(args.list, oracle.REPO):
        raw = source.read_bytes()
        count, active = document_pages(raw)
        if args.pages in ("all", "inactive"):
            indices = range(count)
        else:
            indices = sorted({int(n) - 1 for n in args.pages.split(",")})
        rel = oracle.rel_of(source, oracle.REPO)
        digest = hashlib.sha256(raw).hexdigest()
        for index in indices:
            if not 0 <= index < count:
                ap.error(f"invalid page {index + 1} for {rel}")
            if args.pages == "inactive" and index == active:
                continue
            prior = done.get((rel, index), {})
            if (args.resume and prior.get("status") == "ok"
                    and prior.get("input_sha256") == digest
                    and all(k in prior.get("outputs", {}) for k in ("emf", "html"))
                    and all(not v.get("produced", True)
                            or Path(v.get("path", "")).is_file()
                            for v in prior.get("outputs", {}).values())):
                continue
            jobs.append((source, rel, raw, digest, count, active, index))
    if args.max_pages:
        jobs = jobs[:args.max_pages]
    print(f"Selected {len(jobs)} page exports", flush=True)
    if not jobs:
        return 0
    oracle.KEEP_WORK_FILES = True
    prepared_dir = oracle.WORK / "pages"
    prepared_dir.mkdir(parents=True, exist_ok=True)
    session = oracle.Session(show="min")
    failed = False
    completed = 0
    with oracle.RunLock():
        try:
            session.start()
            for number, (source, rel, raw, digest, count, active, index) in enumerate(jobs, 1):
                # ASCII and a single extension also avoid the double .gsp save-type bug.
                prepared = prepared_dir / f"p_{digest[:16]}_{index + 1:03d}.gsp"
                prepared.write_bytes(select_page(raw, index))
                output_rel = str(Path(rel).with_suffix("")) + f"/page-{index + 1:03d}.gsp"
                row = oracle.run_job(session, prepared, output_rel, ["emf", "html"], out,
                                     args.timeout, job_no=number, shots=out / "_fail")
                row.update(input=rel, input_size=len(raw), input_sha256=digest,
                           pageIndex=index, pageCount=count, originalActivePage=active,
                           selectionMethod="temporary-copy-active-page-header",
                           prepared_input_sha256=hashlib.sha256(select_page(raw, index)).hexdigest())
                oracle.append_manifest(manifest, row)
                completed += 1
                print(f"[{number}/{len(jobs)}] {row['status']} {rel} page={index + 1}", flush=True)
                if row["status"] != "ok":
                    failed = True
                if row.get("stop_required") or not session.alive():
                    break
        finally:
            session.stop()
    return 1 if failed or completed != len(jobs) else 0


if __name__ == "__main__":
    sys.exit(main())
