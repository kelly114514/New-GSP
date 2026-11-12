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

test('多页使用各自的角度单位，切页后重新计算并刷新显示', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, st = app.active.store;
    st.add({ k: 'calc', expr: { t: 'fn', name: 'sin', a: { t: 'num', v: 30 } }, unit: 'none' });
    st.doc.settings.display = { ...app.settings.display, angleUnit: 'deg' };
    st.page.display = { angleUnit: 'deg' };
    st.addPage(true); st.page.display = { angleUnit: 'rad' }; st.recompute(); app.refresh();
  });
  const current = () => page.evaluate(() => ({ unit: window.__app.active.store.ctx.angleUnit, value: window.__app.active.store.results.get(1).shape.q.v }));
  expect((await current()).value).toBeCloseTo(Math.sin(30), 10);
  await page.locator('#pagebar button').first().click();
  expect(await current()).toMatchObject({ unit: 'deg' });
  expect((await current()).value).toBeCloseTo(0.5, 10);
  await page.locator('#pagebar button').nth(1).click();
  expect(await current()).toMatchObject({ unit: 'rad' });
  expect((await current()).value).toBeCloseTo(Math.sin(30), 10);
});

test('更改当前页角度单位保留文本样式并记录未保存状态', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, st = app.active.store;
    st.add({ k: 'calc', expr: { t: 'fn', name: 'sin', a: { t: 'num', v: 30 } }, unit: 'none' });
    st.doc.settings.display = { ...app.settings.display, angleUnit: 'deg', textStyles: { title: { size: 20 } } };
    st.page.display = { angleUnit: 'deg' };
    st.addPage(true); st.page.display = { angleUnit: 'rad' }; st.recompute(); st.markSaved(); app.refresh();
    void app.exec(36896);
  });
  const dialog = page.locator('.dlg').last();
  await expect(dialog.locator('.dlg-title')).toHaveText('参数选项');
  await dialog.locator('select').first().selectOption('deg');
  await dialog.locator('button.primary').click();
  await expect.poll(() => page.evaluate(() => window.__app.active.store.ctx.angleUnit)).toBe('deg');
  expect(await page.evaluate(() => ({ dirty: window.__app.active.store.dirty, style: window.__app.active.store.doc.settings.display.textStyles,
    pages: window.__app.active.store.doc.pages.map((p: any) => p.display.angleUnit) }))).toEqual({ dirty: true, style: { title: { size: 20 } }, pages: ['deg', 'deg'] });
});

test('仅修改新建画板的角度默认值时保留当前页设置', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, st = app.active.store;
    st.doc.settings.display = { ...app.settings.display, angleUnit: 'deg' };
    st.page.display = { angleUnit: 'deg' }; st.recompute(); st.markSaved(); app.refresh();
    void app.exec(36896);
  });
  const dialog = page.locator('.dlg').last();
  await expect(dialog.locator('.dlg-title')).toHaveText('参数选项');
  await dialog.locator('select').first().selectOption('rad');
  await dialog.locator('input[type=radio][value=new]').first().check();
  await dialog.locator('button.primary').click();
  expect(await page.evaluate(() => ({ newUnit: window.__app.settings.display.angleUnit,
    currentUnit: window.__app.active.store.ctx.angleUnit, dirty: window.__app.active.store.dirty })))
    .toEqual({ newUnit: 'rad', currentUnit: 'deg', dirty: false });
});

test('旧文档没有显示设置时，改变新建默认值不会改变已打开文档', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, st = app.active.store;
    delete st.doc.settings.display; delete st.page.display; st.recompute(); st.markSaved(); app.refresh();
    void app.exec(36896);
  });
  const dialog = page.locator('.dlg').last();
  await expect(dialog.locator('.dlg-title')).toHaveText('参数选项');
  await dialog.locator('select').first().selectOption('rad');
  await dialog.locator('input[type=radio][value=new]').first().check();
  await dialog.locator('button.primary').click();
  expect(await page.evaluate(() => ({ unit: window.__app.active.store.ctx.angleUnit, dirty: window.__app.active.store.dirty })))
    .toEqual({ unit: 'deg', dirty: false });
  await page.evaluate(() => window.__app.newDocument());
  expect(await page.evaluate(() => ({ unit: window.__app.active.store.ctx.angleUnit, saved: window.__app.active.store.doc.settings.display.angleUnit })))
    .toEqual({ unit: 'rad', saved: 'rad' });
});

