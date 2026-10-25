"""M5 第一批验收汇总：按约束分类、半值边界统计、完整支持文件数。

只读 check_m2 报告 + 用例期望 + core dump，不重新求值。

用法：
  python tools/m5_batch1_summary.py --index oracle/m5-cases-r2/index.json \
      --report oracle/m5-batch1-report.json --dump-dir oracle/work/dumps \
      --out oracle/work/m5-batch1-summary.json
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

BOUNDARY_TOLERANCE = 1e-9


def load_cases(index_path: Path):
    index = json.loads(index_path.read_text(encoding='utf-8'))
    rows = []
    for item in index['cases']:
        case = json.loads((index_path.parent / item['case']).read_text(encoding='utf-8'))
        rows.append((item['case'], case))
    return rows


def key_of(case):
    return (case['source']['path'], json.dumps(case.get('operation'), sort_keys=True))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--index', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--dump-dir', type=Path)
    ap.add_argument('--out', type=Path)
    args = ap.parse_args()

    cases = load_cases(args.index)
    by_key = {}
    for name, case in cases:
        by_key[key_of(case)] = (name, case)
    report = json.loads(args.report.read_text(encoding='utf-8'))

    per_constraint = defaultdict(Counter)
    per_case = {}
    boundary = []
    missing_dump = 0
    for row in report['results']:
        key = (row['source'], json.dumps(row.get('operation'), sort_keys=True))
        name, case = by_key.get(key, (None, None))
        if case is None:
            continue
        assertions = {a['objectIndex']: a for a in case['assertions']}
        stats = per_case.setdefault(key, Counter())
        for result in row['results']:
            a = assertions.get(result['objectIndex'])
            constraint = a.get('constraint') if a else None
            category = result.get('category', 'passed' if result['passed'] else 'incorrect_result')
            per_constraint[constraint][category] += 1
            per_constraint[constraint]['total'] += 1
            stats[category] += 1
            if a and a['kind'] == 'measure' and category == 'passed' and args.dump_dir is not None:
                dump_path = args.dump_dir / name
                if not dump_path.exists():
                    missing_dump += 1
                    continue
                dump = json.loads(dump_path.read_text(encoding='utf-8'))
                page = next((p for p in dump['pages'] if p['pageIndex'] == case['pageIndex']), None)
                obj = next((o for o in (page or {}).get('objects', []) if o['objectIndex'] == a['objectIndex']), None)
                internal = ((obj or {}).get('measurement') or {}).get('internal') or {}
                raw = internal.get('displayRaw')
                digits = a['measurement'].get('digits')
                if not isinstance(raw, (int, float)) or not isinstance(digits, int):
                    continue
                scaled = raw * (10 ** digits)
                frac = scaled - math.floor(scaled)
                if abs(frac - 0.5) <= BOUNDARY_TOLERANCE:
                    boundary.append({'source': case['source']['path'], 'objectIndex': a['objectIndex'],
                                     'constraint': constraint, 'digits': digits, 'displayRaw': raw,
                                     'expected': a['measurement']['displayNumber'],
                                     'actual': ((obj or {}).get('measurement') or {}).get('displayNumber')})

    constraints = {}
    for constraint, counter in sorted(per_constraint.items(), key=lambda x: (x[0] is None, x[0])):
        constraints[str(constraint)] = dict(counter)

    fully = 0
    assertions_all_pass = 0
    for key, stats in per_case.items():
        name, case = by_key[key]
        if any(count for category, count in stats.items() if category != 'passed'):
            continue
        assertions_all_pass += 1
        if args.dump_dir is None:
            continue
        dump_path = args.dump_dir / name
        if not dump_path.exists():
            continue
        dump = json.loads(dump_path.read_text(encoding='utf-8'))
        page = next((p for p in dump['pages'] if p['pageIndex'] == case['pageIndex']), None)
        if page is None:
            continue
        if all(o.get('status') == 'ok' or o.get('exists') is False for o in page['objects']):
            fully += 1

    summary = {
        'schema': 'gsp-m5-batch1-summary-v1',
        'cases': len(report['results']),
        'assertions': report['passedChecks'] + report['failedChecks'] + report['blocked_by_unimplemented_ancestor'],
        'passedChecks': report['passedChecks'],
        'failedChecks': report['failedChecks'],
        'blocked': report['blocked_by_unimplemented_ancestor'],
        'categories': report['categories'],
        'byConstraint': constraints,
        'boundaryAssertions': {'count': len(boundary), 'tolerance': BOUNDARY_TOLERANCE, 'items': boundary},
        'files': {'casesWithAllAssertionsPassing': assertions_all_pass, 'casesFullySupported': fully,
                  'missingDumps': missing_dump},
    }
    text = json.dumps(summary, ensure_ascii=False, indent=1) + '\n'
    if args.out:
        args.out.write_text(text, encoding='utf-8')
    print(json.dumps({k: v for k, v in summary.items() if k != 'byConstraint' and k != 'boundaryAssertions'}, ensure_ascii=False, indent=1))
    for constraint, counter in summary['byConstraint'].items():
        print(constraint, counter)


if __name__ == '__main__':
    main()
