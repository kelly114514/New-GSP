import math
import unittest

from m5_batch3_coords import (arc_boundary_value, expected_point, labeled_point,
                              parallel_incidence_point, polygon_boundary_value)


class CoordinateBoundaryEvidence(unittest.TestCase):
    def test_polygon_uses_length_not_edge_count(self):
        result = polygon_boundary_value([3, 0], [[0, 0], [3, 0], [3, 1], [0, 1]])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["candidates"]), 2)
        self.assertAlmostEqual(result["value"], 3 / 8)

    def test_polygon_closed_seam_does_not_conflate_zero_and_one(self):
        result = polygon_boundary_value([0, 0], [[0, 0], [3, 0], [3, 1], [0, 1]])
        self.assertEqual(result["reason"], "polygon-nearest-logical-value-ambiguous")
        self.assertEqual([c["value"] for c in result["candidates"]], [0, 1])

    def test_retraced_edge_keeps_distinct_logical_parameters(self):
        result = polygon_boundary_value([2, 0], [[0, 0], [3, 0], [3, 2], [3, 0]])
        self.assertEqual(result["status"], "unsupported")
        self.assertEqual(len(result["candidates"]), 2)
        self.assertNotAlmostEqual(*[c["value"] for c in result["candidates"]])

    def test_polygon_off_boundary_and_zero_edge_stay_unknown(self):
        self.assertEqual(polygon_boundary_value([2, 1], [[0, 0], [4, 0], [4, 3], [0, 3]])["status"], "unsupported")
        self.assertEqual(polygon_boundary_value([2, 0], [[0, 0], [4, 0], [4, 0]])["status"], "unsupported")

    def test_arc_end_is_one_not_circle_seam(self):
        result = arc_boundary_value([0, -2], [0, 0], 2, 0, math.pi / 2)
        self.assertEqual(result["value"], 1)
        self.assertTrue(result["endpoint"])

    def test_arc_value_is_invariant_under_full_turns_of_start_angle(self):
        start, sweep, t = math.radians(-144), math.radians(60), .8540906077963556
        point = [10 + 131 * math.cos(start + t * sweep), 20 - 131 * math.sin(start + t * sweep)]
        for turns in (-3, 0, 4):
            result = arc_boundary_value(point, [10, 20], 131, start + turns * math.tau, sweep)
            self.assertAlmostEqual(result["value"], t)

    def test_arc_center_off_circle_and_off_sweep_stay_unknown(self):
        for point in ([0, 0], [0, -3], [-2, 0]):
            self.assertEqual(arc_boundary_value(point, [0, 0], 2, 0, math.pi / 2)["status"], "unsupported")
        self.assertEqual(arc_boundary_value([2, 0], [0, 0], 2, 0, math.tau)["status"], "unsupported")

    def test_expected_dot_reads_original_coordinates_without_formula_argument(self):
        dot = {"kind": "point", "point": [910.999944, 243.000107], "primitiveIndex": 1240, "layer": "emf+"}
        assertion = expected_point({"objectIndex": 64, "constraint": 15}, dot, {"mapping": "label"}, "hash")
        self.assertEqual(assertion["geometry"], {"x": dot["point"][0], "y": dot["point"][1]})
        self.assertNotEqual(assertion["geometry"], {"x": 911, "y": 243})
        self.assertFalse(assertion["provenance"]["matchingPredictionUsed"])

    def test_label_binding_uses_original_text_and_preceding_dot_without_prediction(self):
        obj = {"objectIndex": 1, "labelText": "B[2]", "labelFlags": [6, 1], "state": 0, "color": "#ffff00"}
        dot = {"kind": "point", "point": [912, 340], "primitiveIndex": 0, "brush": {"color": "#ffff00"}}
        emf = {"primitives": [{"kind": "ellipse"}, {"kind": "ellipse"},
                              {"kind": "text", "text": "B", "px96": [[906.08, 344.96]]},
                              {"kind": "text", "text": "2", "px96": [[914.24, 350.56]]}]}
        result = labeled_point(obj, [obj], emf, [dot], [-1, -97])
        self.assertEqual(result[0]["point"], [911, 243])
        self.assertEqual(result[1]["labelTextPrimitives"], [2, 3])
        self.assertIsNone(labeled_point(obj, [obj, dict(obj)], emf, [dot], [-1, -97]))

    def test_incidence_binding_does_not_need_native_t(self):
        # P5 lies on horizontal L3 through saved point1; I8 is on a vertical through P5.
        objects = [
            {"objectIndex": 1, "constraint": 0, "parents": [], "savedPoint": [10, 30]},
            {"objectIndex": 2, "constraint": 59, "parents": [], "coordRecord": b"\1\0"},
            {"objectIndex": 3, "constraint": 6, "parents": [1, 2]},
            {"objectIndex": 4, "constraint": 6, "parents": [1, 2]},
            {"objectIndex": 5, "constraint": 15, "parents": [3], "color": "#ff0000"},
            {"objectIndex": 6, "constraint": 5, "parents": [5, 4]},
            {"objectIndex": 7, "constraint": 0, "parents": []},
            {"objectIndex": 8, "constraint": 9, "parents": [4, 6], "state": 0,
             "labelText": "adjust", "labelFlags": [7, 1], "color": "#ff0000"},
        ]
        dots = [{"kind": "point", "point": [51, 8], "primitiveIndex": 0, "brush": {"color": "#ff0000"}},
                {"kind": "point", "point": [51, 32], "primitiveIndex": 3, "brush": {"color": "#ff0000"}}]
        emf = {"primitives": [{"kind": "ellipse"}, {"kind": "ellipse"},
                              {"kind": "text", "text": "adjust", "px96": [[53, 10]]}, {"kind": "ellipse"}]}
        result = parallel_incidence_point(objects[4], objects, emf, dots, [-1, -2])
        self.assertEqual(result[0]["point"], [50, 30])
        self.assertIn("incidence", result[1]["mapping"])


if __name__ == "__main__":
    unittest.main()
