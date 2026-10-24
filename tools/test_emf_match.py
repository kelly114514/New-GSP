#!/usr/bin/env python3
"""Focused safety tests for the oracle matcher (not geometry implementation tests)."""
import json
from pathlib import Path
import tempfile
import unittest

from emf_match import fit_offset, bind_html, parse_html, read_manifests
from emf_match import circle_circle_root, linear_circle_root
from emf_match import arc_error, arc_interval, bezier_region, ccw_between, circumcircle, make_arc, predict
import m4_transforms as T
import math
import struct


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


def free(index, x, y):
    return {"objectIndex": index, "constraint": 0, "mainKind": 1, "parents": [], "savedPoint": [x, y], "state": 0}


class ArcPredictionTests(unittest.TestCase):
    """Directions fixed by original EMF measurements (cards 79-83): visual counter-clockwise from A to B."""

    def test_center_arc_runs_counter_clockwise_from_first_to_second_direction(self):
        # O=(533,417) A=(809,417) B=(257,417): the drawn arc is the upper half (page y smaller), not the lower one.
        objs = [free(1, 533, 417), free(2, 809, 417), free(3, 257, 417),
                {"objectIndex": 4, "constraint": 80, "mainKind": 12, "parents": [1, 2, 3], "state": 0}]
        hints, _ = predict(objs)
        arc = hints[4]
        self.assertAlmostEqual(arc["sweepAngle"], 180.0, places=9)
        lo, hi = arc_interval(arc)
        mid = math.radians((lo + hi) / 2)
        self.assertAlmostEqual(math.sin(mid), 1.0, places=9)  # visual up
        # The complementary arc (swapped endpoints) is a mismatch even though its end points coincide.
        swapped = make_arc([533, 417], 276, [257, 417], [809, 417], ccw_between([533, 417], [257, 417], [809, 417]))
        self.assertGreater(arc_error(arc, swapped), 100)

    def test_three_point_arc_goes_through_the_middle_point_in_either_direction(self):
        a, b = [100, 100], [200, 100]
        for middle, expected_sign in (([150, 50], 1), ([150, 150], -1)):
            objs = [free(1, *a), free(2, *middle), free(3, *b),
                    {"objectIndex": 4, "constraint": 81, "mainKind": 12, "parents": [1, 2, 3], "state": 0}]
            arc = predict(objs)[0][4]
            self.assertEqual(1 if arc["sweepAngle"] > 0 else -1, expected_sign * -1)
            self.assertTrue(T.apply_matrix(T.identity(), arc) is not None)
            from emf_match import arc_contains
            self.assertTrue(arc_contains(arc, middle))
        self.assertIsNone(circumcircle([0, 0], [1, 1], [2, 2]))

    def test_path_point_on_arc_uses_the_signed_sweep_from_the_first_endpoint(self):
        objs = [free(1, 0, 0), free(2, 10, 0), free(3, 0, -10),
                {"objectIndex": 4, "constraint": 80, "mainKind": 12, "parents": [1, 2, 3], "state": 0},
                {"objectIndex": 5, "constraint": 15, "mainKind": 1, "parents": [4], "state": 0,
                 "constraintExtra": struct.pack("<HHd", 15, 0x43, 0.5)}]
        point = predict(objs)[0][5]["point"]
        self.assertAlmostEqual(point[0], 10 * math.cos(math.radians(45)), places=9)
        self.assertAlmostEqual(point[1], -10 * math.sin(math.radians(45)), places=9)

    def test_bezier_arc_region_recovers_circle_from_single_cubic(self):
        r, k = 100.0, 4 / 3 * math.tan(math.radians(90) / 4)
        # quarter arc from (r,0) to (0,r) in page coordinates, centre (50, 60)
        pts = [[150, 60], [150, 60 + k * r], [50 + k * r, 160], [50, 160]]
        region = bezier_region({"subpaths": [{"ops": [["M", [pts[0]]], ["B", pts[1:]]]}], "px96": pts})
        self.assertAlmostEqual(region["center"][0], 50, places=6)
        self.assertAlmostEqual(region["center"][1], 60, places=6)
        self.assertAlmostEqual(region["radius"], 100, places=6)
        self.assertAlmostEqual(region["sweepAngle"], 90, places=6)


class TransformPredictionTests(unittest.TestCase):
    """Conventions measured against original EMF primitives (cards 16-34)."""

    def test_rotation_positive_angle_is_visually_counterclockwise(self):
        m = T.rotation([420, 417], -90)  # -90 degrees: clockwise on screen
        x, y = T.point_map(m, [305, 417])
        self.assertAlmostEqual(x, 420, places=9)
        self.assertAlmostEqual(y, 302, places=9)  # the left point moves to the top

    def test_fixed_payload_translations_and_angle_pair(self):
        # 17: vertical distance is positive upwards, so page y decreases.
        payload = struct.pack("<I2dI2dI8s", 17, 0.0, 0.0, 1, 11.338582677165356, 0.3, 1, bytes(8))
        self.assertEqual(T.matrix_for({"constraint": 17, "constraintExtra": payload}, [{}], [])[1][1], -11.338582677165356)
        # 27 / 21 / 24: (a, b) = (-sin t, cos t) wins over the unit-dependent angle number.
        angle = struct.pack("<I3dI4s", 27, -1.0, 0.0, math.pi / 2, 0, bytes(4))
        self.assertAlmostEqual(T.stored_angle_degrees({"constraintExtra": angle}), 90.0, places=9)

    def test_dilation_reflection_and_arc_orientation(self):
        self.assertEqual(T.point_map(T.dilation([10, 10], -2), [11, 12]), [8, 6])
        flip = T.reflection([0, 0], [1, 0])
        self.assertEqual(T.point_map(flip, [3, 4]), [3, -4])
        arc = make_arc([0, 0], 10, [10, 0], [0, -10], 90)
        image = T.apply_matrix(flip, arc)
        self.assertAlmostEqual(image["sweepAngle"], -90.0, places=9)  # a reflection reverses the arc direction
        self.assertAlmostEqual(image["b"][1], 10.0, places=9)
        scaled = T.apply_matrix(T.dilation([0, 0], -2), arc)
        self.assertAlmostEqual(scaled["radius"], 20.0, places=9)
        self.assertAlmostEqual(scaled["sweepAngle"], 90.0, places=9)  # a negative ratio keeps orientation


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
