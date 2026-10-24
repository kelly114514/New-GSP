import math
import struct
import unittest

from emf_match import modified_after_open
import m4_transforms
from m5_numeric_hints import numeric_hint, parameter_of

CM_PAGE = {"preference10041": 1, "preference10042": 1, "dpi": 96}
PX_PER_CM = 96 / 2.54


def expression_object(tokens, constraint=48, genera=51, parents=(), main=11):
    raw = bytearray(92 + 2 * len(tokens))
    raw[16:22] = b"\x03\x00<0>\x00"
    struct.pack_into("<3I2H", raw, 32, 2311, len(raw) - 32, 48, len(tokens), 4)
    struct.pack_into("<" + "H" * len(tokens), raw, 92, *tokens)
    return {"objectIndex": 1, "constraint": constraint, "mainKind": main, "genera": genera,
            "parents": list(parents), "measureRecord": bytes(raw), "measureRecordKind": 2311}


def number(value, dimension):
    return {"kind": "number", "value": value, "dimension": dimension}


class NumericHintTests(unittest.TestCase):
    def test_free_parameters_convert_literal_units_to_base_units(self):
        length = numeric_hint(expression_object([2, 4, 0x201], constraint=0, genera=80), [], CM_PAGE)
        self.assertAlmostEqual(length["value"], 24 * PX_PER_CM)
        self.assertEqual(length["dimension"], "length")
        angle = numeric_hint(expression_object([9, 0, 0x101], constraint=0, genera=81), [], CM_PAGE)
        self.assertAlmostEqual(angle["value"], math.pi / 2)
        self.assertEqual(numeric_hint(expression_object([3], constraint=0, genera=79), [], CM_PAGE)["value"], 3)
        self.assertIsNone(numeric_hint(expression_object([0x0F], constraint=0, genera=57), [], CM_PAGE))

    def test_calculation_runs_in_display_units_and_converts_by_genera(self):
        # parent[0] / 2 with a 5 cm length parent: 2.5 cm, returned in px.
        calc = expression_object([0x6000, 0x1003, 2], genera=48, parents=[2])
        hint = numeric_hint(calc, [number(5 * PX_PER_CM, "length")], CM_PAGE)
        self.assertAlmostEqual(hint["value"], 2.5 * PX_PER_CM)
        # 90 deg / (P0 + 1) with P0 = 1 on a degree page: 45 degrees.
        calc = expression_object([9, 0, 0x101, 0x1003, 11, 0x6000, 0x1000, 1, 12], genera=49, parents=[2])
        self.assertAlmostEqual(numeric_hint(calc, [number(1, "number")], CM_PAGE)["value"], math.pi / 4)
        # sin follows the page angle unit.
        calc = expression_object([0x2000, 3, 0, 12], genera=51)
        self.assertAlmostEqual(numeric_hint(calc, [], CM_PAGE)["value"], 0.5)
        self.assertIsNone(numeric_hint(expression_object([0x7000, 1, 12], parents=[2]), [number(1, "number")], CM_PAGE))

    def test_transform_parameter_requires_the_card_dimension(self):
        self.assertEqual(parameter_of(24, [None, number(10, "length")], 1), 10)
        self.assertIsNone(parameter_of(24, [None, number(10, "number")], 1))
        self.assertIsNone(parameter_of(29, [None, None, number(90, "number")], 2))
        self.assertIsNone(parameter_of(33, [None, None, number(2, "length")], 2))
        rotate = {"constraint": 29}
        matrix = m4_transforms.matrix_for(rotate, [{"kind": "point", "point": [1, 0]}, {"kind": "point", "point": [0, 0]},
                                                   number(math.pi / 2, "angle")], [])
        self.assertAlmostEqual(m4_transforms.point_map(matrix, [1, 0])[0], 0)
        self.assertAlmostEqual(m4_transforms.point_map(matrix, [1, 0])[1], -1)  # visually counter-clockwise, y down


class DocumentModifiedTests(unittest.TestCase):
    def test_animation_stop_or_save_prompt_marks_the_export_as_modified(self):
        self.assertTrue(modified_after_open({"animation_stop_sent": True}))
        self.assertTrue(modified_after_open({"dialogs": [{"text": "要保存更改到 x.gsp 吗？"}]}))
        self.assertFalse(modified_after_open({"dialogs": [{"text": "其它"}]}))


if __name__ == "__main__":
    unittest.main()
