"""Evidence safety checks; no product implementation is imported."""
import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest

from m5_functions_evidence import (called_slots, expression_record, free_mode0_calls,
                                   function_tree, matching_function_rpn, subset_cases)


def record(tokens, mode=0):
    raw = bytearray(92 + 2 * len(tokens))
    struct.pack_into('<IIIHH', raw, 32, 2311, len(raw) - 32, 48, len(tokens), mode)
    struct.pack_into('<' + 'H' * len(tokens), raw, 92, *tokens)
    return bytes(raw)


class FunctionsEvidenceTests(unittest.TestCase):
    def test_independent_variable_is_structural_not_number15(self):
        self.assertTrue(matching_function_rpn([0x2000, 15, 12], 'x @sin_'))
        self.assertFalse(matching_function_rpn([0x2000, 15, 12], '15 @sin_'))

    def test_noncommutative_function_structure(self):
        self.assertTrue(matching_function_rpn([4, 0x1003, 15], '4 x /'))
        self.assertFalse(matching_function_rpn([4, 0x1003, 15], 'x 4 /'))

    def test_constant_function_without_variable(self):
        self.assertEqual(function_tree([0]), ('number', 0.0))

    def test_free_function_parent_tokens_rejected(self):
        for token in [0x6000, 0x7000]:
            with self.assertRaises(ValueError):
                function_tree([token])

    def test_trailing_and_short_records_rejected(self):
        for raw in [record([15]) + b'\0\0', record([15])[:-1], b'\0' * 92]:
            with self.assertRaises(ValueError):
                expression_record(raw)

    def test_function_parent_slot_not_page_object_id(self):
        obj = {'constraint': 48, 'parents': [21, 55], 'measureRecord': record([0x7001, 3, 12], 4)}
        self.assertEqual(called_slots(obj), [1])
        obj['measureRecord'] = record([0x7002, 3, 12], 4)
        with self.assertRaises(ValueError):
            called_slots(obj)

    def test_mode_and_callee_identity_are_both_required(self):
        fn = {'constraint': 0, 'mainKind': 11, 'genera': 57, 'measureRecord': record([15])}
        call = {'constraint': 48, 'parents': [1], 'measureRecord': record([0x7000, 3, 12], 4)}
        self.assertTrue(free_mode0_calls(call, [fn, call]))
        for change in [{'constraint': 71}, {'mainKind': 10}, {'measureRecord': record([15], 1)}]:
            self.assertFalse(free_mode0_calls(call, [{**fn, **change}, call]))

    def test_existing_original_subset_preserved_exactly(self):
        source = Path('oracle/m5-cases-r5')
        if not (source / 'index.json').exists():
            self.skipTest('local original exports unavailable')
        with tempfile.TemporaryDirectory(prefix='gsp-m5-functions-') as name:
            output = Path(name)
            index, _ = subset_cases(source, output)
            self.assertEqual(index['originalAssertionCount'], 14)
            self.assertEqual(len(index['cases']), 7)
            for item in index['cases']:
                original = json.loads((source / item['case']).read_text(encoding='utf8'))
                copied = json.loads((output / item['case']).read_text(encoding='utf8'))
                for key in ['source', 'pageIndex', 'pageCount', 'oracle']:
                    self.assertEqual(copied[key], original[key])
                by_index = {a['objectIndex']: a for a in original['assertions']}
                for assertion in copied['assertions']:
                    self.assertEqual(assertion, by_index[assertion['objectIndex']])


if __name__ == '__main__':
    unittest.main()
