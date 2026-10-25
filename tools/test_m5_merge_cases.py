from copy import deepcopy
import unittest

from m5_merge_cases import merge_case


class MergeCasesTests(unittest.TestCase):
    def case(self):
        return {'source': {'path': 'sample.gsp', 'sha256': 'a'}, 'pageIndex': 1,
                'assertions': [{'objectIndex': 1, 'constraint': 0, 'kind': 'point', 'geometry': {'x': 1, 'y': 2}}],
                'excluded': [{'objectIndex': 2, 'constraint': 94, 'reason': 'unverified'}],
                'coverage': {'assertedObjects': 1, 'assertedAObjects': 1, 'excludedMeasureObjects': 1}}

    def test_conflicting_expectation_is_never_replaced(self):
        before, incoming = self.case(), self.case()
        incoming['assertions'][0]['geometry']['x'] = 3
        with self.assertRaisesRegex(ValueError, 'conflicting original expectation'):
            merge_case(before, incoming)
        self.assertEqual(before['assertions'][0]['geometry']['x'], 1)

    def test_same_source_path_with_different_hash_is_rejected(self):
        before, incoming = self.case(), self.case()
        incoming['source']['sha256'] = 'b'
        with self.assertRaisesRegex(ValueError, 'source identity mismatch'):
            merge_case(before, incoming)

    def test_union_preserves_old_provenance_and_adds_only_new_identity(self):
        before, incoming = self.case(), self.case()
        before['assertions'][0]['provenance'] = {'source': 'original'}
        incoming['assertions'][0]['provenance'] = {'source': 'supplement'}
        incoming['assertions'].append({'objectIndex': 2, 'constraint': 94, 'kind': 'measure',
                                      'geometry': {'displayValue': .5}})
        original = deepcopy(before)
        result = merge_case(before, incoming)
        self.assertEqual(result['assertions'][0]['provenance']['source'], 'original')
        self.assertEqual(len(result['assertions']), 2)
        self.assertEqual(result['excluded'], [])
        self.assertEqual(result['coverage']['assertedMeasureObjects'], 1)
        self.assertEqual(result['coverage']['excludedMeasureObjects'], 0)
        self.assertEqual(before, original)


if __name__ == '__main__':
    unittest.main()
