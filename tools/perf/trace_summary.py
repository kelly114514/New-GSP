"""汇总 Chromium trace：各线程忙碌比例、最耗时事件、合成器呈现节奏。用法：python trace_summary.py trace.json"""
import json, sys, collections
evs = json.load(open(sys.argv[1], encoding='utf8'))['traceEvents']
pn, tn = {}, {}
for e in evs:
    if e.get('ph') == 'M' and e['name'] == 'process_name':
        pn[e['pid']] = e['args']['name']
    if e.get('ph') == 'M' and e['name'] == 'thread_name':
        tn[(e['pid'], e['tid'])] = e['args']['name']
ts = [e['ts'] for e in evs if e.get('ph') == 'X']
span = (max(ts) - min(ts)) / 1e3 if ts else 1
print(f'span {span:.0f} ms, events {len(evs)}')
by = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
for e in evs:
    if e.get('ph') == 'X' and 'dur' in e:
        k = (pn.get(e['pid'], '?'), tn.get((e['pid'], e['tid']), str(e['tid'])))
        c = by[k][e['name']]
        c[0] += e['dur'] / 1e3
        c[1] += 1
for k, m in sorted(by.items(), key=lambda kv: -sum(v[0] for n, v in kv[1].items() if n in ('ThreadPool_RunTask', 'ThreadControllerImpl::RunTask', 'SequenceManager::DoWork', 'RunTask', 'Scheduler::RunTask', 'GPUTask', 'CommandBufferStub::OnAsyncFlush', 'ThreadController active'))):
    top = sorted(m.items(), key=lambda kv: -kv[1][0])[:9]
    if top[0][1][0] < span * .01:
        continue
    print(f'\n== {k[0]} / {k[1]}')
    for n, (d, c) in top:
        print(f'  {d:9.1f} ms  {c:6d}×  avg {d / c:7.2f}  {n}')
# 呈现节奏：优先用 DrawAndSwap 与 Swap
for name in ('Display::DrawAndSwap', 'DirectRenderer::DrawFrame', 'SwapBuffers', 'BeginMainThreadFrame', 'Commit', 'RasterTask', 'Canvas2DLayerBridge::FinalizeFrame', 'CanvasResourceProvider::FlushCanvas'):
    t = sorted(e['ts'] for e in evs if e.get('ph') in ('X', 'B') and e['name'] == name)
    if len(t) > 2:
        g = sorted((b - a) / 1e3 for a, b in zip(t, t[1:]))
        print(f'{name}: n={len(t)} gap p50={g[len(g) // 2]:.1f} p95={g[int(len(g) * .95)]:.1f} max={g[-1]:.1f}')
