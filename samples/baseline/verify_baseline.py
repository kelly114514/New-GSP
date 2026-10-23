"""Q1 oracle inspection only; this is not the recovered document loader.

Checks the independently declared minimal graphs against original UI saves.
Run from any directory: python samples/baseline/verify_baseline.py
"""
from pathlib import Path
import hashlib
import json
import struct
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "tools"))
from inspect_gsp import parse_records


def inspect(path):
    data = path.read_bytes()
    assert data[:4] == b"GSP4", path.name
    records, error = parse_records(data)
    assert error is None, error
    assert records[0]["kind"] == 900 and records[-1]["kind"] == 901
    version, pages = struct.unpack_from("<HH", data, 12)
    assert (version, pages) == (5, 1)
    objects = []
    current = None
    page_count = 0
    for r in records:
        payload = data[r["payload_offset"]:r["payload_offset"] + r["payload_size"]]
        if r["kind"] == 1000:
            page_count += 1
            declared_objects = struct.unpack_from("<I", payload, 24)[0]
        elif r["kind"] == 2000:
            assert current is None and len(payload) == 28
            constraint, field08, field04, kind, genera, style = struct.unpack_from("<6H", payload)
            current = {"id": len(objects) + 1, "external_constraint": constraint,
                       "external_kind": kind, "external_genera": genera,
                       "field_08": field08, "field_04": field04,
                       "style_words": [(style >> shift) & 15 for shift in (0, 4, 8)],
                       "colorref": int.from_bytes(payload[12:15], "little"), "parents": []}
        elif r["kind"] == 2201:
            assert current is not None and len(payload) == 16
            current["saved_coordinates"] = list(struct.unpack("<dd", payload))
        elif r["kind"] == 2002:
            assert current is not None
            count = struct.unpack_from("<I", payload)[0]
            assert len(payload) == (count + 1) * 4
            current["parents"] = list(struct.unpack_from("<" + "I" * count, payload, 4))
        elif r["kind"] == 2007:
            assert current is not None and not payload
            objects.append(current)
            current = None
    assert current is None and page_count == 1 and declared_objects == len(objects)
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "format_version": version, "pages": page_count, "objects": objects}


def main():
    manifest = json.loads((HERE / "baseline.json").read_text(encoding="utf-8"))
    for name, expected in manifest["samples"].items():
        observed = inspect(HERE / "samples" / name)
        assert observed == expected, (name, observed, expected)
    print("minimal original baseline PASS: 5 UI-created and reopened samples; exact hashes and declared graphs")


if __name__ == "__main__":
    main()
