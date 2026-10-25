"""Offline coordinate definitions vs original EMF text; never creates expectations."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
from emf_match import native_document, predict, parse_html, bind_html, read_manifests, modified_after_open
import m5_coords


def run(directory):
    counts=defaultdict(Counter); mismatches=[]; examples={}; structures=defaultdict(Counter); axis_paths=[]
    rows,_=read_manifests([Path('oracle/full/manifest.jsonl')])
    html_counts=Counter(); html_axis_records=Counter()
    for item in json.loads((directory/'index.json').read_text(encoding='utf8'))['cases']:
        case=json.loads((directory/item['case']).read_text(encoding='utf8'))
        d=native_document(Path(case['source']['path']));page=d['pages'][case['pageIndex']-1];objects=page['objects']
        hints,_=predict(objects,page=page)
        row=rows.get(case['source']['path'],{})
        hp=row.get('outputs',{}).get('html',{}).get('path');html=parse_html(Path(hp)) if hp else None
        bindings=bind_html(objects,html)
        for s in (html or {}).get('steps',[]):
            if s['type'] in m5_coords.HTML:html_counts[s['type']]+=1
        for o in objects:
            c=o['constraint']
            if c in m5_coords.GEOMETRIC:
                structures[str(c)][str((o['mainKind'],o['genera'],o.get('coordRecord',b'').hex(),tuple(objects[p-1]['constraint'] for p in o['parents'])))]+=1
            if c in (58,59,60) and o['objectIndex'] in bindings:
                html_axis_records[str((o.get('coordRecord',b'').hex(),bindings[o['objectIndex']]['type']))]+=1
        for a in case['assertions']:
            c=a['constraint'];i=a['objectIndex']
            if c == 15 and a['kind'] == 'point':
                o=objects[i-1];parent=objects[o['parents'][0]-1]
                if parent['mainKind']==9 and i in hints:
                    measured=[a['geometry']['x'],a['geometry']['y']]
                    error=max(abs(hints[i]['point'][j]-measured[j]) for j in (0,1))
                    counts['15-axis:'+str(parent['constraint'])]['checked']+=1
                    counts['15-axis:'+str(parent['constraint'])]['passed' if error<=a['tolerancePx'] else 'mismatch']+=1
                    axis_paths.append({'source':case['source']['path'],'pageIndex':case['pageIndex'],'objectIndex':i,
                                       'axisConstraint':parent['constraint'],'axisDirection':m5_coords.axis_direction(parent),
                                       'originalPoint':measured,'hint':hints[i]['point'],'errorPx':error})
            if c not in m5_coords.NUMERIC or i not in hints:continue
            value=hints[i]['value'];m=a['measurement'];o=objects[i-1]
            group=str(c)
            if c==94:group+=':'+str(objects[o['parents'][1]-1]['constraint'])
            ok=abs(value-m['displayValue'])<=m['roundingTolerance']+1e-8
            counts[group]['checked']+=1;counts[group]['passed' if ok else 'mismatch']+=1
            record={'source':case['source']['path'],'pageIndex':case['pageIndex'],'objectIndex':i,'constraint':c,
                    'originalText':m,'predicted':value,'passed':ok,'exportState':{k:row.get(k) for k in ('busy_after_open','animation_stop_sent','dialogs')},
                    'documentModified':modified_after_open(row)}
            examples.setdefault(group,record)
            if not ok:mismatches.append(record)
            if c in (65,66,86):
                k=objects[o['parents'][-1]-1]
                for axis in k['parents']:
                    ac=objects[axis-1]['constraint'];counts['axis:'+str(ac)]['checks']+=1;counts['axis:'+str(ac)]['passed' if ok else 'mismatch']+=1
    return {'counts':{k:dict(v) for k,v in counts.items()},'mismatches':mismatches,'examples':examples,'axisPathPoints':axis_paths,
            'htmlSteps':dict(html_counts),'htmlAxisRecords':dict(html_axis_records),'structures':{k:dict(v) for k,v in structures.items()},
            'limits':'Formula values are diagnostics only; expectations remain original EMF text. Axis ancestry checks are indirect, not direct axis assertions.'}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    r=run(args.directory);args.out.write_text(json.dumps(r,ensure_ascii=False,indent=1)+'\n',encoding='utf8')
    print(json.dumps({k:r[k] for k in ('counts','htmlSteps','htmlAxisRecords')},ensure_ascii=False));print('mismatches',len(r['mismatches']))
