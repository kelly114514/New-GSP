"""Compare original assertions across indexes. Exit nonzero on changed expectations."""
import argparse
from collections import Counter
import json
from pathlib import Path


def inventory(directory):
    result={}; excluded={}
    index=json.loads((directory/'index.json').read_text(encoding='utf8'))
    for item in index['cases']:
        case=json.loads((directory/item['case']).read_text(encoding='utf8'))
        prefix=(case['source']['path'],case['pageIndex'],json.dumps(case.get('operation'),sort_keys=True))
        for a in case['assertions']:
            key=prefix+(a['objectIndex'],)
            if key in result:raise ValueError('duplicate assertion identity: '+str(key))
            result[key]=a
        for e in case.get('excluded',[]):excluded[prefix+(e['objectIndex'],)]=e['reason']
    return result,excluded


def expected(a):
    # Provenance/mapping metadata can improve; every field compared by check_m2 is protected.
    return {k:v for k,v in a.items() if k!='provenance'}


def compare(before,after):
    old,_=inventory(before);new,excluded=inventory(after)
    added=Counter();deleted=Counter();changes=[];removed=[]
    for key in old.keys()&new.keys():
        if expected(old[key])!=expected(new[key]):changes.append({'identity':key,'before':old[key],'after':new[key]})
    for key in new.keys()-old.keys():
        a=new[key];added[str((a['kind'],a['constraint']))]+=1
    for key in old.keys()-new.keys():
        a=old[key];reason=excluded.get(key,'case_or_object_absent')
        deleted[str((a['kind'],a['constraint'],reason))]+=1
        removed.append({'identity':key,'kind':a['kind'],'constraint':a['constraint'],'reason':reason})
    return {'beforeAssertions':len(old),'afterAssertions':len(new),'existingExpectedChanged':len(changes),
            'added':dict(sorted(added.items())),'deleted':dict(sorted(deleted.items())),
            'changedItems':changes,'deletedItems':removed}


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('before',type=Path);ap.add_argument('after',type=Path);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    r=compare(args.before,args.after);args.out.write_text(json.dumps(r,ensure_ascii=False,indent=1)+'\n',encoding='utf8')
    print(json.dumps({k:v for k,v in r.items() if k not in ('changedItems','deletedItems')},ensure_ascii=False))
    raise SystemExit(bool(r['existingExpectedChanged']))
