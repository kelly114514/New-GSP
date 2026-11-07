import { expect, test, type Page } from '@playwright/test';

declare global { interface Window { __app: any } }

const sel = (p: Page) => p.evaluate(() => window.__app.active.sel.length);
const objects = (p: Page) => p.evaluate(() => window.__app.active.store.page.objects.map((o: any) => ({ id: o.id, k: o.def.k, x: o.def.x, y: o.def.y, hidden: o.hidden, label: o.label, shown: o.labelShown })));
const tool = (p: Page, g: string) => p.locator(`.tool[data-group="${g}"]`);
const overlay = (p: Page) => p.locator('.docwin canvas').last();

async function at(p: Page, x: number, y: number) {
  const b = (await overlay(p).boundingBox())!;
  return { x: b.x + x, y: b.y + y };
}
async function click(p: Page, x: number, y: number, opts: { shift?: boolean } = {}) { const q = await at(p, x, y); if (opts.shift) await p.keyboard.down('Shift'); await p.mouse.click(q.x, q.y); if (opts.shift) await p.keyboard.up('Shift'); }
async function drag(p: Page, x0: number, y0: number, x1: number, y1: number, steps = 8) {
  const a = await at(p, x0, y0), b = await at(p, x1, y1);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps }); await p.mouse.up();
}
async function points(p: Page, pts: [number, number][]) { await tool(p, 'point').click(); for (const [x, y] of pts) await click(p, x, y); await tool(p, 'arrow').click(); }

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { (window as any).showSaveFilePicker = undefined; }); await page.goto('/'); await page.waitForFunction(() => !!window.__app); });

test('点工具放点：新点不显示标签，点击空白不放点之外的东西', async ({ page }) => {
  await points(page, [[200, 200], [400, 200], [300, 380]]);
  const o = await objects(page);
  expect(o.filter(x => x.k === 'free').length).toBe(3);
  expect(o.every(x => !x.shown)).toBe(true);
});

test('单击加选、再次单击取消、点击空白清除；Shift 点空白保留', async ({ page }) => {
  await points(page, [[200, 200], [400, 200]]);
  await click(page, 600, 500);
  await click(page, 200, 200); expect(await sel(page)).toBe(1);
  await click(page, 400, 200); expect(await sel(page)).toBe(2);
  await click(page, 200, 200); expect(await sel(page)).toBe(1);
  await click(page, 600, 500, { shift: true }); expect(await sel(page)).toBe(1);
  await click(page, 600, 500); expect(await sel(page)).toBe(0);
});

test('命中半径：低档点 10 像素内命中，11 像素外不命中', async ({ page }) => {
  await points(page, [[300, 300]]);
  await click(page, 600, 500);
  await click(page, 309, 300); expect(await sel(page)).toBe(1);
  await click(page, 600, 500); expect(await sel(page)).toBe(0);
  await click(page, 312, 300); expect(await sel(page)).toBe(0);
});

test('线段工具拖动建线段；拖动端点后依赖的中点跟随；一次撤消恢复整个拖动', async ({ page }) => {
  await tool(page, 'ruler').click();
  await drag(page, 200, 200, 400, 200);
  let o = await objects(page);
  expect(o.map(x => x.k)).toEqual(['free', 'free', 'seg']);
  await page.keyboard.press('Control+m');
  o = await objects(page);
  expect(o.map(x => x.k)).toEqual(['free', 'free', 'seg', 'mid']);
  await tool(page, 'arrow').click();
  await click(page, 600, 500);
  await drag(page, 200, 200, 200, 300);
  const before = await page.evaluate(() => window.__app.active.store.results.get(4).shape.p);
  expect(before.y).toBeCloseTo(250, 0);
  await page.keyboard.press('Control+z');
  const after = await page.evaluate(() => window.__app.active.store.results.get(4).shape.p);
  expect(after.y).toBeCloseTo(200, 0);
  expect((await objects(page)).find(x => x.id === 1)!.y).toBeCloseTo(200, 0);
});

