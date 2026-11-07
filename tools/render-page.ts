/** 用新版渲染器把 .gsp 画成 PNG（像素对比用）。用法：npx tsx tools/render-page.ts 输入.gsp 输出.png 物理宽 物理高 [屏幕缩放，默认 1.5]
 * 需要开发服务器（npm run dev）在 5173 端口；在浏览器里直接 import 源码模块，不经过界面。 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const [inp, outp, w, h, zoom] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 1000), Number(process.argv[5] ?? 600), Number(process.argv[6] ?? 1.5)];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/'); await page.waitForFunction(() => !!(window as any).__app);
const b64 = readFileSync(inp).toString('base64');
const png = await page.evaluate(async ([data, W, H, Z]) => {
  const P = ['/src/gsp/codec.ts', '/src/core/engine.ts', '/src/ui/render.ts'];
  const { decodeFile } = await import(/* @vite-ignore */ P[0]); const { evaluatePage } = await import(/* @vite-ignore */ P[1]); const { drawPage } = await import(/* @vite-ignore */ P[2]);
  const bin = atob(data as string), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const doc = decodeFile(bytes, 'x.gsp').doc, pg = doc.pages[0], res = evaluatePage(pg);
  const c = document.createElement('canvas'); c.width = W as number; c.height = H as number; const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  const z = Z as number; const sc = pg.scroll ?? { x: 0, y: 0 }; ctx.setTransform(z, 0, 0, z, -sc.x * z, -sc.y * z);   // 和应用里一样：页面坐标是逻辑像素，画布按屏幕缩放放大
  drawPage(ctx, pg, res, { selection: new Set(), hideHidden: true, view: { x0: sc.x, y0: sc.y, x1: sc.x + (W as number) / z, y1: sc.y + (H as number) / z } });
  return c.toDataURL('image/png').split(',')[1];
}, [b64, w, h, zoom] as const);
writeFileSync(outp, Buffer.from(png, 'base64'));
await browser.close();
console.log('写出', outp);
