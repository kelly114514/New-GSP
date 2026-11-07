/** 差异审计第二批：参数曲线、绘图函数、声音按钮、自定义变换、文本样式。 */
import { expect, test, type Page } from '@playwright/test';

declare global { interface Window { __app: any } }

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } }); await page.goto('/'); await page.waitForFunction(() => !!window.__app); });

const exec = (page: Page, id: number, shift = false) => page.evaluate(([i, s]) => window.__app.exec(i, s), [id, shift] as const);
const select = (page: Page, ids: number[]) => page.evaluate(i => window.__app.active.setSel(i), ids);
const setTool = (page: Page, t: string) => page.evaluate(x => window.__app.setTool(x), t);
const canvasXY = async (page: Page, x: number, y: number) => { const r = await page.locator('.docwin.active canvas').first().boundingBox(); return { x: r!.x + x, y: r!.y + y }; };
const click = async (page: Page, x: number, y: number) => { const q = await canvasXY(page, x, y); await page.mouse.click(q.x, q.y); };
const dragTo = async (page: Page, a: [number, number], b: [number, number]) => { const p = await canvasXY(page, a[0], a[1]), q = await canvasXY(page, b[0], b[1]); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2); await page.mouse.move(q.x, q.y); await page.mouse.up(); };
const objs = (page: Page) => page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => ({ id: o.id, k: o.def.k, def: o.def, hidden: o.hidden, label: o.label, at: o.at })));
const sel = (page: Page) => page.evaluate(() => window.__app.active.sel);
const ok = (page: Page) => page.locator('.dlg button.primary').click();
const newFunc = async (page: Page, text: string) => { const q = page.evaluate(() => window.__app.newFunction(window.__app.active, false)); await page.locator('.dlg input.expr').fill(text); await ok(page); await q; };

test('绘制参数曲线：没有函数时提示；选两个函数、极坐标、定义域；没有坐标系时按模式建立', async ({ page }) => {
  let p = exec(page, 36991);
  await expect(page.locator('.dlg .dlg-text')).toContainText('需要先有函数'); await ok(page); await p;
  await newFunc(page, 'x'); await newFunc(page, 'x^2');
  const fs = (await objs(page)).filter((o: any) => o.k === 'func');
  await select(page, [fs[0].id, fs[1].id]);
  p = exec(page, 36991);
  await expect(page.locator('.dlg-title')).toHaveText('绘制曲线');
  await expect(page.locator('.pc-head')).toHaveText('绘制(x, y)');
  await expect(page.locator('.pbox')).toHaveText(['f(t)', 'g(t)']);
  await expect(page.locator('.dlg input[type=text]').nth(0)).toHaveValue('0.0');
  await expect(page.locator('.dlg input[type=text]').nth(1)).toHaveValue('1.0');
  await page.locator('.dlg input[type=radio][value=polar]').check();
  await expect(page.locator('.pc-head')).toHaveText('绘制(r, α)');
  await page.locator('.dlg input[type=text]').nth(1).fill('3');
  await ok(page); await p;
  const o = await objs(page), c = o.find((x: any) => x.k === 'pcurve'), sys = o.find((x: any) => x.k === 'sys');
  expect(c.def).toMatchObject({ polar: true, lo: 0, hi: 3, samples: 750 });
  expect(sys.def.grid).toBe('polar');
  expect(await sel(page)).toEqual([c.id]);
});

test('参数曲线：在对话框里单击画板上的函数式填入两个框；两个框都填了才能绘制', async ({ page }) => {
  await newFunc(page, 'x'); await newFunc(page, 'x^2');
  const fs = (await objs(page)).filter((o: any) => o.k === 'func');
  await select(page, []);
  const p = exec(page, 36991);
  await expect(page.locator('.dlg button.primary')).toBeDisabled();
  const a = await canvasXY(page, fs[0].at.x + 20, fs[0].at.y + 8);
  await page.mouse.click(a.x, a.y);
  await expect(page.locator('.pbox').first()).toHaveText('f(t)');
  await expect(page.locator('.dlg button.primary')).toBeDisabled();
  const b = await canvasXY(page, fs[1].at.x + 20, fs[1].at.y + 8);
  await page.mouse.click(b.x, b.y);
  await expect(page.locator('.pbox').nth(1)).toHaveText('g(t)');
  await expect(page.locator('.dlg button.primary')).toBeEnabled();
  await page.locator('.dlg-cancel').click(); await p;
});

