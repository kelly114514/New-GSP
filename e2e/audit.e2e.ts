/** 对应 docs/原版差异审计.md 的回归测试：每个用例对应一条已修复的差异。 */
import { expect, test, type Page } from '@playwright/test';

declare global { interface Window { __app: any } }

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.evaluate(() => { try { localStorage.clear(); } catch { /* */ } }); await page.goto('/'); await page.waitForFunction(() => !!window.__app); });

const exec = (page: Page, id: number, shift = false) => page.evaluate(([i, s]) => window.__app.exec(i, s), [id, shift] as const);
const select = (page: Page, ids: number[]) => page.evaluate(i => window.__app.active.setSel(i), ids);
const setTool = (page: Page, t: string) => page.evaluate(x => window.__app.setTool(x), t);
const canvasXY = async (page: Page, x: number, y: number) => { const r = await page.locator('.docwin.active canvas').first().boundingBox(); return { x: r!.x + x, y: r!.y + y }; };
const click = async (page: Page, x: number, y: number) => { const q = await canvasXY(page, x, y); await page.mouse.click(q.x, q.y); };
const dragTo = async (page: Page, a: [number, number], b: [number, number]) => { const p = await canvasXY(page, a[0], a[1]), q = await canvasXY(page, b[0], b[1]); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2); await page.mouse.move(q.x, q.y); await page.mouse.up(); };
const objs = (page: Page) => page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => ({ id: o.id, k: o.def.k, def: o.def, hidden: o.hidden, label: o.label, shown: o.labelShown, at: o.at })));
const sel = (page: Page) => page.evaluate(() => window.__app.active.sel);
const ok = (page: Page) => page.locator('.dlg button.primary').click();
const threePts = async (page: Page) => { await setTool(page, 'point'); await click(page, 100, 100); await click(page, 300, 100); await click(page, 300, 300); await setTool(page, 'move'); await select(page, []); };

test('线段工具：依次单击两个空白位置连成线段，选中线段', async ({ page }) => {
  await setTool(page, 'segment');
  await click(page, 100, 100); await click(page, 300, 200);
  const o = await objs(page);
  expect(o.map((x: any) => x.k)).toEqual(['free', 'free', 'seg']);
  expect(await sel(page)).toEqual([3]);
});

test('圆工具：依次单击两个空白位置作圆；拖动作图仍然可用；Esc 取消待定的起点', async ({ page }) => {
  await setTool(page, 'circle');
  await click(page, 100, 100); await click(page, 300, 100);
  expect((await objs(page)).map((x: any) => x.k)).toEqual(['free', 'free', 'circle']);
  await dragTo(page, [100, 300], [200, 300]);
  expect((await objs(page)).filter((x: any) => x.k === 'circle').length).toBe(2);
  await click(page, 400, 400); await page.keyboard.press('Escape');
  await setTool(page, 'circle'); await click(page, 500, 100);
  expect((await objs(page)).filter((x: any) => x.k === 'circle').length).toBe(2);
});

test('菜单键盘：Alt+N 第一项高亮，方向键移动，回车执行；访问字母直接执行；菜单项显示访问字母', async ({ page }) => {
  await page.keyboard.press('Alt+n');
  await expect(page.locator('.top.open .item.hot .nm')).toHaveText('新建参数(W)…');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.top.open .item.hot .nm')).toHaveText('计算(U)…');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dlg-title')).toHaveText('新建计算');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+n'); await page.keyboard.press('w');
  await expect(page.locator('.dlg-title')).toHaveText('新建参数');
  await page.keyboard.press('Escape');
  // 左右键换到相邻菜单，Esc 关闭
  await page.keyboard.press('Alt+n'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.top.open .toplabel')).toHaveText('绘图(G)');
  await page.keyboard.press('Escape');
  await expect(page.locator('.top.open')).toHaveCount(0);
});

