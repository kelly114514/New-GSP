"""第十八轮调查：按公式独立模拟 1122（Hopalong，5 万步），用几种单位换算写法分别与原版截图逐像素比较。
结论：单位取 厘米*96/2.54（1.644166666666706）并用 (p-原点)/单位 时交并比 0.874，其余写法 0.30-0.40（见 docs/兼容性报告.md 第十八轮调查第 2 条）。
由脚本调用新版引擎计算采样点，也可传入已经生成的点列表文件。
原版截图取 %TEMP%/gsp-lib-capture/orig/1122.png，不进项目。用法：python tools/r18-hopalong-match.py [点列表]"""
import math,os,subprocess,sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation
T=os.environ['TEMP']
o=np.asarray(Image.open(T+'/gsp-lib-capture/orig/1122.png').convert('L'))<128
o[:,:250]=False; o[:95]=False   # 去掉左侧文字和标题
if len(sys.argv) > 1:
    with open(sys.argv[1], encoding="utf-8-sig") as file:
        rows = file.readlines()
else:
    npm = "npx.cmd" if os.name == "nt" else "npx"
    rows = subprocess.check_output([npm, "tsx", "tools/r18-iter-points.ts", "1122", "0-49999"], encoding="utf-8").splitlines()
E = [tuple(map(float, line.split()[1:])) for line in rows if line.startswith("   ") and len(line.split()) == 3]
ox,oy=630.0,278.0
a,b,c=55.17,0.97,42.05000000000001
def sim(variant,N=50000):
    cm=96/2.54; ucm=0.043501909722223266; u=ucm*cm
    if variant == "px":
        u = ucm * 96 / 2.54
    px,py=634.0,273.0; S=[]
    for i in range(N):
        if variant=='px':
            x=(px-ox)/u; y=(oy-py)/u
        elif variant=='cm':
            x=((px-ox)/cm)/ucm; y=((oy-py)/cm)/ucm
        elif variant=='mul':
            x=(px-ox)*(1/u); y=(oy-py)*(1/u)
        sg=(x>0)-(x<0)
        x2=y-sg*math.sqrt(abs(b*x-c)); y2=a-x
        if variant=='cm': px=ox+(x2*ucm)*cm; py=oy-(y2*ucm)*cm
        else: px=ox+x2*u; py=oy-y2*u
        S.append((px,py))
    return S
def score(P,name):
    m=np.zeros_like(o)
    for x,y in P:
        xi=int(round(x-168)); yi=int(round(y+72))
        if 0<=xi<m.shape[1] and 0<=yi<m.shape[0]: m[yi,xi]=True
    K=np.ones((5,5),bool)
    pc=(m&binary_dilation(o,K)).sum()/m.sum(); oc=(o&binary_dilation(m,K)).sum()/o.sum()
    print(name,'points on orig ink',round(pc,3),'orig ink near points',round(oc,3))
score(E,'engine')
for v in ('px','cm','mul'): score(sim(v),'sim-'+v)
print('---- exact IoU')
def iou(P,name):
    best=None
    for size,off in ((1,0),(2,0),(2,-1),(3,-1),(4,-1),(4,-2),(5,-2)):
        for rnd in ('round','floor'):
            m=np.zeros_like(o)
            for x,y in P:
                fx=x-168; fy=y+72
                xi=int(round(fx)) if rnd=='round' else int(math.floor(fx)); yi=int(round(fy)) if rnd=='round' else int(math.floor(fy))
                x0=xi+off; y0=yi+off
                if 0<=x0 and x0+size<=m.shape[1] and 0<=y0 and y0+size<=m.shape[0]: m[y0:y0+size,x0:x0+size]=True
            v=(m&o).sum()/(m|o).sum()
            if best is None or v>best[0]: best=(round(float(v),4),size,off,rnd)
    print(name,best)
iou(E,'engine')
for v in ('px','cm','mul'): iou(sim(v),'sim-'+v)
for n in (40000,45000,49000,49999,50001,51000): iou(sim('px',n),'sim-px n=%d'%n)
print('---- bbox')
for v in ('px','cm','mul'):
    S=sim(v); xs=[p[0] for p in S]; ys=[p[1] for p in S]
    print(v, round(max(xs)-min(xs)), round(max(ys)-min(ys)), 'distinct px', len({(int(x),int(y)) for x,y in S}))
xs=[p[0] for p in E]; ys=[p[1] for p in E]; print('engine', round(max(xs)-min(xs)), round(max(ys)-min(ys)), 'distinct px', len({(int(x),int(y)) for x,y in E}))
print('orig ink px', int(o.sum()))
print('---- u variants')
def sim2(u, conv, N=50000):
    px,py=634.0,273.0; S=[]
    for i in range(N):
        if conv=='div': x=(px-ox)/u; y=(oy-py)/u
        else: x=(px-ox)*(1/u); y=(oy-py)*(1/u)
        sg=(x>0)-(x<0)
        x2=y-sg*math.sqrt(abs(b*x-c)); y2=a-x
        px=ox+x2*u; py=oy-y2*u
        S.append((px,py))
    return S
ucm=0.043501909722223266
us={'ucm*96/2.54':ucm*96/2.54,'ucm*(96/2.54)':ucm*(96/2.54),'ucm/2.54*96':ucm/2.54*96,'ucm*37.795275590551178':ucm*37.795275590551178,'ucm/(2.54/96)':ucm/(2.54/96)}
for name,u in us.items():
    for conv in ('div','mul'):
        S=sim2(u,conv); xs=[p[0] for p in S]
        print(name,conv,repr(u),'width',round(max(xs)-min(xs)),end=' '); iou(S,'')
print('---- per-range exact hit')
S=sim2(ucm*96/2.54,'div')
for i0 in range(0,50000,10000):
    hit=0;tot=0
    for x,y in S[i0:i0+10000]:
        xi=int(math.floor(x-168)); yi=int(math.floor(y+72))
        if 0<=xi<o.shape[1]-1 and 0<=yi<o.shape[0]-1:
            tot+=1; hit+=bool(o[yi,xi] and o[yi+1,xi+1] and o[yi,xi+1] and o[yi+1,xi])
    print(i0, hit, tot)
m=np.zeros_like(o)
for x,y in S:
    xi=int(math.floor(x-168)); yi=int(math.floor(y+72)); m[yi:yi+2,xi:xi+2]=True
print('orig-only px',int((o&~m).sum()),'sim-only px',int((m&~o).sum()),'both',int((m&o).sum()))
ys,xs=np.nonzero(o&~m); print('orig-only bbox',xs.min(),xs.max(),ys.min(),ys.max())
