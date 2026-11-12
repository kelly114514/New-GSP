/** 隔离 WebView2，测打开、Canvas 提交与像素读回。可用 CDP 输入拖动，不占系统鼠标。
 * npx tsx tools/perf/desktop-open.ts <exe> <文件> [--drag [页索引]] [--verify-paths]
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { descendants } from '../../src/core/model';
import { decodeFile } from '../../src/gsp/codec';

const args = process.argv.slice(2);
const verifyPaths = args.includes('--verify-paths');
const [exe, file, drag, pageArg] = args.filter(a => a !== '--verify-paths');
const fullPath = resolve(file);
const { doc } = decodeFile(readFileSync(fullPath), fullPath);
const index = pageArg === undefined ? doc.current : Number(pageArg);
const docPage = doc.pages[index];
if (!docPage) throw Error('页索引无效');
const scores = Object.fromEntries(docPage.objects.filter(o => o.def.k === 'free' && !o.hidden && !o.unselectable).map(o => [o.id, descendants(docPage, [o.id]).size]));
const dir = mkdtempSync(join(tmpdir(), 'gsp-open-'));
const port = 9300 + process.pid % 300;
const child = spawn(resolve(exe), [], { stdio: 'ignore', windowsHide: true, env: {
  ...process.env, NEW_GSP_TEST_RECOVERY_DIR: join(dir, 'recovery'), WEBVIEW2_USER_DATA_FOLDER: join(dir, 'profile'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
} });
const stop = () => {
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
};
const deadline = setTimeout(() => { console.error('打开、绘制或拖动超时（60 秒）'); stop(); }, 60000);
try {
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  if (!browser) throw Error('桌面连接失败');
  const page = browser.contexts()[0].pages()[0];
  page.on('pageerror', e => console.error(e.message));
  await page.waitForFunction(() => !!(window as any).__app?.active);
  await page.evaluate('window.__name = f => f');
  const info = await page.evaluate(async ({ file, drag, scores, index }) => {
    const app = (window as any).__app;
    const proto = Object.getPrototypeOf(app.active);
    const paint = proto.paint;
    const timing = (window as any).__perf = { count: 0, paintMs: 0 };
    proto.paint = function () {
      if (this.path !== file) { paint.call(this); return; }
      const start = performance.now();
      paint.call(this);
      timing.count++;
      timing.paintMs = performance.now() - start;
    };
    const start = performance.now();
    await app.openFile(file);
    const v = app.active, st = v.store;
    if (v.path !== file) throw Error('未打开目标文档');
    if (st.doc.current !== index) st.switchPage(index);
    const openMs = performance.now() - start;
    await new Promise(requestAnimationFrame);
    const read = () => {
      const t = performance.now(), c = v.canvas;
      c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return performance.now() - t;
    };
    (window as any).__perf.read = read;
    const readbackMs = read();
    const opening = { openMs, objects: st.page.objects.length, ...timing, readbackMs, protected: st.protectedReason };
    if (!drag) return { opening };
    for (const b of document.querySelectorAll<HTMLButtonElement>('.dlg button.primary')) b.click();
    const rect = v.overlay.getBoundingClientRect();
    const target = st.page.objects.filter((o: any) => o.def.k === 'free' && !o.hidden && !o.unselectable &&
      o.def.x - v.scroll.x >= 10 && o.def.x - v.scroll.x < rect.width - 50 &&
      o.def.y - v.scroll.y >= 10 && o.def.y - v.scroll.y < rect.height - 50)
      .sort((a: any, b: any) => scores[b.id] - scores[a.id])[0];
    if (!target || st.protectedReason) throw Error('需要可编辑的可见自由点');
    const { x, y } = target.def;
    return { opening, target: { id: target.id, x, y, cx: rect.left + x - v.scroll.x, cy: rect.top + y - v.scroll.y } };
  }, { file: fullPath, drag: !!drag, scores, index });
  console.log(JSON.stringify(info.opening));
  if (info.target) {
    const { id, x, y, cx, cy } = info.target;
    const readFrame = (verify: boolean) => page.evaluate(({ id, verify }) => {
      const w = window as any, v = w.__app.active, st = v.store;
      const def = st.get(id).def;
      const shapes = () => {
        let multi = 0, samples = 0, fingerprint = 2166136261;
        for (const r of st.results.values()) {
          if (r.shape?.k === 'multi') multi += r.shape.items.length;
          if (r.shape?.k !== 'paths') continue;
          for (const p of r.shape.paths) samples += p.length;
          const json = JSON.stringify(r.shape);
          for (let i = 0; i < json.length; i++) fingerprint = Math.imul(fingerprint ^ json.charCodeAt(i), 16777619);
        }
        return { multi, samples, fingerprint: (fingerprint >>> 0).toString(16) };
      };
      const shown = shapes();
      let full;
      if (verify) {
        const { results, ctx } = st;
        // 同一模型、同一视口下另算完整精度。旧构建的活动降精度状态暂时绕过。
        try { st.ctx = { ...ctx, locusDetail: undefined }; st.recompute(); full = shapes(); }
        finally { st.ctx = ctx; st.results = results; }
      }
      return { x: def.x, y: def.y, ...shown, full, paintMs: w.__perf.paintMs, undo: st.undoName, waiting: v.dragCompleting };
    }, { id, verify });
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const picked = await page.evaluate(() => (window as any).__app.active.drag.down?.id);
    if (picked !== id) throw Error(`预期点 ${id}，实际命中 ${picked}`);
    let start = performance.now();
    await page.mouse.move(cx + 21, cy + 13);
    const sentMs = performance.now() - start;
    await page.waitForFunction(({ id, x }) => Math.abs((window as any).__app.active.store.get(id).def.x - x) < 1, { id, x: x + 21 });
    console.log(JSON.stringify({ sentMs, duringMs: performance.now() - start, during: await readFrame(verifyPaths) }));

    await page.mouse.move(cx + 30, cy + 18);
    await page.mouse.move(cx + 35, cy + 19);
    start = performance.now();
    await page.mouse.up();
    const releaseMs = performance.now() - start;
    await page.waitForFunction(() => {
      const v = (window as any).__app.active;
      return !v.dragCompleting && !v.store.refinePending && !v.store.inTransaction;
    });
    const after = await readFrame(verifyPaths);
    const postPaint = await page.evaluate(async () => { await new Promise(requestAnimationFrame); return (window as any).__perf.read(); });
    console.log(JSON.stringify({ releaseMs, settledMs: performance.now() - start, after, postPaint }));
    if (!after.undo || Math.abs(after.x - x - 35) >= 1 || Math.abs(after.y - y - 19) >= 1) throw Error('最终落点有误');
  }
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('exit_app')).catch(() => undefined);
} finally {
  clearTimeout(deadline);
  stop();
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('拒绝清理临时目录之外的路径');
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 300 }); }
  catch (e) { console.error('WebView2 临时目录尚被占用', dir, String(e)); }
}
