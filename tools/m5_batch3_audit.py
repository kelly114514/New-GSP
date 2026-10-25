"""Freeze offline oracle inputs and audit exclusions without evaluating product code."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def fingerprint(index_path):
    index_path = Path(index_path)
    index = read_json(index_path)
    files = {'index.json': hashlib.sha256(index_path.read_bytes()).hexdigest()}
    for item in index['cases']:
        name = item['case']
        files[name] = hashlib.sha256((index_path.parent / name).read_bytes()).hexdigest()
    return {'schema': 'gsp-oracle-input-snapshot-v1', 'cases': len(index['cases']), 'files': files}


def verify(index_path, snapshot):
    current = fingerprint(index_path)
    old, new = snapshot['files'], current['files']
    changed = sorted(name for name in old.keys() & new.keys() if old[name] != new[name])
    added, removed = sorted(new.keys() - old.keys()), sorted(old.keys() - new.keys())
    return {'unchanged': not (changed or added or removed), 'changed': changed,
            'added': added, 'removed': removed, 'cases': current['cases']}


def exclusions(index_path):
    """Only count saved exclusions; no guessed expectations or implicit acceptance."""
    index_path = Path(index_path)
    index = read_json(index_path)
    excluded, asserted, gaps = Counter(), Counter(), Counter()
    pages, sources, missing_pages = set(), set(), set()
    for item in index['cases']:
        case = read_json(index_path.parent / item['case'])
        source = case['source']['path']
        operation = json.dumps(case.get('operation'), sort_keys=True)
        identity = (source, case['pageIndex'], operation)
        if identity in pages:
            raise ValueError(f'duplicate page scenario: {identity}')
        pages.add(identity)
        sources.add(source)
        for row in case.get('excluded', []):
            excluded[(str(row.get('constraint')), row['reason'])] += 1
        for row in case.get('assertions', []):
            asserted[(str(row.get('constraint')), row['kind'])] += 1
        for page in case.get('otherPages', []):
            missing_pages.add((source, page['pageIndex'], operation))
    for key in missing_pages - pages:
        gaps[key[0]] += 1
    return {'schema': 'gsp-oracle-exclusion-audit-v1', 'sourceFiles': len(sources),
            'pageScenarios': len(pages), 'assertionCount': sum(asserted.values()),
            'excludedObjects': sum(excluded.values()),
            'assertions': [{'constraint': c, 'kind': k, 'count': n}
                           for (c, k), n in asserted.most_common()],
            'exclusions': [{'constraint': c, 'reason': r, 'count': n}
                           for (c, r), n in excluded.most_common()],
            'nonExportedPageScenarios': sum(gaps.values()),
            'filesWithNonExportedPages': len(gaps),
            'limits': 'Counts are saved evidence coverage, not full file or style acceptance.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['snapshot', 'verify', 'exclusions'])
    parser.add_argument('--index', type=Path, required=True)
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.operation == 'verify':
        if args.snapshot is None:
            parser.error('verify requires --snapshot')
        result = verify(args.index, read_json(args.snapshot))
    elif args.operation == 'snapshot':
        result = fingerprint(args.index)
    else:
        result = exclusions(args.index)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items()
                      if k not in {'files', 'assertions', 'exclusions'}}, ensure_ascii=False))
    if args.operation == 'verify' and not result['unchanged']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
