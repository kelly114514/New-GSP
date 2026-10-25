#!/usr/bin/env python3
"""Offline M5 function/62 inventory and a lossless subset of original EMF assertions.

Does not evaluate formulas, import impl, start Sketchpad, or modify a source case.
Only direct 48 assertions whose called parents are free mode-0 functions are copied.
"""
import argparse
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import re
import struct

from inspect_gsp import parse_records
from emf_match import native_document
from m5_measures import expression_tree, html_expression_tree, same_expression


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expression_record(raw):
    """Decode shared storage, without assigning a mode or computing a value."""
    if len(raw) < 92 or len(raw) % 2:
        raise ValueError('expression-record-length')
    tag, size, header = struct.unpack_from('<III', raw, 32)
    count, mode = struct.unpack_from('<HH', raw, 44)
    if (tag, size, header) != (2311, len(raw) - 32, 48) or len(raw) != 92 + 2 * count:
        raise ValueError('expression-record-layout')
    return {'mode': mode, 'position': list(struct.unpack_from('<hh', raw, 12)),
            'tokens': list(struct.unpack_from('<' + 'H' * count, raw, 92))}


def is_definition(obj):
    return (obj['constraint'], obj['mainKind'], obj['genera']) == (0, 11, 57)


def function_tree(tokens):
    """Structural tree only: represent independent x as a synthetic parent slot.

    A free function has no real parent slots. No substitution is performed in any
    stored bytes, and no numeric value from this tree becomes an expectation.
    """
    if any(0x6000 <= token < 0x8000 for token in tokens):
        raise ValueError('free-function-has-parent-token')
    return expression_tree([0x6000 if token == 15 else token for token in tokens], 1)


def matching_function_rpn(tokens, rpn):
    replaced = ' '.join('A' if token == 'x' else token for token in rpn.split())
    return same_expression(function_tree(tokens), html_expression_tree(replaced))


def called_slots(obj):
    fields = expression_record(obj['measureRecord'])
    slots = [token - 0x7000 for token in fields['tokens'] if 0x7000 <= token < 0x8000]
    if any(slot >= len(obj['parents']) for slot in slots):
        raise ValueError('function-parent-slot-out-of-range')
    return slots


def free_mode0_calls(obj, objects):
    if obj['constraint'] != 48:
        return False
    slots = called_slots(obj)
    return bool(slots) and all(
        is_definition(objects[obj['parents'][slot] - 1]) and
        expression_record(objects[obj['parents'][slot] - 1]['measureRecord'])['mode'] == 0
        for slot in slots)


def records_by_object(path):
    """Raw record inventory keyed by page/tool and 1-based object number."""
    data = path.read_bytes()
    records, error = parse_records(data)
    if error:
        raise ValueError(str(error))
    page_count = tool_count = 0
    section = obj = None
    out = {}
    for record in records:
        kind = record['kind']
        payload = data[record['payload_offset']:record['payload_offset'] + record['payload_size']]
        if kind in (1000, 1002):
            if kind == 1000:
                page_count += 1
                section = ('page', page_count)
            else:
                tool_count += 1
                section = ('tool', tool_count)
            index = 0
        elif kind in (1001, 1003):
            section = None
        elif kind == 2000 and section:
            index += 1
            obj = out.setdefault((*section, index), {})
        elif kind == 2007:
            obj = None
        elif obj is not None:
            obj.setdefault(kind, []).append(payload)
    return out


def inventory(root):
    counts = Counter()
    modes = Counter()
    token_counts = Counter()
    button_actions = Counter()
    button_records = Counter()
    button_extra_sizes = Counter()
    button_examples = {}
    files_with_functions = set()
    files_with_buttons = set()
    for path in sorted(root.rglob('*.gsp')):
        document = native_document(path)
        raw_objects = records_by_object(path)
        for section_kind, sections in (('page', document['pages']), ('tool', document['tools'])):
            for number, section in enumerate(sections, 1):
                objects = section['objects']
                for obj in objects:
                    if is_definition(obj):
                        counts['freeFunctionDefinitions'] += 1
                        files_with_functions.add(str(path))
                        fields = expression_record(obj['measureRecord'])
                        modes[fields['mode']] += 1
                        token_counts.update(fields['tokens'])
                        if obj['parents']:
                            raise ValueError('free function has parent array')
                        if 15 in fields['tokens']:
                            counts['definitionsContainingIndependentVariable'] += 1
                        # A structural syntax check, not a numerical assertion.
                        function_tree(fields['tokens'])
                    if obj['constraint'] == 48 and called_slots(obj):
                        counts['calculationsContainingCalls'] += 1
                        if free_mode0_calls(obj, objects):
                            counts['calculationsCallingOnlyFreeMode0Functions'] += 1
                    if obj['constraint'] == 62:
                        counts['constraint62Objects'] += 1
                        files_with_buttons.add(str(path))
                        # Catalog genera=20 is a taxonomy row; its external ID is 23.
                        if (obj['mainKind'], obj['genera']) != (10, 23):
                            raise ValueError('constraint62-identity')
                        records = raw_objects[(section_kind, number, obj['objectIndex'])]
                        button_records.update(records.keys())
                        raw = records[2310][0]
                        if len(raw) != 24 or struct.unpack_from('<III', raw) != (2310, 24, 12):
                            raise ValueError('constraint62-record-layout')
                        action, options = struct.unpack_from('<HH', raw, 12)
                        button_actions[action] += 1
                        for extra in records.get(2003, []):
                            button_extra_sizes[len(extra)] += 1
                        button_examples.setdefault(str(action), {
                            'source': path.as_posix(), 'section': [section_kind, number],
                            'objectIndex': obj['objectIndex'], 'label': obj.get('labelText'),
                            'parents': obj['parents'], 'actionWord': action, 'optionWord': options,
                            'record2310Hex': raw.hex(),
                            'extra2003Hex': [extra.hex() for extra in records.get(2003, [])]})
    counts['filesWithFreeFunctions'] = len(files_with_functions)
    counts['filesWithConstraint62'] = len(files_with_buttons)
    return {'counts': dict(counts), 'functionModes': dict(modes),
            'functionTokens': {hex(key): value for key, value in sorted(token_counts.items())},
            'constraint62ActionWordCounts': dict(button_actions),
            'constraint62ChildRecordCounts': dict(button_records),
            'constraint62Extra2003Sizes': dict(button_extra_sizes),
            'constraint62Examples': button_examples}


