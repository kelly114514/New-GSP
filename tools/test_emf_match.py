#!/usr/bin/env python3
"""Focused safety tests for the oracle matcher (not geometry implementation tests)."""
import json
from pathlib import Path
import tempfile
import unittest

from emf_match import fit_offset, bind_html, parse_html, read_manifests
from emf_match import circle_circle_root, linear_circle_root


class IntersectionPredictionTests(unittest.TestCase):
    """The root rules must match cards 11-14, otherwise a prediction picks the wrong primitive."""

    def test_line_circle_prefers_smaller_or_larger_parameter(self):
        line = {"kind": "line", "a": [0, 0], "b": [10, 0]}
        circle = {"kind": "circle", "center": [5, 0], "radius": 3}
        small = linear_circle_root(line, circle, prefer_smaller=True)
        large = linear_circle_root(line, circle, prefer_smaller=False)
        self.assertAlmostEqual(small[0], 2, places=9)
        self.assertAlmostEqual(large[0], 8, places=9)

    def test_line_circle_falls_back_when_preferred_root_leaves_the_parent(self):
        # 线段只覆盖 t∈[0,1]：t≈1.1 的根在范围外，12 必须回退到另一个根。
        segment = {"kind": "segment", "a": [0, 0], "b": [10, 0]}
        circle = {"kind": "circle", "center": [8, 0], "radius": 3}
        self.assertAlmostEqual(linear_circle_root(segment, circle, prefer_smaller=True)[0], 5, places=9)
        self.assertAlmostEqual(linear_circle_root(segment, circle, prefer_smaller=False)[0], 5, places=9)
        # 射线朝 +x，两交点都在起点后方：没有候选，不能硬取一个。
        behind = {"kind": "ray", "a": [0, 0], "b": [1, 0]}
        self.assertIsNone(linear_circle_root(behind, {"kind": "circle", "center": [-5, 0], "radius": 3}, True))
        self.assertIsNone(linear_circle_root(behind, {"kind": "circle", "center": [-5, 0], "radius": 3}, False))

    def test_circle_circle_branches_are_mirror_images(self):
        first = {"kind": "circle", "center": [0, 0], "radius": 5}
        second = {"kind": "circle", "center": [6, 0], "radius": 5}
        upper = circle_circle_root(first, second, prefer_first=True)
        lower = circle_circle_root(first, second, prefer_first=False)
        self.assertAlmostEqual(upper[0], 3, places=9)
        self.assertAlmostEqual(upper[1], -4, places=9)
        self.assertAlmostEqual(lower[0], 3, places=9)
        self.assertAlmostEqual(lower[1], 4, places=9)
        self.assertIsNone(circle_circle_root(first, {"kind": "circle", "center": [0, 0], "radius": 1}, True))
        self.assertIsNone(circle_circle_root(first, {"kind": "circle", "center": [20, 0], "radius": 1}, True))


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
