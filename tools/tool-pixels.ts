/**
 * 像素对照：原版工具执行后的绘图区截图 vs 新版渲染新版重放结果（同输入）。
 * 用法：npx tsx tool_pixels.ts <out目录> <报告.json> [组号...]；需要开发服务器 5173。
 * tool_compare.ts 先写好 NNN.new.json（路径点参数已抄自原版）。差的工具额外写 NNN.diff.png。
 */
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, reportPath, ...only] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1785, height: 954 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/'); await page.waitForFunction(() => !!(window as any).__app);
await page.evaluate('window.__name = f => f');   // tsx 给箭头函数加的辅助名
await page.evaluate(async () => {
  const P = ['/src/core/engine.ts', '/src/ui/render.ts', '/src/gsp/codec.ts'];
  const [{ evaluatePage }, { drawPage, applyDisplay }, { decodeFile }] = await Promise.all(P.map(p => import(/* @vite-ignore */ p)));
  const modelPath = '/src/core/model.ts'; const DD = await import(/* @vite-ignore */ modelPath);
  (window as any).__cmp = async (docJson: string, png: string, fixPng: string, fixGsp: string, wantDiff: boolean) => {
    const doc = JSON.parse(docJson), pg = doc.pages[doc.current ?? 0];
    const W = 1785, H = 954, z = 1.5, sc = pg.scroll ?? { x: 0, y: 0 };
    const view = { x0: sc.x, y0: sc.y, x1: sc.x + W / z, y1: sc.y + H / z };
    applyDisplay(doc.settings?.display ?? DD.DEFAULT_DISPLAY);
    const res = evaluatePage(pg, undefined, undefined, { view, angleUnit: doc.settings.display?.angleUnit });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(z, 0, 0, z, -sc.x * z, -sc.y * z);
    drawPage(ctx, pg, res, { selection: new Set(), hideHidden: true, view });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const n = ctx.getImageData(0, 0, W, H).data;
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const ctx2 = c2.getContext('2d', { willReadFrequently: true })!; ctx2.drawImage(img, 0, 0);
    const o = ctx2.getImageData(0, 0, W, H).data;
    const ink = (d: Uint8ClampedArray) => { const a = new Uint8Array(W * H); for (let y = 2; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 255) + Math.abs(d[i + 2] - 255) > 60) a[y * W + x] = 1; } return a; };
    const imgF = new Image(); imgF.src = 'data:image/png;base64,' + fixPng; await imgF.decode();
    ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, W, H); ctx2.drawImage(imgF, 0, 0);
    const io = ink(o), in_ = ink(n), R = 2, fixInk = ink(ctx2.getImageData(0, 0, W, H).data);
    // 夹具已有的墨迹（放大 2 像素）不计入，只比较工具产生的部分
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fixInk[y * W + x]) for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) mask[yy * W + xx] = 1;
    const newUrl = c.toDataURL('image/png').split(',')[1];
    // 新版一侧也要遮掉它自己画的夹具，否则夹具文字的字体差异会算到工具头上
    const bin = atob(fixGsp), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = decodeFile(bytes, 'x.gsp').doc, fp = fd.pages[fd.current ?? 0];
    const c3 = document.createElement('canvas'); c3.width = W; c3.height = H; const ctx3 = c3.getContext('2d', { willReadFrequently: true })!;
    ctx3.fillStyle = '#fff'; ctx3.fillRect(0, 0, W, H); ctx3.setTransform(z, 0, 0, z, -sc.x * z, -sc.y * z);
    drawPage(ctx3, fp, evaluatePage(fp, undefined, undefined, { view, angleUnit: fd.settings.display?.angleUnit }), { selection: new Set(), hideHidden: true, view });
    ctx3.setTransform(1, 0, 0, 1, 0, 0);
    const newFix = ink(ctx3.getImageData(0, 0, W, H).data), mask2 = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (newFix[y * W + x]) for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) mask2[yy * W + xx] = 1;
    const near = (a: Uint8Array, x: number, y: number) => { for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) if (a[yy * W + xx]) return true; return false; };
    let no = 0, nn = 0, mo = 0, mn = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (io[y * W + x] && !mask[y * W + x]) { no++; if (near(in_, x, y)) mo++; }
      if (in_[y * W + x] && !mask2[y * W + x]) { nn++; if (near(io, x, y)) mn++; }
    }
    let diff: string | undefined;
    if (wantDiff) {
      const out = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) { const a = io[i], b = in_[i]; out.data[i * 4] = a && b ? 150 : a ? 220 : b ? 0 : 255; out.data[i * 4 + 1] = a && b ? 150 : a || b ? 0 : 255; out.data[i * 4 + 2] = a && b ? 150 : a ? 0 : b ? 220 : 255; out.data[i * 4 + 3] = 255; }
      ctx.putImageData(out, 0, 0); diff = c.toDataURL('image/png').split(',')[1];
    }
    return { inkOriginal: no, inkNew: nn, originalCovered: no ? mo / no : 1, newCovered: nn ? mn / nn : 1, diff, newUrl };
  };
});
const rows: any[] = [];
for (const dirName of readdirSync(outDir).sort()) {
  if (only.length && !only.includes(dirName)) continue;
  const dir = join(outDir, dirName);
  for (const f of readdirSync(dir).filter(x => /^\d+\.new\.json$/.test(x)).sort()) {
    const idx = f.slice(0, 3), png = join(dir, `${idx}.png`);
    if (!existsSync(png)) continue;
    const r: any = await page.evaluate(([j, p, fx, fg]) => (window as any).__cmp(j, p, fx, fg, true), [readFileSync(join(dir, f), 'utf8'), readFileSync(png).toString('base64'), readFileSync(join(dir, 'fixture.png')).toString('base64'), readFileSync(join(dir, 'fixture.gsp')).toString('base64')] as const).catch(e => ({ error: String(e) }));
    const bad = r.error || r.originalCovered < 0.85 || r.newCovered < 0.85;
    if (bad && r.diff) { writeFileSync(join(dir, `${idx}.diff.png`), Buffer.from(r.diff, 'base64')); writeFileSync(join(dir, `${idx}.newr.png`), Buffer.from(r.newUrl, 'base64')); }
    delete r.diff; delete r.newUrl;
    rows.push({ group: dirName, index: Number(idx), ...r });
  }
}
await browser.close();
const hist = (key: string) => { const h: Record<string, number> = {}; for (const r of rows) { const v = r[key]; const b = r.error ? 'error' : v >= .98 ? '>=98' : v >= .9 ? '90-98' : v >= .7 ? '70-90' : '<70'; h[b] = (h[b] ?? 0) + 1; } return h; };
writeFileSync(reportPath, JSON.stringify(rows));
console.log(rows.length, 'original covered', hist('originalCovered'), 'new covered', hist('newCovered'));
