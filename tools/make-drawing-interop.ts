/** 从标记工具开始生成互读夹具。运行前启动开发服务器，输出目录用系统临时目录。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { App } from '../src/app';
import { encodeFile } from '../src/gsp/codec';

declare global { interface Window { __app: App } }

const out = process.argv[2];
if (!out) throw new Error('请指定系统临时目录');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  for (const [name, thick, rise] of [['thin', false, 0], ['thick', true, 50]] as const) {
    const page = await browser.newPage({ viewport: { width: 1250, height: 720 } });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => !!window.__app);
    await page.evaluate(value => {
      const app = window.__app;
      app.settings.marker.thick = value;
      app.setTool('marker');
    }, thick);
    const box = await page.locator('.docwin canvas').last().boundingBox();
    if (!box) throw new Error('找不到绘图区');
    await page.mouse.move(box.x + 160, box.y + 290);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 290 + rise, { steps: 25 });
    await page.mouse.up();
    const current = await page.evaluate(async () => {
      const app = window.__app, view = app.active, store = view.store;
      app.setTool('move');
      const drawing = store.page.objects.find(o => o.def.k === 'image' && o.def.drawing);
      if (!drawing) throw new Error('缺绘图');
      view.setSel([drawing.id]);
      const bare = structuredClone(store.doc);
      bare.pages[0].savedSelection = [drawing.id];
      await app.exec(36977, false);
      await app.exec(36990, false);
      const plot = store.results.get(view.sel[0])?.shape;
      if (plot?.k !== 'paths' || !plot.paths.some(p => p.length > 1)) throw new Error('绘图函数没有生成图像');
      return { bare, plotted: store.doc };
    });
    for (const [suffix, doc] of Object.entries(current)) {
      const saved = encodeFile(doc, undefined);
      if (!saved.ok) throw new Error(saved.reason);
      writeFileSync(join(out, `drawing-${name}-${suffix}.gsp`), saved.bytes);
    }
    await page.close();
  }
} finally { await browser.close(); }
