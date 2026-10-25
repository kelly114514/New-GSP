"""Union existing offline assertions, refusing conflicting values or source identities."""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from m5_case_diff import expected

A_GROUP = set(range(16)) | {63, 64, 79, 80, 81, 82, 83, 93, 98}
C_GROUP = set(range(16, 35)) | {75, 117, 118, 119}


def identity(case):
    return (case['source']['path'], case['pageIndex'], json.dumps(case.get('operation'), sort_keys=True))


def merge_case(before, incoming):
    if before['source'] != incoming['source'] or identity(before) != identity(incoming):
        raise ValueError('source identity mismatch')
    merged = deepcopy(before)
    assertions = {row['objectIndex']: row for row in merged['assertions']}
    added = []
    for row in incoming['assertions']:
        previous = assertions.get(row['objectIndex'])
        if previous is not None and expected(previous) != expected(row):
            raise ValueError(f'conflicting original expectation: {identity(before)} object {row["objectIndex"]}')
        if previous is None:
            assertions[row['objectIndex']] = deepcopy(row)
            added.append(row)
    merged['assertions'] = sorted(assertions.values(), key=lambda row: row['objectIndex'])
    # Preserve old provenance, and retain supplemental export identities explicitly.
    if added:
        merged.setdefault('supplementalOracles', []).append(deepcopy(incoming.get('oracle', {})))
    asserted = set(assertions)
    merged['excluded'] = [row for row in merged.get('excluded', []) if row['objectIndex'] not in asserted]
    cov = merged.setdefault('coverage', {})
    cov['assertedObjects'] = len(assertions)
    for group, predicate in [('A', lambda row: row['constraint'] in A_GROUP and row['kind'] != 'measure'),
                             ('C', lambda row: row['constraint'] in C_GROUP),
                             ('Measure', lambda row: row['kind'] == 'measure')]:
        count = sum(predicate(row) for row in added)
        cov[f'asserted{group}Objects'] = cov.get(f'asserted{group}Objects', 0) + count
        cov[f'excluded{group}Objects'] = max(0, cov.get(f'excluded{group}Objects', 0) - count)
    return merged


def combine(indexes, output):
    cases = {}
    inputs = []
    for index_path in indexes:
        index_path = Path(index_path)
        inputs.append({'path': str(index_path), 'sha256': hashlib.sha256(index_path.read_bytes()).hexdigest()})
        index = json.loads(index_path.read_text(encoding='utf-8'))
        for item in index['cases']:
            case = json.loads((index_path.parent / item['case']).read_text(encoding='utf-8'))
            key = identity(case)
            cases[key] = merge_case(cases[key], case) if key in cases else deepcopy(case)
    output = Path(output)
    # Validate every union before producing output; never alter input files.
    output.mkdir(parents=True, exist_ok=False)
    rows = []
    for key, case in cases.items():
        name = hashlib.sha256(json.dumps(key, ensure_ascii=False).encode('utf-8')).hexdigest()[:20] + '.json'
        (output / name).write_text(json.dumps(case, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        item = {'case': name, 'source': case['source'], 'pageIndex': case['pageIndex'],
                'coverage': case.get('coverage', {}),
                'byConstraint': dict(Counter(str(row['constraint']) for row in case['assertions']))}
        if 'operation' in case:
            item['operation'] = case['operation']
        rows.append(item)
    result = {'schema': 'gsp-m2-oracle-index-v1', 'generator': 'tools/m5_merge_cases.py',
              'inputs': inputs, 'cases': rows,
              'limits': 'Union of existing original evidence; does not generate new original exports or expectations.'}
    (output / 'index.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'cases': len(rows), 'assertions': sum(len(case['assertions']) for case in cases.values())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, action='append', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(combine(args.index, args.out)))
