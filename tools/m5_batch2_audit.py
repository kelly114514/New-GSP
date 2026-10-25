"""Read-only coverage and regression audit. Never evaluates geometry or creates expectations."""
import argparse
from collections import Counter
import json
from pathlib import Path


def coverage(index_path, dumps):
    index=json.loads(index_path.read_text(encoding='utf8'));seen=set();statuses=Counter();roots=Counter();fully=0;total=0
    for item in index['cases']:
        dump=json.loads((dumps/item['case']).read_text(encoding='utf8'))
        active=next(p for p in dump['pages'] if p['pageIndex']==item['pageIndex'])
        fully+=all(o.get('status')=='ok' or o.get('exists') is False for o in active['objects'])
        source=item['source']['path']
        if source in seen:continue
        seen.add(source)
        for p in dump['pages']:
            for o in p['objects']:
                total+=1;statuses[o['status']]+=1
                if o['status']=='unsupported' and not o.get('reason','').startswith('parent:'):
                    roots[str((o['constraintId'],o.get('reason')))]+=1
    return {'sourceFiles':len(seen),'allPageObjects':total,'statuses':dict(statuses),
            'objectOk':statuses['ok'],'activePagesFullySupported':fully,'activePageCases':len(index['cases']),
            'unsupportedSelf':dict(roots.most_common())}


def results(path):
    report=json.loads(path.read_text(encoding='utf8'));out={}
    for row in report['results']:
        for r in row['results']:
            key=(row['source'],row['pageIndex'],json.dumps(row.get('operation'),sort_keys=True),r['objectIndex'])
            out[key]=r
    return out


def regressions(before,after):
    old,new=results(before),results(after);counts=Counter();bad=[]
    for key,r in old.items():
        if not r['passed']:continue
        kind='measure' if r['kind']=='measure' else 'geometry'
        counts[kind+':previouslyPassed']+=1
        if new.get(key,{}).get('passed'):counts[kind+':stillPassed']+=1
        else:bad.append({'identity':key,'before':r,'after':new.get(key)})
    return {'counts':dict(counts),'regressionCount':len(bad),'regressions':bad}


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--index',type=Path,required=True);ap.add_argument('--dumps',type=Path,required=True)
    ap.add_argument('--baseline-report',type=Path,required=True);ap.add_argument('--report',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    r={'coverage':coverage(args.index,args.dumps),'regressions':regressions(args.baseline_report,args.report)}
    args.out.write_text(json.dumps(r,ensure_ascii=False,indent=1)+'\n',encoding='utf8')
    print(json.dumps({'coverage':{k:v for k,v in r['coverage'].items() if k!='unsupportedSelf'},'regressions':r['regressions']},ensure_ascii=False))
    raise SystemExit(bool(r['regressions']['regressionCount']))
