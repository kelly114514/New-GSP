/** 真实桌面拖动基准：启动 release 主程序，用真实鼠标（SendInput）拖动点，在 WebView2 里记录帧与事件。
 * 会占用鼠标；只在用户同意时运行。
 * npx tsx tools/desktop-drag-perf.ts [--exe path] [--ms 4000] [--profile out.cpuprofile] [--trace out.json] <文件...>
 * 不带文件时用自制的小文档（一个三角形）。 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { newDoc, defaultStyle, type Def, type Obj } from '../src/core/model';
import { encodeNgsp } from '../src/gsp/codec';

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const exe = resolve(opt('--exe') ?? 'src-tauri/target/release/new-gsp.exe');
const profileOut = opt('--profile'), traceOut = opt('--trace'), shotDir = opt('--shot');
const ms = Number(opt('--ms') ?? 4000);
const dir = mkdtempSync(join(tmpdir(), 'new-gsp-drag-'));
const py = (...a: (string | number)[]) => { const r = spawnSync('python', ['tools/perf/real_drag.py', ...a.map(String)], { encoding: 'utf8' }); if (r.status) throw Error(r.stderr); return r.stdout.trim(); };

function smallDoc(): string {
  const doc = newDoc('小文档'); const o = doc.pages[0].objects;
  const add = (def: Def, extra: Partial<Obj> = {}) => { const id = o.length + 1; o.push({ id, def, style: defaultStyle(def), hidden: false, labelShown: false, ...extra }); return id; };
  const a = add({ k: 'free', x: 300, y: 200 }), b = add({ k: 'free', x: 700, y: 250 }), c = add({ k: 'free', x: 500, y: 550 });
  add({ k: 'seg', a, b }); add({ k: 'seg', a: b, b: c }); add({ k: 'seg', a: c, b: a });
  doc.pages[0].nextId = o.length + 1;
  const f = join(dir, 'small.ngsp'); writeFileSync(f, encodeNgsp(doc)); return f;
}

const q = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };

function printHot(p: any) {
  const self = new Map<number, number>(); const dt = p.timeDeltas as number[];
  (p.samples as number[]).forEach((id, i) => self.set(id, (self.get(id) ?? 0) + dt[i]));
  const by = new Map<string, number>();
  for (const n of p.nodes) { const c = n.callFrame, key = `${c.functionName || '(anon)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}:${c.columnNumber}`; by.set(key, (by.get(key) ?? 0) + (self.get(n.id) ?? 0)); }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  console.log([...by].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / total * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)}ms  ${k}`).join('\n'));
}

const log = (m: string) => { if (process.env.PERF_DEBUG) console.error(`[${(performance.now() / 1000).toFixed(1)}s] ${m}`); };
async function run(file: string) {
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const port = 9500 + Math.floor(Math.random() * 400);
  const child = spawn(exe, [file], { stdio: 'ignore', env: { ...process.env, NEW_GSP_TEST_RECOVERY_DIR: join(dir, 'recovery'), WEBVIEW2_USER_DATA_FOLDER: join(dir, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  try {
    for (let i = 0; i < 80 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise(r => setTimeout(r, 500)); } }
    if (!browser) throw Error('连接失败');
    log('已连接');
    const page = browser.contexts()[0].pages()[0];
    await page.waitForFunction(() => (window as any).__app?.active?.path, undefined, { timeout: 60000 });
    log('文档已打开');
    page.on('console', m => log(`console ${m.text()}`)); page.on('pageerror', e => log(`pageerror ${e.message}`));
    const hwnd = py('prep', child.pid!);
    log(`窗口 ${hwnd}`);
    await new Promise(r => setTimeout(r, 800));
    { const b = await browser.newBrowserCDPSession(); const g = await b.send('SystemInfo.getInfo') as any; log(`GPU ${JSON.stringify(g.gpu.devices)} ${JSON.stringify(g.gpu.featureStatus)}`); }
    await page.evaluate('window.__name = f => f');   // tsx 的 keepNames 会在函数体里调用 __name
    const info = await page.evaluate(() => {
      const app = (window as any).__app, v = app.active, st = v.store;
      for (const b of document.querySelectorAll<HTMLButtonElement>('.dlg button.primary, .dlg button')) { if (/确定|是|OK/.test(b.textContent ?? '')) { console.log('dialog: ' + document.querySelector('.dlg')?.textContent); b.click(); break; } }
      // 切到对象最多的页
      let best = 0; st.doc.pages.forEach((p: any, i: number) => { if (p.objects.length > st.doc.pages[best].objects.length) best = i; });
      if (best !== st.doc.current) st.switchPage(best);
      const objs = st.page.objects, kids = new Map<number, number[]>();
      const parents = (o: any) => { const out: number[] = []; const walk = (x: any) => { if (typeof x === 'number') out.push(x); }; for (const key of Object.keys(o.def)) { const val = o.def[key]; walk(val); if (Array.isArray(val)) val.forEach(walk); } return out; };
      for (const o of objs) for (const p of parents(o)) (kids.get(p) ?? kids.set(p, []).get(p)!).push(o.id);
      const count = (id: number) => { const seen = new Set<number>(); const go = (i: number) => { for (const k of kids.get(i) ?? []) if (!seen.has(k)) { seen.add(k); go(k); } }; go(id); return seen.size; };
      const r = v.viewRect(); let target: any;
      for (const o of objs) {
        if (o.def.k !== 'free' || o.hidden || o.unselectable) continue;
        const s = st.results.get(o.id)?.shape; if (s?.k !== 'pt') continue;
        if (s.p.x < r.x0 + 20 || s.p.x > r.x1 - 20 || s.p.y < r.y0 + 20 || s.p.y > r.y1 - 20) continue;
        const n = count(o.id); if (!target || n > target.n) target = { id: o.id, n, x: s.p.x, y: s.p.y };
      }
      if (!target) return { error: '没有可见的自由点', objects: objs.length };
      const box = v.canvas.getBoundingClientRect();
      // 埋点
      const w = window as any; const rec = w.__rec = { frames: [] as number[], paints: [] as number[], recomputes: [] as number[], moves: 0, moveCost: [] as number[], moveDelay: [] as number[], on: false };
      const tick = (t: number) => { if (rec.on) rec.frames.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      const paint = v.paint; v.paint = function () { const t = performance.now(); paint.call(v); if (rec.on) rec.paints.push(performance.now() - t); };
      const rc = st.recompute; st.recompute = function (...a: any[]) { const t = performance.now(); rc.apply(st, a); if (rec.on) rec.recomputes.push(performance.now() - t); };
      for (const name of ['onDown', 'onUp']) { const f = v[name]; v[name] = function (e: PointerEvent) { const t = performance.now(); f.call(v, e); (rec as any)[name] = +(performance.now() - t).toFixed(1); }; }
      const om = v.onMove; v.onMove = function (e: PointerEvent) { const t = performance.now(); om.call(v, e); if (rec.on) { rec.moves++; rec.moveCost.push(performance.now() - t); rec.moveDelay.push(t - e.timeStamp); } };
      return { target, objects: objs.length, page: st.doc.current, protected: st.protectedReason, cssX: box.left + target.x - v.scroll.x, cssY: box.top + target.y - v.scroll.y, dpr: devicePixelRatio, canvas: [v.canvas.width, v.canvas.height], view: [r.x1 - r.x0, r.y1 - r.y0] };
    }) as any;
    if (info.error) { console.log(JSON.stringify({ file: basename(file), ...info })); return; }
    log(`目标 ${JSON.stringify(info)}`);
    const cdp = await page.context().newCDPSession(page);
    if (profileOut) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    const bcdp = traceOut ? await browser.newBrowserCDPSession() : undefined;
    const events: any[] = [];
    if (bcdp) {
      bcdp.on('Tracing.dataCollected', (d: any) => events.push(...d.value));
      await bcdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'viz', 'benchmark', 'input', 'latencyInfo'] } } as any);
    }
    await page.evaluate(shot => {
      const w = window as any; w.__rec.on = true;
      if (shot) window.setTimeout(() => { const v = w.__app.active; w.__midShot = v.canvas.toDataURL('image/png'); w.__midCount = [...v.store.results.values()].reduce((n: number, r: any) => n + (r.shape?.k === 'paths' ? r.shape.paths.reduce((m: number, p: unknown[]) => m + p.length, 0) : 0), 0); }, 1500);
    }, !!shotDir);
    const span = Math.min(info.view[0], info.view[1]);
    const sent = py('drag', hwnd, info.cssX, info.cssY, info.dpr, Math.min(150, info.view[0] * .2, Math.max(20, info.target.x - 10)), Math.min(150, span * .2), ms);
    log(`拖动结束 ${sent}`);
    await page.waitForFunction(() => !(window as any).__app.active.dragCompleting, undefined, { timeout: 120000 });
    const rec = await page.evaluate(() => {
      const w = window as any, r = w.__rec; r.on = false; const v = w.__app.active, st = v.store;
      // 松手后的轨迹和迭代象都与完整求值对照。
      const lociJson = () => JSON.stringify(st.page.objects.filter((o: any) => (o.def.k === 'locus' || o.def.k === 'iterimg')).map((o: any) => st.results.get(o.id)));
      const shown = lociJson(); const keep = st.results; st.recompute(); const same = shown === lociJson(); st.results = keep;
      return { ...r, dragged: st.undoName, finalMatchesFull: same, restShot: w.__midShot ? v.canvas.toDataURL('image/png') : undefined, midShot: w.__midShot, midCount: w.__midCount, restCount: [...st.results.values()].reduce((n: number, x: any) => n + (x.shape?.k === 'paths' ? x.shape.paths.reduce((m: number, p: unknown[]) => m + p.length, 0) : 0), 0) };
    }) as any;
    if (shotDir && rec.midShot) { const png = (u: string) => Buffer.from(u.split(',')[1], 'base64'); writeFileSync(join(shotDir, `${basename(file)}.mid.png`), png(rec.midShot)); writeFileSync(join(shotDir, `${basename(file)}.rest.png`), png(rec.restShot)); }
    if (profileOut) { const { profile } = await cdp.send('Profiler.stop') as any; writeFileSync(profileOut, JSON.stringify(profile)); printHot(profile); }
    if (bcdp) { await new Promise<void>(res => { bcdp.once('Tracing.tracingComplete', () => res()); void bcdp.send('Tracing.end'); }); writeFileSync(traceOut!, JSON.stringify({ traceEvents: events })); }
    const gaps = rec.frames.slice(1).map((t: number, i: number) => t - rec.frames[i]) as number[];
    console.log(JSON.stringify({ file: basename(file), protected: info.protected, finalMatchesFull: rec.finalMatchesFull, midPts: rec.midCount, restPts: rec.restCount, objects: info.objects, page: info.page, descendants: info.target.n, canvas: info.canvas, dpr: info.dpr, undo: rec.dragged, sentMoves: Number(sent), events: rec.moves, downMs: rec.onDown, upMs: rec.onUp,
      fps: +(gaps.length / (gaps.reduce((a, b) => a + b, 0) / 1000 || 1)).toFixed(1), gap: { p50: q(gaps, .5), p95: q(gaps, .95), p99: q(gaps, .99), max: q(gaps, 1) }, slow: { over8ms: gaps.filter(g => g > 8).length, over17ms: gaps.filter(g => g > 17).length, over33ms: gaps.filter(g => g > 33).length, frames: gaps.length },
      paint: { p50: q(rec.paints, .5), p95: q(rec.paints, .95), max: q(rec.paints, 1) }, recompute: { calls: rec.recomputes.length, p50: q(rec.recomputes, .5), p95: q(rec.recomputes, .95) }, onMove: { p50: q(rec.moveCost, .5), p95: q(rec.moveCost, .95) }, inputDelay: { p50: q(rec.moveDelay, .5), p95: q(rec.moveDelay, .95), max: q(rec.moveDelay, 1) } }));
    await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('exit_app')).catch(() => undefined);
  } finally {
    await browser?.close().catch(() => undefined);
    if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}

try { for (const f of argv.length ? argv : [smallDoc()]) await run(resolve(f)); }
catch (e) { console.error(e); process.exitCode = 1; }
finally { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* WebView2 还没退干净，留给系统临时目录 */ } process.exit(process.exitCode ?? 0); }
