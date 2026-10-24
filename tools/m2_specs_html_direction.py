"""Compare same-type native parent order with original HTML, offline only."""
import json
import math
from pathlib import Path
import re
from collections import Counter, defaultdict
from m2_specs_evidence import ROOT, objects

def main():
    counts=defaultdict(Counter); examples=defaultdict(list)
    native=ROOT/'original/sketchpad5'
    keywords={2:'Segment',3:'Circle',7:'Bisector',8:'Polygon',63:'Line',64:'Ray'}
    for htm in (ROOT/'oracle/full/original/sketchpad5').rglob('*.htm'):
        source=native/htm.relative_to(ROOT/'oracle/full/original/sketchpad5').with_suffix('.gsp')
        if not source.exists(): continue
        text=htm.read_text(encoding='utf8',errors='replace')
        steps={int(m[1]):(m[2],m[3]) for m in re.finditer(r'^\{(\d+)\} ([^(;]+)\(([^)]*)\)',text,re.M)}
        pts={}
        for i,(kw,arg) in steps.items():
            if kw=='Point':
                try: pts[i]=tuple(map(float,arg.split(',')))
                except ValueError: pass
        container=objects(source)[0]
        for obj in container:
            if obj['ext'] not in keywords: continue
            parents=[container[i-1] for i in obj['parents']]
            if len(parents)>8 or not all(2201 in p['children'] for p in parents):continue
            import struct
            npts=[struct.unpack('<dd',p['children'][2201]) for p in parents]
            if len(set(npts))!=len(npts):continue
            matches=[]
            for hi,(kw,arg) in steps.items():
                if kw!=keywords[obj['ext']]:continue
                try: hp=[pts[int(i)] for i in arg.split(',')]
                except (ValueError,KeyError):continue
                if len(hp)!=len(npts):continue
                for order,seq in [('same',npts),('reverse',npts[::-1])]:
                    off=(hp[0][0]-seq[0][0],hp[0][1]-seq[0][1])
                    if all(abs(a[0]+off[0]-b[0])<.003 and abs(a[1]+off[1]-b[1])<.003 for a,b in zip(seq,hp)):
                        matches.append((order,hi))
            if len(matches)==1:
                order,hi=matches[0];counts[obj['ext']][order]+=1
                if len(examples[obj['ext']])<4:
                    examples[obj['ext']].append({'file':source.relative_to(native).as_posix(),'native_object':obj['id'],'native_parents':obj['parents'],'html_object':hi,'html':steps[hi],'order':order})
    out={'counts':dict(counts),'examples':dict(examples)}
    (ROOT/'oracle/m2_specs/html-direction.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(out,ensure_ascii=True,indent=2))

if __name__=='__main__':main()