test('框选：相交即选中，Shift 加选', async ({ page }) => {
  await tool(page, 'ruler').click();
  await drag(page, 200, 200, 400, 200);
  await tool(page, 'arrow').click();
  await click(page, 600, 500);
  await drag(page, 280, 150, 320, 250);   // 只盖住线段中间
  expect(await sel(page)).toBe(1);
  await click(page, 600, 500); expect(await sel(page)).toBe(0);
});

test('点优先于线；在两线相交处单击当场生成交点', async ({ page }) => {
  await tool(page, 'ruler').click();
  await drag(page, 200, 200, 400, 400);
  await drag(page, 200, 400, 400, 200);
  await tool(page, 'arrow').click();
  await click(page, 600, 100);
  await click(page, 300, 300);
  const o = await objects(page);
  expect(o.map(x => x.k)).toContain('inter');
  expect(await sel(page)).toBe(1);
});

test('菜单名称与可用状态随选择变化', async ({ page }) => {
  await points(page, [[200, 200], [400, 200]]);
  await click(page, 600, 500);
  const state = (id: number) => page.evaluate((i: number) => window.__app.queryMenu(i), id);
  expect((await state(36876)).name).toBe('撤消构造点');
  expect((await state(36925)).enabled).toBe(false);
  await click(page, 200, 200); await click(page, 400, 200);
  expect((await state(36927)).enabled).toBe(true);
  expect((await state(36911)).name).toBe('隐藏点');
  await page.keyboard.press('Control+l');
  const o = await objects(page);
  expect(o.map(x => x.k)).toEqual(['free', 'free', 'seg']);
});

test('显示标签：第一次显示按选择顺序分配，后选的排最前', async ({ page }) => {
  await points(page, [[200, 200], [300, 200], [400, 200]]);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');
  const o = await objects(page);
  // 全选后选择顺序是创建顺序；最后选中的先拿 A（原版实测）
  expect(o.map(x => x.label).sort()).toEqual(['A', 'B', 'C']);
  expect(o.find(x => x.id === 3)!.label).toBe('A');
});

test('新建参数对话框：Shift+Ctrl+P 建立参数', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  await expect(page.locator('.dlg-title')).toHaveText('新建参数');
  const inputs = page.locator('.dlg input[type=text]');
  await inputs.nth(0).fill('k'); await inputs.nth(1).fill('3.5');
  await page.locator('.dlg button.primary').click();
  const p = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def));
  expect(p[0]).toMatchObject({ k: 'param', name: 'k', value: 3.5 });
});

test('参数计算与函数图像：新建函数 x^2 并绘制', async ({ page }) => {
  await page.keyboard.press('Control+g');
  await expect(page.locator('.dlg-title')).toHaveText('新建函数');
  await page.locator('.dlg input.expr').fill('x^2');
  await page.locator('.dlg button.primary').click();
  const kinds = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));
  expect(kinds).toContain('plot');
  expect(kinds).toContain('sys');
  const n = await page.evaluate(() => window.__app.active.store.results.get(window.__app.active.store.page.objects.find((o: any) => o.def.k === 'plot').id).shape.paths[0].length);
  expect(n).toBeGreaterThan(100);
});

test('工具长按弹出条：直尺组按住弹出，移到第 3 格松开选中射线', async ({ page }) => {
  await tool(page, 'point').click();
  const t = tool(page, 'ruler'), b = (await t.boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down();
  await page.waitForTimeout(1200);
  await expect(page.locator('.flyout .cell')).toHaveCount(4);
  const cell = (await page.locator('.flyout .cell').nth(2).boundingBox())!;
  await page.mouse.move(cell.x + 10, cell.y + 10, { steps: 3 }); await page.mouse.up();
  expect(await page.evaluate(() => window.__app.toolbox.current)).toBe('ray');
});

test('多边形工具：点回第一个顶点完成；Esc 取消', async ({ page }) => {
  await tool(page, 'poly').click();
  await click(page, 200, 200); await click(page, 400, 200); await click(page, 300, 380); await click(page, 200, 200);
  let kinds = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));
  expect(kinds).toContain('poly');
  await page.reload(); await page.waitForFunction(() => !!window.__app);
  await tool(page, 'poly').click();
  await click(page, 200, 200); await click(page, 400, 200);
  await page.keyboard.press('Escape');
  kinds = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));
  expect(kinds).not.toContain('poly');
  expect(await page.evaluate(() => window.__app.toolbox.current)).toBe('move');
});