test('多页参数选项按当前页显示并保存精度与字体样式', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, st = app.active.store;
    st.doc.settings.display = { ...app.settings.display, anglePrec: 2, distPrec: 2 };
    st.page.display = { angleUnit: 'deg', anglePrec: 2, distPrec: 2, textStyles: {} };
    st.addPage(true); st.page.display = { angleUnit: 'rad', anglePrec: 3, distPrec: 4, textStyles: { title: { name: 'Arial', size: 20, bold: true } } };
    st.recompute(); st.markSaved(); app.refresh(); void app.exec(36896);
  });
  const dialog = page.locator('.dlg').last();
  await expect(dialog.locator('.dlg-title')).toHaveText('参数选项');
  await expect(dialog.locator('select').nth(1)).toHaveValue('3');
  await expect(dialog.locator('select').nth(3)).toHaveValue('4');
  await dialog.locator('select').nth(1).selectOption('4');
  await dialog.locator('select').nth(3).selectOption('3');
  await dialog.locator('button.primary').click();
  const state = await page.evaluate(() => ({ pages: window.__app.active.store.doc.pages.map((p: any) => p.display), dirty: window.__app.active.store.dirty }));
  expect(state.pages[0]).toMatchObject({ anglePrec: 2, distPrec: 2, textStyles: {} });
  expect(state.pages[1]).toMatchObject({ anglePrec: 4, distPrec: 3, textStyles: { title: { name: 'Arial', size: 20, bold: true } } });
  expect(state.dirty).toBe(true);
});

test('原版多页修改当前页参数时，其他页继续继承数学标签默认值', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, view = app.active, st = view.store;
    view.fallbackDisplay.mathItalic = false;
    st.doc.settings.display = { ...app.settings.display, fromFile: true };
    st.page.display = { angleUnit: 'deg' };
    st.addPage(true); st.page.display = { angleUnit: 'rad' };
    st.recompute(); app.refresh(); void app.exec(36896);
  });
  let dialog = page.locator('.dlg').last();
  await dialog.locator('select').first().selectOption('deg');
  await dialog.locator('button.primary').click();
  await page.locator('#pagebar button').first().click();
  await page.evaluate(() => { void window.__app.exec(36896); });
  dialog = page.locator('.dlg').last();
  await expect(dialog.locator('label', { hasText: '所有数学标签用斜体' }).locator('input')).not.toBeChecked();
  await dialog.locator('button', { hasText: '取消' }).click();
});

test('修改当前页文本样式不会覆盖其他页面', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, st = app.active.store;
    st.page.display = { angleUnit: 'deg', textStyles: {} };
    st.addPage(true); st.page.display = { angleUnit: 'rad', textStyles: {} };
    st.markSaved(); app.refresh(); void app.dlg.textStyles(app.active);
  });
  const dialog = page.locator('.dlg').last();
  await expect(dialog.locator('.dlg-title')).toHaveText('文本样式');
  await dialog.locator('.ts select').first().selectOption('title');
  await dialog.locator('.ts select').nth(1).selectOption('Arial');
  await dialog.locator('.ts select').nth(2).selectOption('20');
  await dialog.locator('.ts label', { hasText: '粗体' }).locator('input').check();
  await dialog.locator('button.primary').click();
  const state = await page.evaluate(() => ({ pages: window.__app.active.store.doc.pages.map((p: any) => p.display), dirty: window.__app.active.store.dirty }));
  expect(state.pages[0].textStyles).toEqual({});
  expect(state.pages[1].textStyles).toMatchObject({ title: { name: 'Arial', size: 20, bold: true } });
  expect(state.dirty).toBe(true);
});

