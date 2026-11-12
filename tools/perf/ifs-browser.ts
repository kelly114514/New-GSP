/** 浏览器中检查重型 IFS 的拖动结果与相同落点的完整重算。
 * 先启动 npm run dev，再运行 npx tsx tools/perf/ifs-browser.ts <课件路径> [点 ID]。
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const file = process.argv[2];
if (!file) throw Error('需要 IFS 课件路径');
const pointId = Number(process.argv[3] ?? 36);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate('window.__name = f => f');
  const result = await page.evaluate(async ({ data, pointId }) => {
    const paths = ['/src/gsp/codec.ts', '/src/core/store.ts'];
    const { decodeFile } = await import(/* @vite-ignore */ paths[0]);
    const { Store } = await import(/* @vite-ignore */ paths[1]);
    const raw = atob(data), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const doc = decodeFile(bytes, 'x.gsp').doc, st = new Store(doc);
    const point = st.page.objects.find((o: any) => o.id === pointId);
    if (point?.def.k !== 'free') throw Error('指定对象不是自由点');
    const x = point.def.x, y = point.def.y;
    let start = performance.now(); st.recompute(); const openMs = performance.now() - start;
    const timings = [];
    for (let i = 1; i <= 3; i++) {
      start = performance.now(); st.moveFree(pointId, x + 7 * i, y + 5 * i, false); st.recompute([pointId]); timings.push(performance.now() - start);
    }
    const snapshot = async () => {
      const shapeCount = [...st.results.values()].reduce((n: number, r: any) => n + (r.shape?.k === 'multi' ? r.shape.items.length : 0), 0);
      const payload = new TextEncoder().encode(JSON.stringify([...st.results]));
      const digest = await crypto.subtle.digest('SHA-256', payload);
      return { shapeCount, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
    };
    const dragged = await snapshot();
    start = performance.now(); st.recompute(); const fullMs = performance.now() - start;
    return { openMs, dragMs: timings, fullMs, dragged, full: await snapshot() };
  }, { data: readFileSync(file).toString('base64'), pointId });
  console.log(JSON.stringify({ file, pointId, ...result }, null, 2));
  if (result.dragged.sha256 !== result.full.sha256 || result.dragged.shapeCount !== result.full.shapeCount) process.exitCode = 1;
} finally { await browser.close(); }
