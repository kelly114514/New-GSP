/** 独立 Vite 与 Chrome Canvas 基准：npx tsx tools/complex-perf-browser.ts */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const port = 18000 + process.pid % 10000;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* server starting */ }
    if (i === 79) throw Error('Vite 启动失败');
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const storeUrl = '/src/core/store.ts', renderUrl = '/src/ui/render.ts';
    const { Store } = await import(/* @vite-ignore */ storeUrl);
    const { drawPage } = await import(/* @vite-ignore */ renderUrl);
    const st = new Store(); let a = 0;
    st.run('构造', () => {
      a = st.add({ k: 'free', x: 100, y: 100 }).id;
      const b = st.add({ k: 'free', x: 400, y: 100 }).id;
      const path = st.add({ k: 'seg', a, b }).id;
      const driver = st.add({ k: 'onpath', path, t: .5 }).id; let out = driver;
      for (let i = 0; i < 30; i++) { const seg = st.add({ k: 'seg', a: out, b }).id; out = st.add({ k: 'mid', seg }).id; }
      st.add({ k: 'locus', driver, out, samples: 2000 });
    });
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700;
    const ctx = canvas.getContext('2d')!;
    const times: number[] = []; st.begin('drag');
    for (let i = 0; i < 35; i++) {
      const t = performance.now(); st.moveFree(a, 100 + i, 100 + i); st.recompute([a]);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawPage(ctx, st.page, st.results, { selection: new Set(), hideHidden: true, view: { x0: 0, y0: 0, x1: 1000, y1: 700 } });
      // 同步读回使 Canvas 提交实际光栅操作，但不包括合成器与显示刷新。
      ctx.getImageData(0, 0, 1, 1);
      if (i >= 5) times.push(performance.now() - t);
    }
    st.cancel(); times.sort((x, y) => x - y);
    return { scope: 'moveFree + recompute + Canvas draw + 1px readback', samples: 30, p50: times[14], p95: times[28], max: times[29], unit: 'ms', objects: st.page.objects.length, traceSamples: 2000, midpointDepth: 30, userAgent: navigator.userAgent };
  });
  console.log(JSON.stringify(result));
} finally { await browser?.close(); server.kill(); }