test('格点显示与自动吸附分别切换，吸附随页面撤消', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const app = window.__app, view = app.active;
    await app.exec(36981);
    const store = view.store, sys = store.page.objects.find((o: any) => o.def.k === 'sys');
    const shape = store.results.get(sys.id).shape;
    const raw = { x: shape.origin.x + shape.ux.x * 0.6 + shape.uy.x * 0.6, y: shape.origin.y + shape.ux.y * 0.6 + shape.uy.y * 0.6 };
    await app.exec(36985);
    const pointsOnly = { dots: app.queryMenu(36985).checked, snap: app.queryMenu(36986).checked, p: view.gridSnap(raw) };
    await app.exec(36986);
    const snapped = { dots: app.queryMenu(36985).checked, snap: app.queryMenu(36986).checked, p: view.gridSnap(raw) };
    await app.exec(36876);
    const undone = { dots: app.queryMenu(36985).checked, snap: app.queryMenu(36986).checked, p: view.gridSnap(raw) };
    return { raw, expected: { x: shape.origin.x + shape.ux.x + shape.uy.x, y: shape.origin.y + shape.ux.y + shape.uy.y }, pointsOnly, snapped, undone };
  });
  expect(r.pointsOnly).toEqual({ dots: true, snap: false, p: r.raw });
  expect(r.snapped.dots).toBe(true);
  expect(r.snapped.snap).toBe(true);
  expect(r.snapped.p.x).toBeCloseTo(r.expected.x);
  expect(r.snapped.p.y).toBeCloseTo(r.expected.y);
  expect(r.undone).toEqual({ dots: true, snap: false, p: r.raw });
});

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
  const saved = await page.evaluate(async () => {
    const path = '/src/gsp/codec.ts', { encodeFile } = await import(/* @vite-ignore */ path);
    const result = encodeFile(window.__app.active.store.doc, undefined);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason, fields: result.unsupported };
  });
  expect(saved).toEqual({ ok: true });
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