test('右键菜单：访问字母和方向键；标签命令带省略号', async ({ page }) => {
  await setTool(page, 'circle'); await dragTo(page, [200, 200], [300, 200]); await setTool(page, 'move'); await select(page, []);
  const q = await canvasXY(page, 300, 200); await page.mouse.click(q.x - 100 - 70.7, q.y - 70.7, { button: 'right' }).catch(() => undefined);
  await page.keyboard.press('Escape');
  const c = await canvasXY(page, 200 + 70.7, 200 + 70.7); await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(page.locator('.ctxmenu .item .nm', { hasText: '圆的标签' })).toHaveText('圆的标签(L)…');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ctxmenu > .item.hot')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctxmenu')).toBeHidden();
});

test('新建参数：名称和数值标题在上方，默认 1.00；按钮顺序帮助、取消、确定；背景不变灰', async ({ page }) => {
  const p = exec(page, 36970);
  await expect(page.locator('.param-row .cap')).toHaveText(['名称', '数值']);
  await expect(page.locator('.dlg input[type=text]').nth(1)).toHaveValue('1.00');
  await expect(page.locator('.dlg-btns button')).toHaveText(['帮助(H)', '取消', '确定']);
  expect(await page.locator('.dlg-back').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.locator('.dlg-help').click();
  await expect(page.locator('.dlg-title').last()).toContainText('帮助');
  await page.keyboard.press('Escape');                  // 只关帮助
  await expect(page.locator('.dlg-title')).toHaveText('新建参数');
  await ok(page); await p;
});

test('参数选项：单位、颜色、文本、工具四页，默认单位页；精度确实生效', async ({ page }) => {
  await threePts(page); await select(page, [1, 2]); await exec(page, 36954);
  const p = exec(page, 36896);
  await expect(page.locator('.dlg .tabs button')).toHaveText(['单位', '颜色', '文本', '工具']);
  await expect(page.locator('.dlg .pref-grid')).toBeVisible();
  await page.locator('.dlg .pref-grid select').nth(3).selectOption('3');   // 距离精度：千分之一
  await page.locator('.dlg .tabs button', { hasText: '工具' }).click();
  await expect(page.locator('.dlg select.power')).toBeVisible();
  await ok(page); await p;
  const q = exec(page, 36971);
  await expect(page.locator('.calc-menus select').first().locator('option').nth(1)).toHaveText(/^AB = \d+\.\d{3}厘米$/);
  await page.locator('.dlg-cancel').click(); await q;
});

test('计算：空白时确定禁用；输入时有预览，不完整时标出；数字键盘有退格；单击画板上的度量值插入表达式', async ({ page }) => {
  await threePts(page); await select(page, [1, 2]); await exec(page, 36954);
  const at = (await objs(page)).find((x: any) => x.k === 'measure').at;
  const p = exec(page, 36971);
  await expect(page.locator('.dlg button.primary')).toBeDisabled();
  await page.locator('.calc-grid button', { hasText: /^1$/ }).click();
  await expect(page.locator('.expr-preview')).toHaveText('1 = 1.00');
  await expect(page.locator('.dlg button.primary')).toBeEnabled();
  await page.locator('.calc-grid button', { hasText: /^\+$/ }).click();
  await expect(page.locator('.expr-preview')).toContainText('不完整');
  await expect(page.locator('.dlg button.primary')).toBeDisabled();
  await page.locator('.calc-grid button', { hasText: '⌫' }).click();
  await page.locator('.calc-grid button', { hasText: '⌫' }).click();
  await expect(page.locator('.dlg input.expr')).toHaveValue('');
  await click(page, at.x + 10, at.y + 8);
  await expect(page.locator('.dlg input.expr')).toHaveValue('AB');
  await expect(page.locator('.expr-preview')).toContainText('AB = ');
  await ok(page); await p;
  expect((await objs(page)).some((x: any) => x.k === 'calc')).toBe(true);
});

test('函数：方程菜单切换形式后自变量按键跟着变；x=f(y) 和 r=f(θ) 都能画出来', async ({ page }) => {
  let p = page.evaluate(() => window.__app.newFunction(window.__app.active, true));
  await page.locator('.dlg input.expr').fill('x^2');
  await page.locator('.calc-menus select').last().selectOption('x=f(y)');
  await expect(page.locator('.dlg input.expr')).toHaveValue('y^2');
  await expect(page.locator('.calc-grid button', { hasText: /^y$/ })).toHaveCount(1);
  await expect(page.locator('.expr-preview')).toHaveText('f(y) = y^2');
  await ok(page); await p;
  const paths = () => page.evaluate(() => { const v = window.__app.active, o = v.store.page.objects.filter((x: any) => x.def.k === 'plot').pop(); const s = v.store.results.get(o.id)?.shape; return s?.k === 'paths' ? s.paths.flat().length : 0; });
  expect(await paths()).toBeGreaterThan(10);
  p = page.evaluate(() => window.__app.newFunction(window.__app.active, true));
  await page.locator('.calc-menus select').last().selectOption('r=f(t)');
  await page.locator('.dlg input.expr').fill('2');
  await ok(page); await p;
  expect(await paths()).toBeGreaterThan(100);
});

test('度量：自动显示点的标签，名字用点名（∠ABC、AB）', async ({ page }) => {
  await threePts(page);
  await select(page, [1, 2, 3]); await exec(page, 36957);
  const o = await objs(page);
  expect(o.filter((x: any) => x.k === 'free').map((x: any) => [x.label, x.shown])).toEqual([['A', true], ['B', true], ['C', true]]);
  const text = await page.evaluate(async () => { const r = await import('/src/ui/render.ts'); const v = window.__app.active, st = v.store; return r.valueText(st.page, st.results, st.page.objects.at(-1)); });
  expect(text).toBe('∠ABC = 90.00°');
  await select(page, [1, 2]); await exec(page, 36954);
  const t2 = await page.evaluate(async () => { const r = await import('/src/ui/render.ts'); const st = window.__app.active.store; return r.valueText(st.page, st.results, st.page.objects.at(-1)); });
  expect(t2).toMatch(/^AB = /);
});

test('度量后直接拖动点：只动被拖的点，度量值更新；拖动度量值只移动它自己', async ({ page }) => {
  await threePts(page);
  await select(page, [1, 2, 3]); await exec(page, 36957);
  await dragTo(page, [300, 300], [500, 300]);
  const o = await objs(page);
  expect(o[0].def).toMatchObject({ x: 100, y: 100 }); expect(o[1].def).toMatchObject({ x: 300, y: 100 });
  expect(o[2].def.x).toBeCloseTo(500, 0);
  const v = await page.evaluate(() => { const st = window.__app.active.store; return st.results.get(st.page.objects.at(-1).id).shape.q.v; });
  expect(v).toBeCloseTo(135, 0);
  const at = o[3].at;
  await select(page, []);
  await dragTo(page, [at.x + 10, at.y + 8], [at.x + 110, at.y + 58]);
  const o2 = await objs(page);
  expect(o2[3].at.x).toBeCloseTo(at.x + 100, 0); expect(o2[3].at.y).toBeCloseTo(at.y + 50, 0);
  expect(o2[0].def).toEqual(o[0].def); expect(o2[2].def).toEqual(o[2].def);
});

test('重做后恢复的对象处于选中状态', async ({ page }) => {
  await setTool(page, 'segment'); await dragTo(page, [100, 100], [300, 100]);
  await page.keyboard.press('Control+z'); expect((await objs(page)).length).toBe(0);
  await page.keyboard.press('Control+r');
  expect((await sel(page)).sort()).toEqual([1, 2, 3]);
});

test('坐标系：矩形网格默认显示原点和单位点；拖纵轴单位点只改纵向单位；定义坐标系显示网格和点', async ({ page }) => {
  await exec(page, 36982);
  const o = await objs(page), sys = o.find((x: any) => x.k === 'sys').def;
  expect(sys.grid).toBe('rect'); expect(sys.showGrid).toBe(true);
  for (const id of [sys.origin, sys.unitX, sys.unitY]) expect(o.find((x: any) => x.id === id).hidden).toBe(false);
  const u = () => page.evaluate(([a, b]) => { const r = window.__app.active.store.results; return [r.get(a).shape.p, r.get(b).shape.p]; }, [sys.unitX, sys.unitY]);
  const [ux0, uy0] = await u();
  const sc = await page.evaluate(() => window.__app.active.scroll);
  await dragTo(page, [uy0.x - sc.x, uy0.y - sc.y], [uy0.x - sc.x, uy0.y - sc.y - 40]);
  const [ux1, uy1] = await u();
  expect(uy1.y).toBeCloseTo(uy0.y - 40, 0); expect(ux1.x).toBeCloseTo(ux0.x, 5);
  const after = await objs(page);
  expect(after.find((x: any) => x.id === sys.unitY).def.by.dy).toBeGreaterThan(1.5);
});

test('定义坐标系：方形网格显示轴、网格、原点和横轴单位点；横轴单位点拖动同时改两个方向', async ({ page }) => {
  await exec(page, 36978);
  const o = await objs(page), sys = o.find((x: any) => x.k === 'sys').def;
  expect(sys.showGrid).toBe(true);
  expect(o.find((x: any) => x.id === sys.origin).hidden).toBe(false);
  expect(o.find((x: any) => x.id === sys.unitX).hidden).toBe(false);
  const p = await page.evaluate(id => window.__app.active.store.results.get(id).shape.p, sys.unitX);
  const sc = await page.evaluate(() => window.__app.active.scroll);
  await dragTo(page, [p.x - sc.x, p.y - sc.y], [p.x - sc.x + 40, p.y - sc.y]);
  const a = await objs(page);
  const dx = a.find((x: any) => x.id === sys.unitX).def.by.dx, dy = a.find((x: any) => x.id === sys.unitY).def.by.dy;
  expect(dx).toBeGreaterThan(1.5); expect(dy).toBeCloseTo(dx, 5);
});

test('绘制点：默认 1.0；切到极坐标自动换算；无轴时先问是否建立坐标轴；有轴和路径时的对话框', async ({ page }) => {
  let p = exec(page, 36988);
  const inputs = page.locator('.dlg input[type=text]');
  await expect(inputs.nth(0)).toHaveValue('1.0'); await expect(inputs.nth(1)).toHaveValue('1.0');
  await page.locator('.dlg input[type=radio][value=polar]').check();
  await expect(inputs.nth(0)).toHaveValue('1.414'); await expect(inputs.nth(1)).toHaveValue('45');
  await page.locator('.dlg-cancel').click(); await p;
  p = exec(page, 36987);
  await page.getByRole('button', { name: '否(N)' }).click(); await p;
  expect((await objs(page)).length).toBe(0);
  p = exec(page, 36987);
  await page.getByRole('button', { name: '是(Y)' }).click();
  await expect(page.locator('.dlg input[type=text]')).toHaveValue('0.5');
  await page.locator('.dlg select').selectOption('y');
  await ok(page); await p;
  expect((await objs(page)).find((x: any) => x.k === 'axispt').def.axis).toBe('y');
});

test('在线段上绘制点：显示目标、默认 0.5、范围', async ({ page }) => {
  await setTool(page, 'segment'); await dragTo(page, [100, 100], [300, 100]); await setTool(page, 'move');
  const p = exec(page, 36987);
  await expect(page.locator('.dlg .tgt')).toContainText('线段');
  await expect(page.locator('.dlg input[type=text]')).toHaveValue('0.5');
  await expect(page.locator('.dlg .dlg-sub')).toContainText('[0.0 .. 1.0]');
  await page.locator('.dlg-cancel').click(); await p;
});

test('文档选项：视图切换、增加页弹出菜单、单页时删除灰显；取消撤回所有改动', async ({ page }) => {
  const p = exec(page, 36871);
  await expect(page.getByRole('button', { name: '删除页(R)' })).toBeDisabled();
  await page.locator('.dlg input[type=radio][value=tools]').check();
  await expect(page.getByRole('button', { name: '复制工具' })).toBeVisible();
  await page.locator('.dlg input[type=radio][value=pages]').check();
  await page.getByRole('button', { name: '增加页(A)' }).click();
  await page.locator('.popup-menu .pi', { hasText: '空白页面' }).click();
  await expect(page.getByRole('button', { name: '删除页(R)' })).toBeEnabled();
  expect(await page.evaluate(() => window.__app.active.store.doc.pages.length)).toBe(2);
  await page.locator('.dlg-cancel').click(); await p;
  expect(await page.evaluate(() => window.__app.active.store.doc.pages.length)).toBe(1);
});

test('属性：对象、标签两页；父子对象入口；取消“可以被选中”后选不到', async ({ page }) => {
  await setTool(page, 'segment'); await dragTo(page, [100, 100], [300, 100]); await setTool(page, 'move');
  let p = exec(page, 36895);
  await expect(page.locator('.dlg-title')).toHaveText('线段 #1');
  await expect(page.locator('.dlg .tabs button')).toHaveText(['对象', '标签']);
  await expect(page.getByRole('button', { name: /父对象/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: '无子对象' })).toBeDisabled();
  await page.getByLabel('可以被选中(A)').uncheck();
  await ok(page); await p;
  await select(page, []);
  await click(page, 200, 100);
  expect(await sel(page)).toEqual([]);
  // 父对象入口：选中所选的父对象
  await select(page, [1]);
  p = exec(page, 36895);
  await page.getByRole('button', { name: /子对象/ }).click();
  await page.locator('.popup-menu .pi').first().click(); await p;
  expect(await sel(page)).toEqual([3]);
});

test('变换：只选一个点时不必先标记中心；旋转、缩放显示中心；平移有预览，直角坐标有标记距离选项', async ({ page }) => {
  await setTool(page, 'point'); await click(page, 200, 200); await setTool(page, 'move');
  let p = exec(page, 36947);
  await expect(page.locator('.dlg-title')).toHaveText('缩放');
  await expect(page.locator('.dlg .tgt')).toHaveText('A');
  await expect(page.locator('.dlg input[type=text]').nth(0)).toHaveValue('1.0');
  await expect(page.locator('.dlg input[type=text]').nth(1)).toHaveValue('2.0');
  await page.locator('.dlg-cancel').click(); await p;
  p = exec(page, 36946);
  await expect(page.locator('.dlg input[type=text]').first()).toHaveValue('90.0');
  await page.locator('.dlg-cancel').click(); await p;
  p = exec(page, 36945);
  await expect(page.locator('.dlg input[type=text]').first()).toHaveValue('1.0');
  expect(await page.evaluate(() => window.__app.active.ghost?.page.objects.length)).toBe(1);
  expect(await page.evaluate(() => window.__app.active.store.page.objects.length)).toBe(1);
  await page.locator('.dlg input[type=radio][value=rect]').check();
  await expect(page.locator('input[name=tdx][value=marked]')).toBeDisabled();
  await page.locator('.dlg-cancel').click(); await p;
  expect(await page.evaluate(() => window.__app.active.ghost)).toBeUndefined();
  expect(await page.evaluate(() => window.__app.active.store.canRedo)).toBe(false);
});

test('打印预览：空白页只提示；有内容时有翻页、缩放、比例控件', async ({ page }) => {
  await exec(page, 36873);
  await expect(page.locator('.dlg .dlg-text')).toContainText('没有可以打印');
  await ok(page);
  await expect(page.locator('#printpreview')).toHaveCount(0);
  await setTool(page, 'point'); await click(page, 200, 200); await setTool(page, 'move');
  await exec(page, 36873);
  await expect(page.locator('.pvbar button')).toHaveText(['→', '←', '放大', '缩小', '调整到页面大小(F)', '打印(P)…', '关闭(C)']);
  await expect(page.locator('.pvbar .pvbig input')).toBeDisabled();
  await expect(page.locator('.pvstatus')).toHaveText('1页');
  await expect(page.locator('.pvsheet')).toHaveCount(1);
  await page.locator('.pvbar input[type=text]').fill('1000'); await page.locator('.pvbar input[type=text]').press('Tab');   // 比例 1000：铺到多张纸
  expect(await page.locator('.pvsheet').count()).toBeGreaterThan(1);
  await expect(page.locator('.pvstatus')).toContainText('1页-');
  await page.locator('.pvbar button', { hasText: '调整到页面大小' }).click();
  await expect(page.locator('.pvsheet')).toHaveCount(1);
  await page.locator('.pvbar button', { hasText: '关闭' }).click();
});

test('运动控制台：动画开始时自动出现；有目标、播放、停止、反向、暂停、速度；暂停真的停住', async ({ page }) => {
  await setTool(page, 'segment'); await dragTo(page, [100, 100], [400, 100]);
  await setTool(page, 'point'); await click(page, 200, 100); await setTool(page, 'move');
  expect(await page.locator('.motion').isVisible()).toBe(false);
  await exec(page, 36917);
  await expect(page.locator('.motion')).toBeVisible();
  await expect(page.locator('.motion .mo-title')).toContainText('运动控制台');
  await expect(page.locator('.motion select option').nth(1)).toHaveText(/点/);
  await expect(page.locator('.motion .mo-row button')).toHaveCount(4);
  const t = () => page.evaluate(() => { const st = window.__app.active.store; const o = st.page.objects.find((x: any) => x.def.k === 'onpath'); return st.ctx.tOverride?.get(o.id); });
  await page.locator('.motion button[data-k=pause]').click();
  const a = await t(); await page.waitForTimeout(200); expect(await t()).toBe(a);
  await page.locator('.motion button[data-k=play]').click();
  await page.waitForTimeout(200); expect(await t()).not.toBe(a);
  await page.locator('.motion .mo-speed').fill('2'); await page.locator('.motion .mo-speed').press('Tab');
  expect(await page.evaluate(() => window.__app.anim.factor)).toBe(2);
  await page.locator('.motion button[data-k=stop]').click();
  expect(await page.evaluate(() => window.__app.anim.running)).toBe(false);
  await page.locator('.motion .mo-title button').click();
  await expect(page.locator('.motion')).toBeHidden();
});

test('文档窗口有滚动条且可用；状态栏显示选择数量，空白时箭头工具没有提示；窗口标题有文档名', async ({ page }) => {
  await expect(page.locator('#status')).toHaveText('');
  await expect(page).toHaveTitle(/未命名1.*新版/);
  await expect(page.locator('.docwin.active .sbv')).toBeVisible(); await expect(page.locator('.docwin.active .sbh')).toBeVisible();
  await threePts(page);
  await select(page, [1, 2]); await expect(page.locator('#status')).toHaveText('2 点');
  await setTool(page, 'segment'); await select(page, []);
  await expect(page.locator('#status')).not.toHaveText('');
  await page.evaluate(() => { const v = window.__app.active; v.store.run('t', () => v.store.moveFree(1, 100, 2400)); });
  await page.waitForFunction(() => document.querySelector('.docwin.active .sbv')!.scrollHeight > document.querySelector('.docwin.active .sbv')!.clientHeight + 100);
  await page.locator('.docwin.active .sbv').evaluate(e => { e.scrollTop = 300; });
  await page.waitForFunction(() => window.__app.active.scroll.y === 300);
});

test('空白右键参数曲线可用，缺函数时提示；定义导函数：选中函数时可用并建立导函数', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => window.__app.queryMenu(36991).enabled)).toBe(true);
  let p = exec(page, 36991);
  await expect(page.locator('.dlg .dlg-text')).toContainText('需要先有函数');
  await ok(page); await p;
  p = page.evaluate(() => window.__app.newFunction(window.__app.active, false));
  await page.locator('.dlg input.expr').fill('x^2+3*x'); await ok(page); await p;
  expect((await page.evaluate(() => window.__app.queryMenu(36976))).enabled).toBe(true);
  await exec(page, 36976);
  const r = await page.evaluate(async () => { const e = await import('/src/core/expr.ts'); const o = window.__app.active.store.page.objects.at(-1); return { name: o.def.name, v: e.evalExpr(o.def.expr, { ref: () => undefined, x: { v: 2, u: 'none' } })?.v }; });
  expect(r.name).toBe("f'"); expect(r.v).toBeCloseTo(7, 6);
});

test('自定义工具菜单：没有选中对象、没有工具时只有选择工具文件夹可用（点它会打开文件夹选择）', async ({ page }) => {
  await page.locator('.tool[data-group="custom"]').dispatchEvent('pointerdown', { button: 0 });
  await expect(page.locator('.toolmenu .item')).toHaveCount(4);
  await expect(page.locator('.toolmenu .item.disabled')).toHaveCount(3);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.toolmenu .item', { hasText: '选择工具文件夹' }).click();
  await chooser;   // 浏览器里用 <input webkitdirectory> 代替桌面版的文件夹对话框
});
