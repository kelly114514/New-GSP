"""Offline, read-only evidence for M2 object cards (no original app execution).

Writes only aggregate metadata and selected numeric facts to oracle/m2_specs/.
The original .gsp/.htm data remain outside the public repository.
"""
from __future__ import annotations
from collections import Counter, defaultdict
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'tools'))
from inspect_gsp import parse_records

A = set(range(16)) | {63, 64, 79, 80, 81, 82, 83, 93, 98}

def objects(path):
    data = path.read_bytes()
    records, error = parse_records(data)
    if error:
        raise ValueError((path, error))
    containers=[]; current=None; obj=None
    for record in records:
        k=record['kind']; p=record['payload_offset']; n=record['payload_size']
        raw=data[p:p+n]
        if k in (1000,1002):
            current=[]; containers.append(current)
        elif k in (1001,1003): current=None
        elif k==2000:
            head=struct.unpack_from('<8H',raw)
            obj={'id':len(current)+1,'ext':head[0],'main':head[3],'genera':head[4],
                 'header':list(head),'parents':[],'children':{}}
            current.append(obj)
        elif k==2007: obj=None
        elif obj is not None:
            obj['children'][k]=raw
            if k==2002:
                count=struct.unpack_from('<I',raw)[0]
                obj['parents']=list(struct.unpack_from('<'+'I'*count,raw,4))
    return containers

def main():
    corpus=ROOT/'original/sketchpad5'; out=ROOT/'oracle/m2_specs'; out.mkdir(exist_ok=True)
    counts=Counter(); signatures=defaultdict(Counter); examples=defaultdict(dict)
    classes=defaultdict(Counter); extras=defaultdict(Counter); extra_examples=defaultdict(list)
    for path in sorted(corpus.rglob('*.gsp')):
        rel=path.relative_to(corpus).as_posix()
        for ci, container in enumerate(objects(path)):
            for obj in container:
                ext=obj['ext']
                if ext not in A: continue
                counts[ext]+=1; classes[ext][(obj['main'],obj['genera'])]+=1
                sig=tuple((container[i-1]['ext'],container[i-1]['main'],container[i-1]['genera']) for i in obj['parents'])
                signatures[ext][sig]+=1
                examples[ext].setdefault(sig,{'file':rel,'container':ci,'object':obj['id'],'parents':obj['parents']})
                raw=obj['children'].get(2003)
                if raw is not None:
                    extras[ext][(len(raw),raw[:4].hex())]+=1
                    if len(extra_examples[ext])<16:
                        extra_examples[ext].append({'file':rel,'container':ci,'object':obj['id'],
                            'parents':sig,'raw':raw.hex(),
                            'f64_at4':struct.unpack_from('<d',raw,4)[0] if len(raw)>=12 else None})
    report={str(ext):{'objects':counts[ext],
          'classes':[{'main':k[0],'genera':k[1],'count':v} for k,v in classes[ext].most_common()],
          'signatures':[{'parents':k,'count':v,'example':examples[ext][k]} for k,v in signatures[ext].most_common()],
          'extras':[{'size':k[0],'prefix_hex':k[1],'count':v} for k,v in extras[ext].most_common()],
          'extra_examples':extra_examples[ext]} for ext in sorted(A)}
    (out/'evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({ext:{'objects':v['objects'],'classes':v['classes'],'signatures':len(v['signatures']),'extras':v['extras']} for ext,v in report.items()},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