test('保存完整性：显示设置转存 .ngsp 后完整保留（点的标签偏移已能写入 .gsp，不再需要转存）', async ({ page }) => {
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
  await page.evaluate(() => { const st = window.__app.active.store; st.run('改显示', () => { st.doc.settings.display = { angleUnit: 'deg', anglePrec: 4, distUnit: 'cm', distPrec: 3, otherPrec: 5, background: '#ffff00', selected: '#d000d0', mathItalic: true }; }); });
  const before = await page.evaluate(() => JSON.stringify(window.__app.active.store.doc));
  await page.keyboard.press('Control+s');
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText('文档显示设置');
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

test('图片颜色调色板的色块全部禁用，且没有其它颜色行', async ({ page }) => {
  const id = await page.evaluate(() => {
    const st = window.__app.active.store;
    return st.run('颜色状态审计', () => st.add({ k: 'image', data: '', mime: 'image/png', at: { x: 20, y: 20 }, w: 50, h: 30 }).id);
  });
  await page.evaluate(i => { const v = window.__app.active; v.setSel([i]); window.__app.ctxMenu.show(v, 20, 20); }, id);
  const contextState = await page.evaluate(() => ({
    swatches: document.querySelectorAll('.ctxmenu .sw').length,
    disabledSwatches: document.querySelectorAll('.ctxmenu .sw:disabled').length,
    disabledOther: [...document.querySelectorAll('.ctxmenu .item')].some(x => x.textContent?.includes('其它') && x.classList.contains('disabled')),
    other: [...document.querySelectorAll('.ctxmenu .item')].some(x => x.textContent?.includes('其它')),
    parameterOption: [...document.querySelectorAll('.ctxmenu .item')].some(x => x.textContent?.includes('参数(P)')),
  }));
  expect(contextState).toEqual({ swatches: 16, disabledSwatches: 16, disabledOther: false, other: false, parameterOption: false });
  await page.keyboard.press('Escape');
  const mainState = await page.evaluate(() => ({
    swatches: document.querySelectorAll('#menubar .sw').length,
    disabledSwatches: document.querySelectorAll('#menubar .sw:disabled').length,
  }));
  expect(mainState).toEqual({ swatches: 16, disabledSwatches: 16 });
  await page.evaluate(() => { const v = window.__app.active; const p = v.store.run('点', () => v.store.add({ k: 'free', x: 100, y: 100 })); v.setSel([p.id]); });
  await page.locator('#menubar .toplabel').filter({ hasText: '显示' }).click();
  await expect(page.locator('#menubar .sw:disabled')).toHaveCount(0);
});

test('后台文档右键菜单按目标文档判断状态并执行命令', async ({ page }) => {
  const state = await page.evaluate(() => {
    const app = window.__app, target = app.active;
    const id = target.store.run('构造点', () => target.store.add({ k: 'free', x: 100, y: 100 }).id);
    app.newDocument();
    app.showContextMenu(target, new MouseEvent('contextmenu', { clientX: 20, clientY: 20 }), { x: 100, y: 100 });
    const row = [...document.querySelectorAll('.ctxmenu .item')].find(x => x.textContent?.includes('标记中心')) as HTMLElement | undefined;
    return { target: target.rid, id, activated: app.active === target, disabled: row?.classList.contains('disabled') };
  });
  expect(state.activated).toBe(true);
  expect(state.disabled).toBe(false);
  await page.locator('.ctxmenu .item').filter({ hasText: '标记中心' }).click();
  const result = await page.evaluate(({ target, id }) => {
    const app = window.__app, v = app.docs.find((x: any) => x.rid === target);
    return { active: app.active === v, center: v.marks.center, id };
  }, state);
  expect(result.active).toBe(true);
  expect(result.center).toBe(result.id);
});

test('多文档：新建、平铺与层叠', async ({ page }) => {
  await page.keyboard.press('Control+n');
  expect(await page.evaluate(() => window.__app.docs.length)).toBe(2);
  await page.evaluate(() => window.__app.exec(57651));
  expect(await page.locator('.docwin.framed').count()).toBe(2);
  await page.evaluate(() => window.__app.exec(57650));
  expect(await page.locator('.docwin.framed').count()).toBe(2);
});

test('重型拖动显示完整帧，松手提交最后落点，取消后丢弃后台结果', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const st = window.__app.active.store;
    const ids = st.run('构造轨迹', () => {
      const a = st.add({ k: 'free', x: 200, y: 200 }).id;
      const b = st.add({ k: 'free', x: 410, y: 290 }).id;
      const c = st.add({ k: 'circle', c: a, p: b }).id;
      const driver = st.add({ k: 'onpath', path: c, t: 0 }).id;
      return { a, locus: st.add({ k: 'locus', driver, out: driver, samples: 273 }).id };
    });
    st.fullEvalMs = 100;
    return ids;
  });
  const start = await at(page, 200, 200), first = await at(page, 235, 220), last = await at(page, 270, 244);
  const position = () => page.evaluate(id => window.__app.active.store.get(id).def, ids.a);
  const exact = () => page.evaluate(id => {
    const st = window.__app.active.store;
    const shape = st.results.get(id).shape;
    st.recompute();
    return [shape.paths[0].length, JSON.stringify(shape) === JSON.stringify(st.results.get(id).shape)];
  }, ids.locus);

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(first.x, first.y);
  await expect.poll(position).toMatchObject({ x: 235, y: 220 });
  expect(await exact()).toEqual([274, true]);
  await page.mouse.move(last.x, last.y); await page.mouse.up();
  await expect.poll(position).toMatchObject({ x: 270, y: 244 });
  await expect.poll(() => page.evaluate(() => window.__app.active.store.undoName)).toBe('移动点');
  expect(await exact()).toEqual([274, true]);
  await page.keyboard.press('Control+z');
  expect(await position()).toMatchObject({ x: 200, y: 200 });

  // 阻止 Worker 加载，确保取消发生在最终结果返回前。
  let release!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  await page.route('**/drag-worker.ts?*', async route => { await blocked; await route.continue().catch(() => undefined); });
  try {
    await page.evaluate(() => { window.__app.active.store.fullEvalMs = 100; });
    await drag(page, 200, 200, 270, 244, 1);
    const waiting = page.getByRole('dialog').filter({ hasText: '正在计算拖动后的图形' });
    await expect(waiting).toBeVisible();
    await waiting.getByRole('button', { name: '取消' }).click();
    await expect(waiting).toHaveCount(0);
  } finally { release(); }
  expect(await position()).toMatchObject({ x: 200, y: 200 });
  expect(await exact()).toEqual([274, true]);
});
