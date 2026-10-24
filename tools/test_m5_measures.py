import json
import math
from pathlib import Path
import struct
import tempfile
import unittest

from check_m2 import compare
from emf_match import read_manifests, make_case, parse_html
from m5_measures import expression_tree, html_expression_tree, same_expression, measurement_assertions, record_fields


def point_case():
    return {"source": {"path": "test.gsp"}, "pageIndex": 1,
            "assertions": [{"objectIndex": 2, "kind": "point", "geometry": {"x": 1, "y": 2}, "tolerancePx": .1}]}


def actual(objects):
    return {"schema": "gsp-core-geometry-v1", "pages": [{"pageIndex": 1, "objects": objects}]}


def measure_object(index=1):
    raw = bytearray(32)
    struct.pack_into("<hh", raw, 12, 10, 20)
    raw[16:22] = b"\x03\x00<0>\x00"
    return {"objectIndex": index, "constraint": 48, "state": 0, "color": "#000000", "measureRecordKind": 2307, "measureRecord": bytes(raw)}


def text(value, x, y):
    return {"kind": "text", "layer": "gdi", "text": value, "px96": [[x, y]], "color": "#000000"}


class MeasurementOracleTests(unittest.TestCase):
    def test_value_is_taken_from_original_text_without_a_formula_prediction(self):
        # The native object has no expression or parents. Only original text can provide 9.87.
        emf = {"primitives": [text("q", 14, 22), text(" = ", 24, 22), text("9.87", 40, 22)]}
        checks, gaps = measurement_assertions([measure_object()], emf, [0, 0])
        self.assertFalse(gaps)
        self.assertEqual(checks[0]["measurement"]["displayNumber"], "9.87")
        self.assertFalse(checks[0]["provenance"]["matchingPredictionUsed"])
        emf["primitives"][2]["text"] = "1.23"
        self.assertEqual(measurement_assertions([measure_object()], emf, [0, 0])[0][0]["measurement"]["displayValue"], 1.23)

    def test_ambiguous_ownership_and_neighbor_labels_stay_uncovered(self):
        emf = {"primitives": [text("q", 14, 22), text(" = ", 24, 22), text("9.87", 40, 22)]}
        checks, gaps = measurement_assertions([measure_object(), measure_object(2)], emf, [0, 0])
        self.assertFalse(checks)
        self.assertEqual(len(gaps), 2)
        emf["primitives"].append(text("Animate Point", 100, 22))
        self.assertFalse(measurement_assertions([measure_object()], emf, [0, 0])[0])

    def test_unknown_record_lengths_and_markers_fail_closed(self):
        raw = measure_object()["measureRecord"]
        self.assertIsNotNone(record_fields(raw, 2307))
        self.assertIsNone(record_fields(raw + bytes(4), 2307))
        self.assertIsNone(record_fields(raw, 9999))

    def test_ratio_and_coordinate_distance_are_distinct_html_constructors(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "x.htm"
            p.write_text("{1} Ratio/Points(9,8,7,10,20,'r = ')[black];\n{2} CoordinateDistance(9,8,6,10,40,'d = ')[black];\n", encoding="utf8")
            steps = parse_html(p)["steps"]
            self.assertEqual(steps[0]["parents"], [9, 8, 7])
            self.assertEqual(steps[1]["parents"], [9, 8, 6])

    def test_native_parent_order_noncommutative_operators_functions_and_units(self):
        native = [0x6000, 0x1003, 0x6001]
        self.assertTrue(same_expression(expression_tree(native, 2), html_expression_tree("A B /")))
        self.assertFalse(same_expression(expression_tree(native, 2), html_expression_tree("B A /")))
        self.assertTrue(same_expression(expression_tree([0x200c, 0x1001, 1, 10, 3, 12], 0), html_expression_tree("1.3 ! @trnc")))
        self.assertTrue(same_expression(expression_tree([3, 6, 0, 0x101], 0), html_expression_tree("6.28319")))
        with self.assertRaises(ValueError):
            expression_tree([0x6001], 1)

    def test_page_manifests_keep_each_page_and_reject_negative_indices(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "manifest.jsonl"
            p.write_text("".join(json.dumps({"input": "x.gsp", "status": "ok", "pageIndex": i}) + "\n" for i in (0, 1)), encoding="utf8")
            self.assertEqual(len(read_manifests([p])[0]), 2)
        with self.assertRaisesRegex(ValueError, "zero-based"):
            make_case(Path(__file__).resolve().parents[1] / "samples/baseline/samples/point.gsp", page_index=-1)


class ComparatorClassificationTests(unittest.TestCase):
    def root(self):
        return {"objectIndex": 1, "constraintId": 48, "exists": None, "status": "unsupported", "reason": "constraint-48-not-supported"}

    def child(self):
        return {"objectIndex": 2, "exists": None, "status": "unsupported", "reason": "parent:1:unsupported"}

    def test_only_explicit_propagated_unsupported_is_blocked(self):
        result = compare(point_case(), actual([self.root(), self.child()]))
        self.assertEqual(result["blocked_by_unimplemented_ancestor"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["results"][0]["unsupportedAncestors"][0]["objectIndex"], 1)
        result = compare(point_case(), actual([self.child()]))
        self.assertEqual(result["failed"], 1)  # absent claimed parent cannot excuse a result
        child = self.child(); child["reason"] = "constraint-2-not-supported"
        self.assertEqual(compare(point_case(), actual([self.root(), child]))["categories"], {"unimplemented_self": 1})

    def test_wrong_finite_or_nan_result_is_never_hidden_by_an_unsupported_ancestor(self):
        for x in (8, float("nan")):
            obj = {**self.child(), "exists": True, "kind": "point", "geometry": {"x": x, "y": 2}}
            result = compare(point_case(), actual([self.root(), obj]))
            self.assertEqual(result["failed"], 1)
            self.assertEqual(result["blocked_by_unimplemented_ancestor"], 0)
        obj = {**self.child(), "geometry": {"x": float("nan"), "y": 2}}
        self.assertEqual(compare(point_case(), actual([self.root(), obj]))["failed"], 1)

    def test_contradictory_root_or_intermediate_ancestor_does_not_excuse_a_child(self):
        for patch in ({"exists": True, "geometry": {"x": float("nan"), "y": 0}},
                      {"geometry": {"x": 1, "y": 2}},
                      {"measurement": {"displayValue": float("nan")}}):
            root = {**self.root(), **patch}
            report = compare(point_case(), actual([root, self.child()]))
            self.assertEqual(report["failed"], 1)
            self.assertEqual(report["blocked_by_unimplemented_ancestor"], 0)
        # The same contradiction in an intermediate parent must also remain an error.
        intermediate = {**self.root(), "objectIndex": 3, "reason": "parent:1:unsupported", "geometry": {"x": 0, "y": 0}}
        child = {**self.child(), "reason": "parent:3:unsupported"}
        self.assertEqual(compare(point_case(), actual([self.root(), intermediate, child]))["failed"], 1)

    def test_dynamic_color_geometry_is_not_blocked_by_its_unused_color_parent(self):
        obj = {"objectIndex": 2, "constraintId": 75, "exists": True, "kind": "point", "geometry": {"x": 1, "y": 2}}
        self.assertEqual(compare(point_case(), actual([self.root(), obj]))["passed"], 1)

    def test_measurement_checks_units_rounding_and_exact_display_when_supplied(self):
        case = {"source": {"path": "test.gsp"}, "pageIndex": 1, "assertions": [
            {"objectIndex": 2, "kind": "measure", "measurement": {"displayValue": 2.51, "displayNumber": "2.51", "displayUnitText": "厘米", "roundingTolerance": .0050000001}}]}
        obj = {"objectIndex": 2, "exists": True, "kind": "measure", "measurement": {"displayValue": 2.512, "displayUnitText": "厘米"}}
        self.assertEqual(compare(case, actual([obj]))["failed"], 0)
        for patch in ({"displayUnitText": "英寸"}, {"displayValue": 2.52}, {"displayNumber": "2.510"}, {"displayValue": float("nan")}):
            bad = {**obj, "measurement": {**obj["measurement"], **patch}}
            self.assertEqual(compare(case, actual([bad]))["failed"], 1)


if __name__ == "__main__":
    unittest.main()