def subset_cases(case_dir, output):
    source_index = case_dir / 'index.json'
    index = json.loads(source_index.read_text(encoding='utf8'))
    cases = []
    excluded = []
    assertions = 0
    for item in index['cases']:
        source_case = case_dir / item['case']
        case = json.loads(source_case.read_text(encoding='utf8'))
        document = native_document(Path(case['source']['path']))
        objects = document['pages'][case['pageIndex'] - 1]['objects']
        selected = []
        for assertion in case['assertions']:
            obj = objects[assertion['objectIndex'] - 1]
            if obj['constraint'] != 48 or not called_slots(obj):
                continue
            if not free_mode0_calls(obj, objects):
                excluded.append({'source': case['source'], 'pageIndex': case['pageIndex'],
                                 'objectIndex': obj['objectIndex'], 'reason': 'callee-outside-free-mode0-subset'})
                continue
            if assertion.get('provenance', {}).get('source') != 'original_emf_text':
                raise ValueError('non-original-expectation')
            selected.append(copy.deepcopy(assertion))
        if not selected:
            continue
        target = {key: copy.deepcopy(case[key]) for key in ('schema', 'source', 'pageIndex', 'pageCount', 'oracle')}
        target['assertions'] = selected
        target['excluded'] = []
        target['subsetProvenance'] = {'sourceCase': source_case.as_posix(), 'sourceCaseSha256': digest(source_case),
                                     'rule': 'unchanged original_emf_text assertions; all direct callees are free mode-0 functions'}
        (output / item['case']).write_text(json.dumps(target, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        cases.append({'case': item['case'], 'source': target['source'], 'pageIndex': target['pageIndex'],
                      'originalAssertionCount': len(selected)})
        assertions += len(selected)
    target_index = {'schema': 'gsp-m5-functions-original-subset-v1', 'generator': 'tools/m5_functions_evidence.py',
                    'sourceIndex': source_index.as_posix(), 'sourceIndexSha256': digest(source_index),
                    'cases': cases, 'originalAssertionCount': assertions,
                    'definitionDirectValueAssertions': 0, 'constraint62BehaviorAssertions': 0,
                    'limits': 'A function is not a displayed scalar. Counts are direct downstream calculation readouts, not function-plot or button-action verification.'}
    (output / 'index.json').write_text(json.dumps(target_index, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return target_index, excluded


def run(corpus, cases, output):
    output.mkdir(parents=True, exist_ok=True)
    report = inventory(corpus)
    index, excluded = subset_cases(cases, output)
    report['subset'] = index
    report['otherCallAssertions'] = excluded
    report['limits'] = ('No expression is evaluated. Expected numbers are unchanged copies of original EMF text assertions. '
                        'No original program was launched. Structure alone does not verify mode 1/2/3, function plots, derivatives, units, or button execution.')
    (output / 'evidence.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, default=Path('original/sketchpad5'))
    parser.add_argument('--cases', type=Path, default=Path('oracle/m5-cases-r5'))
    parser.add_argument('--out', type=Path, default=Path('oracle/m5-batch3-functions'))
    args = parser.parse_args()
    result = run(args.corpus, args.cases, args.out)
    print(json.dumps({'counts': result['counts'], 'functionModes': result['functionModes'],
                      'constraint62ActionWordCounts': result['constraint62ActionWordCounts'],
                      'originalAssertionCount': result['subset']['originalAssertionCount'],
                      'cases': len(result['subset']['cases'])}, ensure_ascii=False))
