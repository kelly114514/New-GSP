"""Create small, authored boundary inputs; run them through the original oracle.

These are synthetic inputs, not original-UI construction evidence. Only a
baseline page environment is retained; all geometric records are authored here.
"""
import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inspect_gsp import parse_records


def record(kind, payload=b""):
    return struct.pack("<II", len(payload), kind) + payload + b"\0" * (len(payload) % 2)


def generate(destination):
    root = Path(__file__).resolve().parents[2]
    baseline = (root / "samples/baseline/samples/point.gsp").read_bytes()
    records, error = parse_records(baseline)
    if error:
        raise ValueError(error)
    start = next(r["offset"] for r in records if r["kind"] == 2000)
    end = next(r["next_offset"] for r in records if r["kind"] == 2007)
    header = baseline[start + 8:start + 36]

    def obj(constraint, main, genera, parents=(), xy=None, color=b"\x00\x80\x00"):
        h = bytearray(header)
        struct.pack_into("<H", h, 0, constraint)
        struct.pack_into("<HH", h, 6, main, genera)
        h[12:15] = color
        if main != 1:
            struct.pack_into("<H", h, 10, 0x122)
        return (record(2000, h)
                + (record(2002, struct.pack("<I" + "I" * len(parents), len(parents), *parents)) if parents else b"")
                + (record(2201, struct.pack("<dd", *xy)) if xy is not None else b"")
                + record(2007))

    def point(x, y):
        return obj(0, 1, 4, xy=(x, y), color=b"\xff\x00\x00")

    fixtures = {}
    for name, a, b in (("equal", 150, 150), ("Bfar", 150, 210), ("Afar", 210, 150)):
        fixtures["arc80-" + name] = point(300, 300) + point(300+a, 300) + point(300, 300-b) + obj(80, 12, 67, [1, 2, 3])
    fixtures["arc79-offcircle"] = point(300, 300) + point(450, 300) + point(300, 90) + obj(3, 3, 28, [1, 2]) + obj(79, 12, 67, [4, 2, 3])
    fixtures["arc79-both-offcircle"] = point(300, 300) + point(450, 300) + point(510, 300) + point(300, 90) + obj(3, 3, 28, [1, 2]) + obj(79, 12, 67, [5, 3, 4])
    for name, mid in (("normal", (450, 200)), ("collinear", (450, 300)),
                      ("outside", (650, 300)), ("nearline", (450, 299.9)),
                      ("sag036", (450, 299.64)), ("sag038", (450, 299.62))):
        fixtures["arc81-" + name] = point(300, 300) + point(*mid) + point(600, 300) + obj(81, 12, 67, [1, 2, 3])
    fixtures["transform16-drag"] = point(250, 180) + point(250, 350) + point(350, 390) + obj(16, 1, 4, [1, 2, 3], color=b"\x00\x00\xff")
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError("use an empty destination to preserve earlier evidence")
    page = next(r for r in records if r["kind"] == 1000)
    for name, objects in fixtures.items():
        data = bytearray(baseline[:start] + objects + baseline[end:])
        parsed, error = parse_records(data)
        if error:
            raise ValueError(error)
        struct.pack_into("<I", data, page["payload_offset"] + 24, sum(r["kind"] == 2000 for r in parsed))
        (destination / (name + ".gsp")).write_bytes(data)
    print(f"Created {len(fixtures)} synthetic fixtures in {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    generate(parser.parse_args().out_dir)
