/** 用新版渲染器批量把课件画成 PNG，与原版截图（reference/raw/runtime/capture_library.py）逐个对照。
 * 用法：npx tsx tools/render-library.ts 列表.txt 原版截图目录 输出目录 [--only=序号,序号] [--overwrite] [--timeout-ms=毫秒]
 * 列表每行一个 .gsp 路径，序号与原版截图目录里的 NNNN.png、index.json 对应。视图尺寸取原版截图尺寸，缺省 1190×636。
 * 页面坐标按 1:1 画（PrintWindow 在 150% 缩放下按 96 dpi 输出）。需要开发服务器（npm run dev）在 5173 端口。
 */
import { chromium, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [listPath, origDir, outDir, ...options] = process.argv.slice(2);
const selection = options.find(o => o.startsWith('--only='));
const only = selection ? new Set(selection.slice('--only='.length).split(',').map(s => {
  if (!/^\d+$/.test(s)) throw new Error(`无效的截图序号：${s}`);
  return Number(s);
})) : undefined;
const overwrite = options.includes('--overwrite');
const timeoutOption = options.find(o => o.startsWith('--timeout-ms='));
const timeoutMs = timeoutOption ? Number(timeoutOption.slice('--timeout-ms='.length)) : 60000;
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('截图超时应为 1000 至 600000 毫秒');
const items = readFileSync(listPath, 'utf8').split(/\r?\n/).filter(Boolean);
const index: Record<string, { size?: [number, number] }> = existsSync(join(origDir, 'index.json')) ? JSON.parse(readFileSync(join(origDir, 'index.json'), 'utf8')) : {};
mkdirSync(outDir, { recursive: true });
let browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let page!: Page;
async function fresh(relaunch = false) {
  // 超时后页面可能仍在死循环里，关页面会卡住：直接重启浏览器
  if (relaunch) { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]); browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }); }
  page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/'); await page.waitForFunction(() => !!(window as { __app?: unknown }).__app);
}
await fresh();
const log: Record<string, unknown> = existsSync(join(outDir, 'render.json')) ? JSON.parse(readFileSync(join(outDir, 'render.json'), 'utf8')) : {};
for (let i = 0; i < items.length; i++) {
  if (only && !only.has(i)) continue;
  const key = String(i).padStart(4, '0'), out = join(outDir, `${key}.png`);
  if (!overwrite && (existsSync(out) || (log[key] as { error?: string } | undefined)?.error)) continue;
  const [W, H] = index[key]?.size ?? [1190, 636];
  const b64 = readFileSync(items[i]).toString('base64');
  const t0 = Date.now();
  try {
    const job = page.evaluate(async ([data, W, H]) => {
      const P = ['/src/gsp/codec.ts', '/src/core/engine.ts', '/src/ui/render.ts', '/src/core/model.ts'];
      const { decodeFile } = await import(/* @vite-ignore */ P[0]); const { evaluatePage } = await import(/* @vite-ignore */ P[1]); const { drawPage, applyDisplay } = await import(/* @vite-ignore */ P[2]);
      const { pageDisplay } = await import(/* @vite-ignore */ P[3]);
      const bin = atob(data as string), bytes = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      const doc = decodeFile(bytes, 'x.gsp').doc, pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
      const sc = pg.scroll ?? { x: 0, y: 0 };
      const view = { x0: sc.x, y0: sc.y, x1: sc.x + (W as number), y1: sc.y + (H as number) };
      const prefs = pageDisplay(doc, pg);
      const res = evaluatePage(pg, undefined, undefined, { angleUnit: prefs.angleUnit, view });
      // 同一浏览器连续处理多个课件：没有文档设置时也必须恢复默认，不能继承上一份的精度或字体。
      applyDisplay(prefs);
      const c = document.createElement('canvas'); c.width = W as number; c.height = H as number; const ctx = c.getContext('2d')!;
      // 裁剪和图片变换必须有图片原象。纯几何变换不需要等异步解码。
      const images = pg.objects.some((o: { def: { k: string } }) => o.def.k === 'image');
      for (let pass = 0; pass < (images ? 2 : 1); pass++) {
        if (pass) await new Promise(r => setTimeout(r, 400));
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = pg.background ?? prefs.background; ctx.fillRect(0, 0, c.width, c.height);
        ctx.setTransform(1, 0, 0, 1, -sc.x, -sc.y);
        drawPage(ctx, pg, res, { selection: new Set(), hideHidden: true, view });
      }
      let undef = 0, unsupported = 0;
      for (const r of res.values()) { if (r.status === 'undefined') undef++; else if (r.status !== 'ok') unsupported++; }
      return { png: c.toDataURL('image/png').split(',')[1], page: doc.current ?? 0, undef, unsupported };
    }, [b64, W, H] as const);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('超时')), timeoutMs); });
    const r = await Promise.race([job, timeout]).finally(() => clearTimeout(timer));
    writeFileSync(out, Buffer.from(r.png, 'base64'));
    log[key] = { src: items[i], ms: Date.now() - t0, page: r.page, undef: r.undef, unsupported: r.unsupported };
  } catch (e) {
    log[key] = { src: items[i], error: String((e as Error).message).slice(0, 300) };
    await fresh(true);
  }
  if (i % 20 === 0) { writeFileSync(join(outDir, 'render.json'), JSON.stringify(log, null, 0)); console.log(key, Date.now() - t0, 'ms'); }
}
writeFileSync(join(outDir, 'render.json'), JSON.stringify(log, null, 0));
await browser.close();
