import json
from pathlib import Path
import tempfile
import unittest

from m5_batch3_audit import exclusions, fingerprint, verify


class OfflineAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.index = self.root / 'index.json'
        self.case = {'source': {'path': 'sample.gsp'}, 'pageIndex': 1,
                     'assertions': [{'constraint': 15, 'kind': 'point'}],
                     'excluded': [{'constraint': 15, 'reason': 'no_unique_primitive'}],
                     'otherPages': [{'pageIndex': 2}]}
        self.save('one.json', self.case)
        self.save('index.json', {'cases': [{'case': 'one.json'}]})

    def tearDown(self):
        self.directory.cleanup()

    def save(self, name, value):
        (self.root / name).write_text(json.dumps(value), encoding='utf-8')

    def test_saved_expectation_change_is_detected(self):
        snapshot = fingerprint(self.index)
        self.assertTrue(verify(self.index, snapshot)['unchanged'])
        self.case['assertions'][0]['geometry'] = {'x': 1, 'y': 2}
        self.save('one.json', self.case)
        self.assertEqual(verify(self.index, snapshot)['changed'], ['one.json'])

    def test_added_and_removed_case_files_are_reported(self):
        snapshot = fingerprint(self.index)
        self.save('two.json', self.case)
        self.save('index.json', {'cases': [{'case': 'two.json'}]})
        result = verify(self.index, snapshot)
        self.assertEqual(result['added'], ['two.json'])
        self.assertEqual(result['removed'], ['one.json'])
        self.assertIn('index.json', result['changed'])

    def test_exclusions_remain_gaps_and_other_exported_pages_are_deduplicated(self):
        second = {**self.case, 'pageIndex': 2, 'otherPages': [{'pageIndex': 1}]}
        self.save('two.json', second)
        self.save('index.json', {'cases': [{'case': 'one.json'}, {'case': 'two.json'}]})
        result = exclusions(self.index)
        self.assertEqual(result['assertionCount'], 2)
        self.assertEqual(result['excludedObjects'], 2)
        self.assertEqual(result['nonExportedPageScenarios'], 0)

    def test_duplicate_scenario_fails_instead_of_inflating_coverage(self):
        self.save('index.json', {'cases': [{'case': 'one.json'}, {'case': 'one.json'}]})
        with self.assertRaises(ValueError):
            exclusions(self.index)


if __name__ == '__main__':
    unittest.main()
