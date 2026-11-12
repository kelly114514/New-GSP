/** 浏览器中分别运行通用和快速迭代，比较同一课件完整求值指纹及耗时。
 * 先启动 npm run dev，再运行 npx tsx tools/perf/mira-browser.ts [课件路径]。
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const file = process.argv[2] ?? '../sketchpad5/Samples/分形艺术/Mira分形-三鹰翅.gsp';
const data = readFileSync(file).toString('base64');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  const result = await page.evaluate(async data => {
    const paths = ['/src/gsp/codec.ts', '/src/core/engine.ts', '/src/core/model.ts', '/src/core/iterfast.ts'];
    const { decodeFile } = await import(/* @vite-ignore */ paths[0]);
    const { evaluatePage } = await import(/* @vite-ignore */ paths[1]);
    const { pageDisplay } = await import(/* @vite-ignore */ paths[2]);
    const { iterFast } = await import(/* @vite-ignore */ paths[3]);
    const raw = atob(data), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const doc = decodeFile(bytes, 'x.gsp').doc, pg = doc.pages[doc.current], prefs = pageDisplay(doc, pg);
    const runs = [];
    for (const enabled of [false, true]) {
      iterFast.enabled = enabled;
      const start = performance.now();
      const values = evaluatePage(pg, undefined, undefined, { angleUnit: prefs.angleUnit });
      const ms = performance.now() - start;
      const payload = new TextEncoder().encode(JSON.stringify([...values]));
      const digest = await crypto.subtle.digest('SHA-256', payload);
      runs.push({ enabled, ms, objects: values.size, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') });
    }
    return runs;
  }, data);
  console.log(JSON.stringify({ file, runs: result }, null, 2));
  if (result[0].sha256 !== result[1].sha256 || result[0].objects !== result[1].objects) process.exitCode = 1;
} finally { await browser.close(); }
