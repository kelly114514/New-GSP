"""Independent original-EMF checks for native path parameters, offline only.

Predictions select a unique original dot; reported coordinates come from EMF.
Only paths whose defining points are stored free points are used here.
"""
import json
import math
from pathlib import Path
import struct
from collections import Counter
from emf_match import (ROOT, native_document, parse_html, bind_html, measured_primitives,
                       fit_offset, translated, distance, color_for)
from emf_dump import parse_emf

def main():
    root=ROOT/'oracle/full/original/sketchpad5'; source_root=ROOT/'original/sketchpad5'
    checks=[]; counts=Counter()
    for htm in root.rglob('*.htm'):
        source=source_root/htm.relative_to(root).with_suffix('.gsp'); emf_path=htm.with_suffix('.emf')
        if not source.exists() or not emf_path.exists() or emf_path.stat().st_size>8_000_000:continue
        doc=native_document(source); obs=doc['pages'][doc['activePageIndex']-1]['objects']
        relevant=[]
        for obj in obs:
            if obj['constraint']!=15 or len(obj.get('constraintExtra',b'')) not in (12,20) or obj['state']!=0:continue
            path=obs[obj['parents'][0]-1]
            if path['constraint'] not in (2,63,64,3,8):continue
            pp=[obs[i-1] for i in path['parents']]
            if any('savedPoint' not in p for p in pp) or len(pp)>20:continue
            if path['constraint']!=8 and len(pp)!=2:continue
            relevant.append((obj,path,[p['savedPoint'] for p in pp]))
        if not relevant:continue
        bindings=bind_html(obs,parse_html(htm))
        raw=emf_path.read_bytes(); emf=parse_emf(raw,with_records=False)
        if not emf['validation']['ok']:continue
        measured=measured_primitives(emf); offset,fit=fit_offset(obs,measured)
        if offset is None:continue
        dots=[translated(p,offset) for p in measured if p['kind']=='point']
        for obj,path,parents in relevant:
            if obj['objectIndex'] not in bindings and not (path['constraint']==3 and path['objectIndex'] in bindings):continue
            extra=obj['constraintExtra']; t=struct.unpack_from('<d',extra,4)[0]
            if path['constraint']==8:
                if len(extra)!=20 or min(abs(t),abs(t-1))<.001:continue
                edge=struct.unpack_from('<H',extra,12)[0]; n=len(parents); predictions={}
                for shift in (0,-1):
                    for direction in (1,-1):
                        a=parents[(edge+shift)%n];b=parents[(edge+shift+direction)%n]
                        predictions[f'edge_shift{shift}_direction{direction}']=[a[j]+t*(b[j]-a[j]) for j in (0,1)]
            elif path['constraint']==3:
                p0,p1=parents
                ux,uy=struct.unpack_from('<dd',extra,4); radius=distance(p0,p1)
                predictions={'screen_vector':[p0[0]+radius*ux,p0[1]+radius*uy],
                             'math_vector':[p0[0]+radius*ux,p0[1]-radius*uy]}
            else:
                p0,p1=parents; d=[p0[j]-p1[j] for j in (0,1)]
                if min(abs(t),abs(t-.5),abs(t-1))<.001:continue
                predictions={'reversed_2002':[p1[j]+t*d[j] for j in (0,1)],
                             'same_2002':[p0[j]-t*d[j] for j in (0,1)]}
            found=[]
            for rule,q in predictions.items():
                matches=[p for p in dots if distance(p['point'],q)<.075 and (color_for(p) or '').lower()==obj['color'].lower()]
                if len(matches)==1:found.append((rule,matches[0]))
            if len(found)!=1:continue
            rule,dot=found[0];counts[(path['constraint'],rule)]+=1
            if sum(c['pathConstraint']==path['constraint'] for c in checks)>=5:continue
            checks.append({'file':source.relative_to(source_root).as_posix(),'objectIndex':obj['objectIndex'],
                'pathIndex':path['objectIndex'],'pathConstraint':path['constraint'],'nativeParentPoints':parents,
                'parameter':({'localFraction':t,'edgeIndex':edge} if path['constraint']==8 else list(struct.unpack_from('<dd',extra,4)) if len(extra)==20 else t),
                'rule':rule,'measuredPoint':dot['point'],'primitiveIndex':dot['primitiveIndex'],
                'htmlPointValue':bindings.get(obj['objectIndex'],{}).get('pathParameter')})
            if path['constraint']==8:checks[-1]['edgeIndex']=edge
    out={'counts':[{'pathConstraint':k[0],'rule':k[1],'count':v} for k,v in sorted(counts.items())],'examples':checks}
    (ROOT/'oracle/m2_specs/path-points.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(out,ensure_ascii=True,indent=2))

if __name__=='__main__':main()