test('选中函数时“绘制函数”直接画图像；定义绘图函数对笔迹建立 f(x)', async ({ page }) => {
  await newFunc(page, '2*x');
  const f = (await objs(page)).find((o: any) => o.k === 'func');
  await select(page, [f.id]);
  expect((await page.evaluate(() => window.__app.queryMenu(36990))).name).toBe('绘制函数');
  await exec(page, 36990);
  expect((await objs(page)).filter((o: any) => o.k === 'plot').length).toBe(1);
  await setTool(page, 'marker'); await dragTo(page, [100, 300], [300, 250]); await setTool(page, 'move');
  const stroke = (await objs(page)).find((o: any) => o.k === 'stroke'); await select(page, [stroke.id]);
  expect(await page.evaluate(() => window.__app.queryMenu(36977))).toMatchObject({ enabled: true, name: '定义绘图函数' });
  await exec(page, 36977);
  const pf = (await objs(page)).find((o: any) => o.k === 'picfunc');
  expect(pf.def.stroke).toBe(stroke.id);
  expect(await page.evaluate(id => window.__app.active.store.results.get(id)?.status, pf.id)).toBe('ok');
  expect(await sel(page)).toEqual([pf.id]);
});

test('声音按钮：不振荡的函数先问；按钮文字“听到函数 f”；按下不报错', async ({ page }) => {
  await newFunc(page, 'x');
  const f = (await objs(page)).find((o: any) => o.k === 'func'); await select(page, [f.id]);
  expect((await page.evaluate(() => window.__app.queryMenu(36886))).enabled).toBe(true);
  let p = exec(page, 36886);
  await expect(page.locator('.dlg-text')).toContainText('振荡');
  await page.getByRole('button', { name: '否(N)' }).click(); await p;
  expect((await objs(page)).some((o: any) => o.k === 'button')).toBe(false);
  p = exec(page, 36886); await page.getByRole('button', { name: '是(Y)' }).click(); await p;
  const b = (await objs(page)).find((o: any) => o.k === 'button');
  expect(b.def).toMatchObject({ action: { type: 'sound', funcs: [f.id] }, text: '听到函数 f' });
  await page.evaluate(() => { const a = window.__app; a.pressButton(a.active, a.active.store.page.objects.at(-1)); });
});