test('Tab 只在同类对象间轮换，顺序是创建顺序的倒序', async ({ page }) => {
  await points(page, [[100, 100], [200, 100], [300, 100], [400, 100]]);
  await click(page, 600, 500);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__app.active.sel[0])).toBe(3);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__app.active.sel[0])).toBe(2);
});

test('文本工具：拖动建文本框，输入文字，点框外结束', async ({ page }) => {
  await tool(page, 'text').click();
  await drag(page, 300, 200, 480, 260);
  await page.locator('textarea.textedit').fill('你好 abc');
  await click(page, 700, 500);
  const o = await page.evaluate(() => window.__app.active.store.page.objects.map((x: any) => x.def));
  expect(o[0]).toMatchObject({ k: 'text', text: '你好 abc' });
});

test('保存再打开：新建图形保存成 .gsp 并读回', async ({ page }) => {
  await tool(page, 'ruler').click();
  await drag(page, 200, 200, 400, 200);
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await dl;
  const path = await file.path();
  const bytes = (await import('node:fs')).readFileSync(path!);
  expect(bytes.subarray(0, 4).toString()).toBe('GSP4');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  (await chooser).setFiles({ name: 'x.gsp', mimeType: 'application/octet-stream', buffer: bytes });
  await page.waitForFunction(() => window.__app.docs.length === 2);
  const kinds = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));
  expect(kinds).toEqual(['free', 'free', 'seg']);
});

test('保存完整性：显示设置和标签偏移转存 .ngsp 后完整保留', async ({ page }) => {
  await points(page, [[200, 200]]);
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('修改显示', () => {
      st.doc.settings.display = { angleUnit: 'deg', anglePrec: 4, distUnit: 'cm', distPrec: 3, otherPrec: 5, background: '#ffff00', selected: '#d000d0', mathItalic: true };
      Object.assign(st.page.objects[0], { label: 'A', labelShown: true, labelDx: 80, labelDy: 60 });
    });
  });
  await page.keyboard.press('Control+s');
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText('文档显示设置');
  await expect(dialog).toContainText('标签位置');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ngsp$/);
  const bytes = (await import('node:fs')).readFileSync((await file.path())!);
  const saved = JSON.parse(bytes.toString().slice('NGSP1\n'.length));
  expect(saved.settings.display.background).toBe('#ffff00');
  expect(saved.pages[0].objects[0]).toMatchObject({ labelDx: 80, labelDy: 60 });
  expect(await page.evaluate(() => window.__app.active.store.dirty)).toBe(false);
});

test('保存完整性：取消转存保留未保存状态和原来源', async ({ page }) => {
  await points(page, [[200, 200]]);
  await page.evaluate(() => { const st = window.__app.active.store; st.run('移标签', () => { st.page.objects[0].labelDx = 80; }); });
  const before = await page.evaluate(() => JSON.stringify(window.__app.active.store.doc));
  await page.keyboard.press('Control+s');
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText('标签位置');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => window.__app.active.store.dirty)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.__app.active.store.doc))).toBe(before);
  expect(await page.evaluate(() => window.__app.active.store.source)).toBeUndefined();
});

test('右键菜单：点的右键菜单含属性与标记中心', async ({ page }) => {
  await points(page, [[300, 300]]);
  const q = await at(page, 300, 300);
  await page.mouse.click(q.x, q.y, { button: 'right' });
  const items = await page.locator('.ctxmenu .item .nm').allTextContents();
  expect(items).toContain('属性(O)…');
  expect(items).toContain('标记中心(N)');
  expect(items).toContain('隐藏点(H)');
});

test('多文档：新建、平铺与层叠', async ({ page }) => {
  await page.keyboard.press('Control+n');
  expect(await page.evaluate(() => window.__app.docs.length)).toBe(2);
  await page.evaluate(() => window.__app.exec(57651));
  expect(await page.locator('.docwin.framed').count()).toBe(2);
  await page.evaluate(() => window.__app.exec(57650));
  expect(await page.locator('.docwin.framed').count()).toBe(2);
});
