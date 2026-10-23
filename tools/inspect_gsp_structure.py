"""Correlate GSP record fields and validate PNG payloads, using static bytes only."""
from collections import Counter,defaultdict
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib
from inspect_gsp import parse_records


def png_validate(data, offset):
    pos=offset+8
    chunks=[]
    while pos+12<=len(data):
        n=struct.unpack_from('>I',data,pos)[0]
        if n>len(data)-pos-12:
            return {'valid':False,'reason':'chunk_length','offset':pos}
        kind=data[pos+4:pos+8]
        payload=data[pos+8:pos+8+n]
        stored=struct.unpack_from('>I',data,pos+8+n)[0]
        crc=zlib.crc32(kind+payload)&0xffffffff
        if stored!=crc:
            return {'valid':False,'reason':'crc','offset':pos}
        chunks.append({'kind':kind.decode('ascii',errors='backslashreplace'),'offset':pos,'length':n})
        pos+=12+n
        if kind==b'IEND':
            width,height=struct.unpack_from('>II',data,offset+16)
            return {'valid':True,'bytes':pos-offset,'end_offset':pos,'width':width,'height':height,'chunks':chunks}
    return {'valid':False,'reason':'missing_iend','offset':pos}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',required=True,type=Path);ap.add_argument('--out',required=True,type=Path);args=ap.parse_args()
    inv=json.loads((args.out/'gsp-inventory.json').read_text(encoding='utf8'))
    begin_to_end={900:901,902:903,1000:1001,1002:1003,1006:1007,2000:2007}
    ends=set(begin_to_end.values())
    stack_errors=[];page_counts=[];object_ref_checks=Counter();object_sizes_by_header=defaultdict(Counter)
    pngs=[];builds=Counter();build_examples={};odd_examples=[];name_candidates=[];previews=[]
    for e in inv:
        b=(args.root/e['path']).read_bytes();records,failure=parse_records(b)
        assert failure is None
        stack=[];page=None
        for r in records:
            kind=r['kind'];p=r['payload_offset'];n=r['payload_size']
            if kind in begin_to_end:
                stack.append((kind,r['offset']))
            elif kind in ends:
                if not stack or begin_to_end[stack[-1][0]]!=kind:
                    stack_errors.append({'path':e['path'],'offset':r['offset'],'kind':kind,'stack':stack.copy()})
                else:stack.pop()
            if kind==1000:
                if page is not None:raise RuntimeError('overlapping page')
                page={'path':e['path'],'offset':r['offset'],'payload_u32_at_24':struct.unpack_from('<I',b,p+24)[0],'count_2000':0}
            elif kind==1001:
                if page is not None:
                    page['matched']=page['payload_u32_at_24']==page['count_2000'];page_counts.append(page);page=None
            elif kind==2000:
                object_sizes_by_header[e['header_0c_u16le']][n]+=1
                if page is not None:page['count_2000']+=1
            elif kind==2002:
                count=struct.unpack_from('<I',b,p)[0]
                object_ref_checks['records']+=1
                object_ref_checks['size_equals_4_plus_4_times_first_u32']+=int(n==4+4*count)
            elif kind==1100:
                raw=b[p:p+n].split(b'\0',1)[0]
                text=None;method=None
                for codec in ('utf8','gbk'):
                    try:
                        text=raw.decode(codec);method='first_success_strict_'+codec;break
                    except UnicodeDecodeError:pass
                name_candidates.append({'path':e['path'],'record_offset':r['offset'],'payload_offset':p,'payload_hex':b[p:p+n].hex(),
                                        'within_1000_offset':page['offset'] if page else None,'candidate_text':text,'decoding_method':method})
            elif kind==9004:
                text=b[p:p+n].split(b'\0',1)[0].decode('ascii',errors='backslashreplace')
                builds[text]+=1
                build_examples.setdefault(text,{'path':e['path'],'offset':r['offset'],'payload_offset':p,'payload_size':n,'payload_hex':b[p:p+n].hex()})
            elif kind==1300:
                relative=b[p:p+n].find(b'\x89PNG\r\n\x1a\n')
                if relative>=0:
                    item={'path':e['path'],'sha256':e['sha256'],'record_offset':r['offset'],'payload_offset':p,'payload_size':n,'png_offset':p+relative,
                          'prefix_u32le':list(struct.unpack_from('<II',b,p))}
                    item.update(png_validate(b,p+relative))
                    if e['path']=='Sample.gsp' and item['valid'] and len(previews)<2:
                        folder=args.out/'previews';folder.mkdir(exist_ok=True)
                        path=folder/f"sample-{len(previews)+1:02d}-{item['width']}x{item['height']}.png"
                        png_bytes=b[item['png_offset']:item['end_offset']];path.write_bytes(png_bytes)
                        preview={'path':str(path.resolve()),'sha256':hashlib.sha256(png_bytes).hexdigest(),
                                 'source_path':e['path'],'source_sha256':e['sha256'],'source_start':item['png_offset'],
                                 'source_end_exclusive':item['end_offset'],'bytes':len(png_bytes)}
                        previews.append(preview)
                    pngs.append(item)
            if n%2 and len(odd_examples)<6:
                odd_examples.append({'path':e['path'],'sha256':e['sha256'],**r})
        if stack:stack_errors.append({'path':e['path'],'unclosed':stack})
    summary={'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
             'paired_kind_hypothesis':begin_to_end,'paired_kind_stack_error_count':len(stack_errors),'paired_kind_stack_errors':stack_errors[:10],
             'page_count':len(page_counts),'page_payload_u32_at_24_equals_2000_count':sum(p['matched'] for p in page_counts),
             'page_mismatches':[p for p in page_counts if not p['matched']],
             'kind2002_checks':object_ref_checks,'kind2000_sizes_by_header_0c':object_sizes_by_header,
             'build_strings':[{'text':k,'count':v,'example':build_examples[k]} for k,v in builds.items()],
             'odd_payload_examples':odd_examples,
             'kind1300_png_count':len(pngs),'kind1300_png_valid_count':sum(p['valid'] for p in pngs),
             'kind1300_png_offset_equals_payload_plus8':sum(p['png_offset']==p['payload_offset']+8 for p in pngs),
             'kind1300_png_prefix_matches_dimensions':sum(p['valid'] and p['prefix_u32le']==[p['width'],p['height']] for p in pngs),
             'kind1300_png_ends_at_payload_end':sum(p['valid'] and p['end_offset']==p['payload_offset']+p['payload_size'] for p in pngs)}
    summary['kind1100_name_candidate_count']=len(name_candidates)
    summary['kind1100_within_1000_count']=sum(n['within_1000_offset'] is not None for n in name_candidates)
    summary['png_preview_extractions']=previews
    for name,obj in [('gsp-structure.json',summary),('gsp-pages.json',page_counts),('gsp-pngs.json',pngs),('gsp-name-candidates.json',name_candidates)]:
        (args.out/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(summary,ensure_ascii=True,indent=2))


if __name__=='__main__':main()