test('自定义变换：创建、菜单底部、应用、编辑（改名、删除）', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 100, y: 200 }).id, b = st.add({ k: 'free', x: 300, y: 200 }).id, c = st.add({ k: 'free', x: 200, y: 300 }).id, ab = st.add({ k: 'seg', a, b }).id;
      st.add({ k: 'reflect', src: c, mirror: ab });
      st.add({ k: 'free', x: 600, y: 500 });
    });
  });
  const img = (await objs(page)).find((o: any) => o.k === 'reflect');
  await select(page, [3, 6]); expect((await page.evaluate(() => window.__app.queryMenu(36950))).enabled).toBe(false);   // 两个不相干的自由点（原版采集 probe_custom3：灰）
  await select(page, [3, img.id]); expect((await page.evaluate(() => window.__app.queryMenu(36950))).enabled).toBe(true);
  expect((await page.evaluate(() => window.__app.queryMenu(36951))).enabled).toBe(false);
  const p = exec(page, 36950);
  await expect(page.locator('.dlg-title')).toHaveText('创建自定义变换');
  await page.locator('.dlg input[type=text]').fill('镜象'); await ok(page); await p;
  expect(await page.evaluate(() => window.__app.active.store.page.transforms)).toEqual([{ name: '镜象', src: 3, img: img.id }]);
  expect((await page.evaluate(() => window.__app.queryMenu(36951))).enabled).toBe(true);
  await page.keyboard.press('Alt+t');
  await expect(page.locator('.top.open .item .nm').last()).toContainText('镜象');
  await page.keyboard.press('Escape');
  await setTool(page, 'point'); await click(page, 500, 150); await setTool(page, 'move');
  const nid = (await objs(page)).filter((o: any) => o.k === 'free').pop().id;
  await select(page, [nid]);
  expect((await page.evaluate(() => window.__app.queryMenu(3201))).enabled).toBe(true);
  const before = (await objs(page)).length;
  await exec(page, 3201);
  const after = await objs(page);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1).def).toMatchObject({ k: 'reflect', src: nid, mirror: 4 });
  expect(await sel(page)).toEqual([after.at(-1).id]);
  const e = exec(page, 36951);
  await expect(page.locator('.dlg-title')).toHaveText('编辑自定义变换');
  await page.locator('.dlg input[type=text]').fill('改过的名字'); await ok(page); await e;
  expect((await page.evaluate(() => window.__app.active.store.page.transforms))[0].name).toBe('改过的名字');
  const d = exec(page, 36951); await page.getByRole('button', { name: '删除(R)' }).click(); await ok(page); await d;
  expect(await page.evaluate(() => window.__app.active.store.page.transforms)).toBeUndefined();
});

test('文本样式：六个类别，出厂值，只存与出厂不同的项', async ({ page }) => {
  const p = exec(page, 36896);
  await page.locator('.dlg .tabs button', { hasText: '文本' }).click();
  await page.getByRole('button', { name: '改变对象属性...' }).click();
  await expect(page.locator('.dlg-title').last()).toHaveText('文本样式');
  await expect(page.locator('.ts select[size] option')).toHaveText(['标签', '标题', '数值&函数', '操作类按钮', '表格', '坐标轴上的数字']);
  await expect(page.locator('.ts select').nth(1)).toHaveValue('Times New Roman');
  await expect(page.locator('.ts select').nth(2)).toHaveValue('24');
  await page.locator('.ts label', { hasText: '斜体' }).locator('input').check();
  await page.locator('.dlg').last().locator('button.primary').click();
  expect(await page.evaluate(() => window.__app.active.store.doc.settings.display?.textStyles)).toEqual({ label: { italic: true } });
  await page.locator('.dlg-cancel').click(); await p;
});

test('数值迭代：参数 n、n+1；面板里“生成迭代数据表”默认带勾；迭代后出现数据表（行 0..3）', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('场景', () => {
      const n = st.add({ k: 'param', name: 'n', value: 3, unit: 'none', showEdit: true }, { at: { x: 24, y: 24 }, label: 'n' });
      st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: n.id }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 24, y: 48 } });
    });
  });
  await select(page, [1]);
  void exec(page, 36949);
  await expect(page.locator('.iterpanel')).toBeVisible();
  await page.mouse.click(...(Object.values(await canvasXY(page, 40, 56)) as [number, number]));    // n → n+1
  await expect(page.locator('.iterpanel button.primary')).toBeEnabled();
  await page.locator('.iterpanel button.iter-pop', { hasText: '结构' }).click();
  await expect(page.locator('.ipop .iitem', { hasText: '生成迭代数据表' }).locator('.ick')).toHaveText('✓');
  await page.keyboard.press('Escape');
  await page.locator('.iterpanel button.primary').click();
  const t = (await objs(page)).find((o: any) => o.k === 'itertable');
  expect(t.at).toEqual({ x: 10, y: 64 });
  expect(await page.evaluate(id => window.__app.active.store.results.get(id).shape.rows, t.id)).toEqual([[0, 4], [1, 5], [2, 6], [3, 7]]);
});
