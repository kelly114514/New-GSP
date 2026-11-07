import { expect, test } from '@playwright/test';

declare global { interface Window { __app: any } }

for (const dpr of [1, 1.5, 2]) {
  test.describe(`系统缩放 ${dpr * 100}%`, () => {
    test.use({ deviceScaleFactor: dpr });
    test(`命中半径按物理像素：点 10 px 内命中、12 px 外不命中；画布像素 = CSS × ${dpr}`, async ({ page }) => {
      await page.goto('/'); await page.waitForFunction(() => !!window.__app);
      // 页面坐标是逻辑像素（CSS 像素）：物理 300 像素处 = 页面坐标 300 / dpr
      const info = await page.evaluate(d => { const v = window.__app.active; v.store.run('x', () => { v.store.add({ k: 'free', x: 300 / d, y: 300 / d }); }); const r = v.canvas.getBoundingClientRect(); return { cssW: r.width, w: v.canvas.width, dpr: window.devicePixelRatio, left: r.left, top: r.top }; }, dpr);
      expect(info.dpr).toBe(dpr);
      expect(Math.abs(info.w - info.cssW * dpr)).toBeLessThanOrEqual(1);
      const at = (px: number, py: number) => ({ x: info.left + px / dpr, y: info.top + py / dpr });
      const sel = async (px: number, py: number) => { await page.evaluate(() => window.__app.active.setSel([])); const p = at(px, py); await page.mouse.click(p.x, p.y); return page.evaluate(() => window.__app.active.sel.length); };
      expect(await sel(309, 300)).toBe(1);
      expect(await sel(300, 291)).toBe(1);
      expect(await sel(312, 300)).toBe(0);
      expect(await sel(300, 313)).toBe(0);
    });
    test('线段命中半径 5 px（低档）按物理像素', async ({ page }) => {
      await page.goto('/'); await page.waitForFunction(() => !!window.__app);
      const info = await page.evaluate(d => { const v = window.__app.active; v.store.run('x', () => { const a = v.store.add({ k: 'free', x: 100 / d, y: 300 / d }).id, b = v.store.add({ k: 'free', x: 500 / d, y: 300 / d }).id; v.store.add({ k: 'seg', a, b }); }); const r = v.canvas.getBoundingClientRect(); return { left: r.left, top: r.top }; }, dpr);
      const sel = async (px: number, py: number) => { await page.evaluate(() => window.__app.active.setSel([])); await page.mouse.click(info.left + px / dpr, info.top + py / dpr); return page.evaluate(() => window.__app.active.sel.length); };
      expect(await sel(300, 304)).toBe(1);
      expect(await sel(300, 307)).toBe(0);
    });
  });
}
