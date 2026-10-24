#!/usr/bin/env python3
"""Focused safety tests for the oracle matcher (not geometry implementation tests)."""
import json
from pathlib import Path
import tempfile
import unittest

from emf_match import fit_offset, bind_html, parse_html, read_manifests


class MatcherTests(unittest.TestCase):
    def test_translation_requires_unique_spatial_support(self):
        objects = [{"objectIndex": 1, "savedPoint": [101, 55], "color": "#ff0000", "state": 0},
                   {"objectIndex": 2, "savedPoint": [211, 175], "color": "#ff0000", "state": 0}]
        dots = [{"primitiveIndex": 2, "kind": "point", "point": [1, 5], "brush": {"color": "#ff0000"}},
                {"primitiveIndex": 4, "kind": "point", "point": [111, 125], "brush": {"color": "#ff0000"}}]
        shift, info = fit_offset(objects, dots)
        self.assertEqual(shift, [100, 50])
        self.assertEqual(info["anchorCount"], 2)
        repeated = dots + [{**d, "primitiveIndex": d["primitiveIndex"] + 10,
                            "point": [d["point"][0] + 300, d["point"][1]]} for d in dots]
        self.assertIsNone(fit_offset(objects, repeated)[0])

    def test_html_graph_mapping_does_not_assume_matching_indices_or_direction(self):
        objects = [{"objectIndex": 1, "constraint": 0, "savedPoint": [100, 200], "parents": []},
                   {"objectIndex": 2, "constraint": 0, "savedPoint": [150, 260], "parents": []},
                   {"objectIndex": 3, "constraint": 2, "parents": [1, 2]}]
        html = {"steps": [{"step": 17, "type": "Point", "point": [105, 201]},
                          {"step": 31, "type": "Point", "point": [155, 261]},
                          {"step": 42, "type": "Segment", "parents": [31, 17]}]}
        bound = bind_html(objects, html)
        self.assertEqual({i: s["step"] for i, s in bound.items()}, {1: 17, 2: 31, 3: 42})
        objects.append({"objectIndex": 4, "constraint": 0, "savedPoint": [100, 200], "parents": []})
        bound = bind_html(objects, html)
        self.assertNotIn(1, bound)
        self.assertNotIn(3, bound)
        self.assertNotIn(4, bound)

    def test_html_space_in_constructor_and_hidden_token(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "x.htm"
            p.write_text('{9} Point on object(4,0.125)[red,hidden,mediumPoint];\n', encoding="utf-8")
            parsed = parse_html(p)["steps"][0]
            self.assertEqual(parsed["type"], "Point on object")
            self.assertEqual(parsed["parents"], [4])
            self.assertEqual(parsed["pathParameter"], 0.125)
            self.assertTrue(parsed["hidden"])

    def test_concurrent_manifest_tail_is_ignored_but_complete_bad_line_is_error(self):
        row = json.dumps({"input": "samples/baseline/samples/point.gsp", "status": "ok"}).encode()
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "manifest.jsonl"
            p.write_bytes(row + b"\n" + b'{"input":"\xe4\xb8')
            rows, snapshot = read_manifests([p])
            self.assertEqual(len(rows), 1)
            self.assertTrue(snapshot[0]["incompleteTrailingLineIgnored"])
            p.write_bytes(row + b"\n" + b"malformed complete line\n")
            with self.assertRaisesRegex(ValueError, "complete manifest line"):
                read_manifests([p])


if __name__ == "__main__":
    unittest.main()
