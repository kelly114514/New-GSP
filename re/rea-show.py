"""Print the readable part of a REA query result (pseudocode, assembly, callers/callees).

REA result files are large JSON (analyze_function is ~3 MB because it embeds every
caller and reference). Use this instead of reading them directly:

    python re/rea-show.py <result.json> [--full]
"""
import json
import sys


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    full = '--full' in sys.argv
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    content = data.get('structuredContent', data)
    if data.get('isError'):
        print('REA ERROR:', json.dumps(content, ensure_ascii=False)[:2000])
        return
    print('evidence_id:', content.get('evidence_id'))
    print('operation:', content.get('operation'), json.dumps(content.get('parameters'), ensure_ascii=False))
    result = content.get('normalized_result', content.get('result'))
    if isinstance(result, str):
        print(result)
        return
    if not isinstance(result, dict):
        print(json.dumps(result, ensure_ascii=False, indent=1)[:4000])
        return
    procedure = result.get('procedure', {})
    if procedure:
        body = procedure.get('body', {})
        print('procedure:', procedure.get('address'), procedure.get('name'), procedure.get('signature'),
              'bytes:', body.get('total_bytes'), 'ranges:', body.get('ranges'))
    limit = None if full else 40
    for key in ('callees', 'callers'):
        items = result.get(key) or []
        shown = items if limit is None else items[:limit]
        print(f'{key} ({len(items)}):', ', '.join(f"{x.get('address')} {x.get('name')}" for x in shown),
              '' if len(shown) == len(items) else '...')
    for key in ('referenced_strings', 'referenced_names', 'unresolved_calls'):
        items = result.get(key) or []
        if items:
            print(f'{key} ({len(items)}):', json.dumps(items[:limit], ensure_ascii=False))
    if result.get('pseudocode'):
        print('\n--- pseudocode (Ghidra; verify against assembly) ---\n' + result['pseudocode'])
    if result.get('assembly'):
        print('\n--- assembly ---\n' + '\n'.join(result['assembly']))
    other = sorted(set(result) - {'procedure', 'callees', 'callers', 'referenced_strings', 'referenced_names',
                                  'unresolved_calls', 'pseudocode', 'assembly'})
    if other:
        print('\nother fields (use --full or read JSON):', ', '.join(other))
        if full:
            print(json.dumps({k: result[k] for k in other}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
