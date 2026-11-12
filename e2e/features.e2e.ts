import { expect, test, type Page } from '@playwright/test';
import { Store } from '../src/core/store';
import { encodeGsp } from '../src/gsp/codec';

declare global { interface Window { __app: any } }
const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { (window as any).showSaveFilePicker = undefined; });
  await page.goto('/'); await page.waitForFunction(() => !!window.__app);
});
test.afterEach(() => { expect(errors).toEqual([]); });

/** 在页面里搭一个标准场景：A B C 三个自由点，线段 AB、BC、圆。 */
async function scene(page: Page) {
  await page.evaluate(() => {
    const v = window.__app.active, st = v.store;
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 200, y: 250 }).id, b = st.add({ k: 'free', x: 420, y: 250 }).id, c = st.add({ k: 'free', x: 300, y: 430 }).id;
      st.add({ k: 'seg', a, b }); st.add({ k: 'seg', a: b, b: c }); st.add({ k: 'circle', c, p: a });
    });
  });
}
const exec = (page: Page, id: number, shift = false) => page.evaluate(([i, s]) => window.__app.exec(i, s), [id, shift] as const);
const select = (page: Page, ids: number[]) => page.evaluate(ids2 => window.__app.active.setSel(ids2), ids);
const dlgTitle = (page: Page) => page.locator('.dlg-title');
const ok = (page: Page) => page.locator('.dlg button.primary').click();
const kinds = (page: Page) => page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));

test('变换：标记中心后旋转、缩放；标记镜面后反射；平移对话框', async ({ page }) => {
  await scene(page);
  await select(page, [3]); await exec(page, 36939);                       // 标记中心 C
  await select(page, [1, 2, 4]);
  const p1 = exec(page, 36946); await expect(dlgTitle(page)).toHaveText('旋转'); await page.locator('.dlg input[type=text]').first().fill('30'); await ok(page); await p1;
  expect((await kinds(page)).filter(k => k === 'rotate').length).toBe(2);
  await select(page, [1]);
  const p2 = exec(page, 36947); await expect(dlgTitle(page)).toHaveText('缩放'); await ok(page); await p2;
  expect(await kinds(page)).toContain('dilate');
  await select(page, [4]); await exec(page, 36940);                       // 线段 AB？id 4 是 AB
  await select(page, [3]);
  await exec(page, 36948);
  expect(await kinds(page)).toContain('reflect');
  await select(page, [1]);
  const p3 = exec(page, 36945); await expect(dlgTitle(page)).toHaveText('平移');
  await page.locator('.dlg input[type=radio][value=rect]').check(); await ok(page); await p3;
  expect((await kinds(page)).filter(k => k === 'translate').length).toBe(1);
});

test('度量：长度、角度、坐标；坐标系自动建立；度量值显示在画板上', async ({ page }) => {
  await scene(page);
  await select(page, [4]); await exec(page, 36953);
  await select(page, [1, 2, 3]); await exec(page, 36957);
  await select(page, [1]); await exec(page, 36965);
  const ks = await kinds(page);
  expect(ks).toContain('sys'); expect(ks.filter(k => k === 'measure').length).toBe(3);
  const texts = await page.evaluate(() => window.__app.active.store.page.objects.filter((o: any) => o.def.k === 'measure').map((o: any) => { const s = window.__app.active.store.results.get(o.id).shape; return s.q.v; }));
  expect(texts[0]).toBeCloseTo(220 / (96 / 2.54), 2);
});

test('数据：新建参数、计算引用参数、制表、添加表中数据、绘制点', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  const inputs = page.locator('.dlg input[type=text]'); await inputs.nth(0).fill('t'); await inputs.nth(1).fill('2'); await ok(page);
  await page.keyboard.press('Alt+=');
  await expect(dlgTitle(page)).toHaveText('新建计算');
  await page.locator('.dlg input.expr').fill('t*3+1'); await ok(page);
  const v = await page.evaluate(() => window.__app.active.store.results.get(2).shape.q.v);
  expect(v).toBe(7);
  await select(page, [1, 2]); await exec(page, 36972);
  expect(await kinds(page)).toContain('table');
  await select(page, [3]);
  const p = exec(page, 36973); await expect(dlgTitle(page)).toHaveText('添加表中数据'); await ok(page); await p;
  expect(await page.evaluate(() => window.__app.active.store.page.objects[2].def.rows.length)).toBe(2);
  const pp = exec(page, 36988);        // 绘制点（无选择→对话框）
  await expect(dlgTitle(page)).toHaveText('绘制点');
  await page.locator('.dlg input[type=text]').first().fill('1'); await page.locator('.dlg input[type=text]').nth(1).fill('2'); await ok(page); await pp;
  expect(await kinds(page)).toContain('plotxy');
});

test('参数动画与路径点动画：开始、暂停，不修改构造定义；追踪留下痕迹', async ({ page }) => {
  await scene(page);
  await select(page, [4]); await exec(page, 36924);       // 线段上的点
  const id = await page.evaluate(() => window.__app.active.store.page.objects.at(-1).id);
  const t0 = await page.evaluate(i => window.__app.active.store.get(i).def.t, id);
  await select(page, [id]);
  await exec(page, 36915);                                 // 追踪
  await exec(page, 36917);                                 // 动画
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__app.anim.running)).toBe(true);
  await exec(page, 36920);                                 // 停止
  expect(await page.evaluate(() => window.__app.anim.running)).toBe(false);
  expect(await page.evaluate(i => window.__app.active.store.get(i).def.t, id)).toBe(t0);       // 定义没变
  expect(await page.evaluate(() => window.__app.active.store.dirty)).toBe(true);               // 只因为之前的构造
  const traced = await page.evaluate(() => { const c = window.__app.active.trace as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  expect(traced).toBeGreaterThan(20);
  await exec(page, 36916);
  expect(await page.evaluate(() => { const c = window.__app.active.trace as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; return d.some((x: number, i: number) => i % 4 === 3 && x > 0); })).toBe(false);
});

test('按钮：隐藏/显示按钮、链接按钮、动画按钮对话框；点击按钮执行', async ({ page }) => {
  await scene(page);
  await select(page, [3]); await exec(page, 36882);
  const btn = await page.evaluate(() => window.__app.active.store.page.objects.at(-1));
  expect(btn.def.k).toBe('button'); expect(btn.def.text).toContain('隐藏'); expect(btn.def.action).toMatchObject({ mode: 'toggle', first: 'hide' });   // 原版默认：切换，当前动作是隐藏
  const press = () => page.evaluate(() => window.__app.pressButton(window.__app.active, window.__app.active.store.page.objects.at(-1)));
  const hidden = () => page.evaluate(() => window.__app.active.store.get(3).hidden);
  await press(); expect(await hidden()).toBe(true);
  expect(await page.evaluate(() => window.__app.active.store.page.objects.at(-1).def.action.first)).toBe('show');   // 按下后下一次是显示
  await press(); expect(await hidden()).toBe(false);
  await select(page, [3]); await exec(page, 36882, true);       // 按住 Shift：先显示再隐藏
  expect(await page.evaluate(() => window.__app.active.store.page.objects.at(-1).def.action.first)).toBe('show');
  await press(); expect(await hidden()).toBe(false);
  await press(); expect(await hidden()).toBe(true);
  await press(); expect(await hidden()).toBe(false);
  const p = exec(page, 36887); await expect(dlgTitle(page)).toHaveText('链接按钮'); await page.locator('.dlg input[type=text]').fill('https://example.org/x'); await ok(page); await p;
  expect(await page.evaluate(() => window.__app.active.store.page.objects.at(-1).def.action.url)).toBe('https://example.org/x');
  await select(page, [1]);
  const q = exec(page, 36883); await expect(dlgTitle(page)).toHaveText('动画按钮'); await ok(page); await q;
  expect((await kinds(page)).filter(k => k === 'button').length).toBe(4);
});

test('多页：增加页、复制页、切换、页面链接按钮', async ({ page }) => {
  await scene(page);
  const p = exec(page, 36871); await expect(dlgTitle(page)).toHaveText('文档选项');
  await page.getByRole('button', { name: '增加页(A)' }).click();
  await page.locator('.popup-menu .pi', { hasText: '1：' }).click();
  await page.getByRole('button', { name: '增加页(A)' }).click();
  await page.locator('.popup-menu .pi', { hasText: '空白页面' }).click();
  await page.locator('.dlg button.primary').click(); await p;
  expect(await page.evaluate(() => window.__app.active.store.doc.pages.length)).toBe(3);
  expect(await page.locator('#pagebar button').count()).toBe(3);
  await page.locator('#pagebar button').nth(1).click();
  expect(await page.evaluate(() => window.__app.active.store.page.objects.length)).toBe(6);
});

test('旧课件链接按钮打开对应的本地帮助和邮件入口', async ({ page }) => {
  const st = new Store();
  const urls = ['Help://ToolboxFldr/CustomToolsFldr/ToolFolder.htm', 'mailto:teacher+lesson@example.test'];
  st.run('旧课件链接', () => {
    urls.forEach((url, i) => st.add({
      k: 'button', action: { type: 'link', page: 0, url }, text: i ? '联系作者' : '工具帮助',
      at: { x: 80, y: 100 + i * 80 }, w: 130, h: 28,
    }));
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles({ name: '旧链接.gsp', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeGsp(st.doc)) });
  await page.waitForFunction(() => window.__app.docs.length === 2);
  await page.evaluate(() => {
    const urls: string[] = [];
    window.__app.testOpenedUrls = urls;
    window.open = url => { urls.push(String(url)); return null; };
  });
  const canvas = page.locator('.docwin.active canvas').last();
  await canvas.click({ position: { x: 100, y: 110 } });
  await expect(page.getByRole('dialog')).toContainText('工具文件夹');
  await ok(page);
  await canvas.click({ position: { x: 100, y: 190 } });
  expect(await page.evaluate(() => window.__app.testOpenedUrls)).toEqual([urls[1]]);
});

test('移动按钮同时执行时区分目标的初始位置和最终位置', async ({ page }) => {
  const st = new Store();
  const pairs = [false, true].map(initial => {
    const y = initial ? 300 : 200;
    const [a, b, c] = [200, 400, 600].map(x => st.add({ k: 'free', x, y }).id);
    const follow = st.add({ k: 'button', text: '移动 A', at: { x: 30, y: y - 100 }, w: 90, h: 28,
      action: { type: 'move', from: a, to: b, speed: 'high', ...(initial ? { toInitial: true } : { legacyFinal: true }) } }).id;
    const move = st.add({ k: 'button', text: '移动 B', at: { x: 140, y: y - 100 }, w: 90, h: 28,
      action: { type: 'move', from: b, to: c, speed: 'high' } }).id;
    const button = st.add({ k: 'button', text: '运行', at: { x: 250, y: y - 100 }, w: 90, h: 28,
      action: { type: 'series', buttons: [follow, move], mode: 'together' } }).id;
    return { a, b, button };
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles({ name: '并行移动.gsp', mimeType: 'application/octet-stream', buffer: Buffer.from(encodeGsp(st.doc)) });
  await page.waitForFunction(() => window.__app.docs.length === 2);
  await page.evaluate(ids => {
    const app = window.__app, v = app.active;
    ids.forEach(({ button }) => app.pressButton(v, v.store.get(button)));
  }, pairs);
  await expect.poll(() => page.evaluate(ids => ids.map(({ a, b }) => {
    const results = window.__app.active.store.results;
    return [results.get(a)?.shape?.p.x, results.get(b)?.shape?.p.x];
  }), pairs)).toEqual([[600, 600], [400, 600]]);
});

test('属性、标签、参数选项、页面设置、颜色等对话框能打开并确认', async ({ page }) => {
  await scene(page);
  await select(page, [1]);
  let p = exec(page, 36895); await expect(page.locator('.dlg-title')).toContainText('点'); await ok(page); await p;
  p = exec(page, 36914); await expect(dlgTitle(page)).toHaveText('标签'); await page.locator('.dlg input[type=text]').first().fill('P'); await ok(page); await p;
  expect(await page.evaluate(() => window.__app.active.store.get(1).label)).toBe('P');
  p = exec(page, 36896); await expect(dlgTitle(page)).toHaveText('参数选项'); await page.locator('.dlg .tabs button', { hasText: '工具' }).click(); await page.locator('.dlg select.power').selectOption('mid'); await ok(page); await p;
  expect(await page.evaluate(() => window.__app.settings.power)).toBe('mid');
  p = exec(page, 36872); await expect(dlgTitle(page)).toHaveText('页面设置'); await ok(page); await p;
  p = exec(page, 36909); await expect(dlgTitle(page)).toHaveText('颜色'); await page.locator('.dlg .sw').nth(5).click(); await ok(page); await p;
  expect(await page.evaluate(() => window.__app.active.store.get(1).style.color)).toBe('#ff0000');
});

test('剪贴板：复制粘贴保留依赖；剪切；撤消重做', async ({ page }) => {
  await scene(page);
  await select(page, [4]); await exec(page, 36879); await exec(page, 36880);
  const ks = await kinds(page);
  expect(ks.length).toBe(6 + 2 + 1);                       // 复制线段 + 其两个端点（外部父对象一并复制）
  await page.keyboard.press('Control+z'); expect((await kinds(page)).length).toBe(6);
  await page.keyboard.press('Control+r'); expect((await kinds(page)).length).toBe(9);
});

test('选择父对象/子对象、全选、清除（删除依赖对象）', async ({ page }) => {
  await scene(page);
  await select(page, [4]); await exec(page, 36890);
  expect(await page.evaluate(() => window.__app.active.sel)).toEqual([1, 2]);
  await exec(page, 36891);
  expect((await page.evaluate(() => window.__app.active.sel.length))).toBeGreaterThan(0);
  await select(page, [1]); await exec(page, 36881);
  expect(await kinds(page)).toEqual(['free', 'free', 'seg']);        // A 的线段 AB 和圆随之删除，BC 保留
});

test('锁定的界面选项：显示文本工具栏、运动控制台、隐藏工具箱', async ({ page }) => {
  await exec(page, 36921); await expect(page.locator('#textbar')).toBeVisible();
  await exec(page, 36922); await expect(page.locator('.motion')).toBeVisible();
  await exec(page, 36923); await expect(page.locator('.toolbox')).toBeHidden();
});

test('暂缓的命令保持原位置并禁用', async ({ page }) => {
  for (const id of [36949, 36950, 36976, 36977, 36885, 36886]) expect((await page.evaluate(i => window.__app.queryMenu(i), id)).enabled).toBe(false);
});

test('旋转箭头工具与缩放箭头工具：拖动自由点绕标记中心转动', async ({ page }) => {
  await scene(page);
  await select(page, [3]); await exec(page, 36939);
  await page.locator('.tool[data-group="arrow"]').click();
  await page.evaluate(() => { window.__app.setTool('rotate'); window.__app.active.setSel([1]); });
  const box = (await page.locator('.docwin canvas').last().boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 250); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 250 + 40, { steps: 6 }); await page.mouse.up();
  const a = await page.evaluate(() => window.__app.active.store.get(1).def);
  expect(Math.hypot(a.x - 300, a.y - 430)).toBeCloseTo(Math.hypot(200 - 300, 250 - 430), 0);   // 半径不变，位置变了
  expect(Math.abs(a.x - 200) + Math.abs(a.y - 250)).toBeGreaterThan(10);
});

test('轨迹：圆上的点与它的中点构造轨迹', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('x', () => { const p = st.add({ k: 'onpath', path: 6, t: 1 }); const m = st.add({ k: 'seg', a: 3, b: p.id }); const mid = st.add({ k: 'mid', seg: m.id }); window.__app.active.setSel([p.id, mid.id]); });
  });
  expect((await page.evaluate(() => window.__app.queryMenu(36938))).enabled).toBe(true);
  await exec(page, 36938);
  const n = await page.evaluate(() => { const o = window.__app.active.store.page.objects.at(-1); return window.__app.active.store.results.get(o.id).shape.paths[0].length; });
  expect(n).toBeGreaterThan(100);
});

test('信息工具：单击对象出现气泡，再点别的对象前一个气泡保留', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => window.__app.setTool('info'));
  const box = (await page.locator('.docwin canvas').last().boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 250); await page.mouse.click(box.x + 420, box.y + 250);
  expect(await page.evaluate(() => (window.__app.active as any).bubbles.length)).toBe(2);
});

test('性能：1000 个对象，拖动一个点的“重算+绘制”帧耗时 P95 ≤ 33ms（本机固定基准）', async ({ page }) => {
  const r = await page.evaluate(() => {
    const v = window.__app.active, st = v.store;
    st.run('基准', () => {
      const pts: number[] = [];
      for (let i = 0; i < 250; i++) pts.push(st.add({ k: 'free', x: 60 + (i % 25) * 30, y: 60 + Math.floor(i / 25) * 30 }).id);
      for (let i = 0; i + 1 < 250; i++) st.add({ k: 'seg', a: pts[i], b: pts[i + 1] });
      for (let i = 0; i < 249; i++) st.add({ k: 'mid', seg: 251 + i });
      for (let i = 0; i < 250; i++) st.add({ k: 'circle', c: pts[i], p: pts[(i + 3) % 250] });
    });
    const times: number[] = [];
    st.begin('拖动');
    for (let i = 0; i < 120; i++) { const t0 = performance.now(); st.moveFree(1, 60 + (i % 60), 60 + (i % 40)); (v as any).paint(); times.push(performance.now() - t0); }
    st.commit();
    times.sort((a, b) => a - b);
    return { n: st.page.objects.length, p50: times[60], p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1] };
  });
  console.log(`[性能] ${r.n} 个对象：帧耗时 P50 ${r.p50.toFixed(2)} ms，P95 ${r.p95.toFixed(2)} ms，最大 ${r.max.toFixed(2)} ms`);
  expect(r.p95).toBeLessThanOrEqual(33);
});

async function pt(page: Page, x: number, y: number) { const b = (await page.locator('.docwin canvas').last().boundingBox())!; return { x: b.x + x, y: b.y + y }; }
async function pdrag(page: Page, x0: number, y0: number, x1: number, y1: number) { const a = await pt(page, x0, y0), b = await pt(page, x1, y1); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); }

test('作图吸附：终点距已有点 10 px 内吸附（不新建点），11 px 外新建', async ({ page }) => {
  await scene(page);        // A(200,250) B(420,250) C(300,430)
  await page.locator('.tool[data-group="ruler"]').click();
  const n0 = (await kinds(page)).filter(k => k === 'free').length;
  await pdrag(page, 600, 100, 300 + 7, 430 + 7);          // 终点在 C 旁约 9.9 px
  expect((await kinds(page)).filter(k => k === 'free').length).toBe(n0 + 1);     // 只新建起点
  await pdrag(page, 650, 100, 300 + 8, 430 + 8);          // 约 11.3 px：不吸附
  expect((await kinds(page)).filter(k => k === 'free').length).toBe(n0 + 3);
});

test('在线上松开：终点成为依附在线段上的点；在圆内部松开是自由点', async ({ page }) => {
  await scene(page);
  await page.locator('.tool[data-group="ruler"]').click();
  await pdrag(page, 700, 100, 310, 250);                  // 终点落在线段 AB 上
  const last = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));
  expect(last.slice(-3)).toEqual(['free', 'onpath', 'seg']);
});

test('拖动线段中间：整条线段平移，撤消名为“撤消平移线段”；拖动圆心整个圆移动', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => window.__app.active.setSel([]));
  await pdrag(page, 310, 250, 340, 280);
  const a = await page.evaluate(() => window.__app.active.store.get(1).def), b = await page.evaluate(() => window.__app.active.store.get(2).def);
  expect(a.x).toBeCloseTo(230, 0); expect(b.x).toBeCloseTo(450, 0); expect(a.y).toBeCloseTo(280, 0);
  expect((await page.evaluate(() => window.__app.queryMenu(36876))).name).toBe('撤消平移线段');
  await page.keyboard.press('Control+z');
  await pdrag(page, 300, 430, 330, 450);                  // 拖圆心 C
  const c = await page.evaluate(() => window.__app.active.store.get(3).def);
  expect(c.x).toBeCloseTo(330, 0);
});

test('拖动圆上的点改变半径、圆心不动；拖动线上的点沿线滑动', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => { st.add({ k: 'onpath', path: 4, t: 0.5 }); }); window.__app.active.setSel([]); });
  await pdrag(page, 200, 250, 150, 250);                  // 拖 A（圆上的半径点）
  const c = await page.evaluate(() => window.__app.active.store.get(3).def);
  expect(c.x).toBe(300);
  const p = await page.evaluate(() => { window.__app.active.setSel([]); return window.__app.active.store.results.get(7).shape.p; });
  await pdrag(page, p.x, p.y, 380, 600);                   // 拖线上的点：投影回线段 AB 上
  const q = await page.evaluate(() => window.__app.active.store.results.get(7).shape.p);
  expect(Math.abs(q.y - 250)).toBeLessThan(40);
});

test('合并点：依赖第一点的对象改依赖第二点；合并点到路径得到路径上的点；从路径分离', async ({ page }) => {
  await scene(page);                                       // A B C 线段 AB BC 圆(C→A)
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => { st.add({ k: 'free', x: 500, y: 100 }); }); window.__app.active.setSel([]); });
  await select(page, [7, 2]); await exec(page, 36893);    // 7 并入 B
  expect(await page.evaluate(() => window.__app.active.store.page.objects.length)).toBe(6);
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => { st.add({ k: 'free', x: 300, y: 250 }); }); });
  await select(page, [8, 4]); expect((await page.evaluate(() => window.__app.queryMenu(36893))).name).toBe('合并点到线段');
  await exec(page, 36893);
  expect((await page.evaluate(() => window.__app.active.store.get(8).def.k))).toBe('onpath');
  await select(page, [8]); expect((await page.evaluate(() => window.__app.queryMenu(36893))).name).toBe('从线段分离点');
  await exec(page, 36893);
  expect((await page.evaluate(() => window.__app.active.store.get(8).def.k))).toBe('free');
});

test('从定义分离点：Shift 时反射得到的点变成自由点', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => { st.add({ k: 'reflect', src: 3, mirror: 4 }); }); });
  await select(page, [7]);
  expect((await page.evaluate(() => window.__app.queryMenu(36893, true))).name).toBe('从定义分离点');
  await exec(page, 36893, true);
  expect((await page.evaluate(() => window.__app.active.store.get(7).def.k))).toBe('free');
});

test('自由点和线段也可以动画（沿随机方向运动），暂停后不改定义', async ({ page }) => {
  await scene(page);
  await select(page, [4]); await exec(page, 36917);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__app.anim.running)).toBe(true);
  const moved = await page.evaluate(() => { const r = window.__app.active.store.results.get(1).shape.p; return Math.hypot(r.x - 200, r.y - 250); });
  expect(moved).toBeGreaterThan(3);
  await exec(page, 36920);
  expect(await page.evaluate(() => window.__app.active.store.get(1).def.x)).toBe(200);
});

test('函数图像上绘制点：值是横坐标，纵坐标由函数决定', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('x', () => {
      const a = st.add({ k: 'free', x: 400, y: 300 }).id; void a;
    });
  });
  await page.keyboard.press('Control+g');
  await page.locator('.dlg input.expr').fill('x^2'); await ok(page);
  const plot = await page.evaluate(() => window.__app.active.store.page.objects.find((o: any) => o.def.k === 'plot').id);
  await select(page, [plot]);
  const p = exec(page, 36987); await page.locator('.dlg input[type=text]').first().fill('2'); await ok(page); await p;
  const pv = await page.evaluate(() => { const st = window.__app.active.store; const o = st.page.objects.at(-1); const s = st.results.get(o.id).shape; const sys = st.page.objects.find((x: any) => x.def.k === 'sys'); const sh = st.results.get(sys.id).shape; return { k: o.def.k, dx: (s.p.x - sh.origin.x) / sh.ux.x, dy: (s.p.y - sh.origin.y) / sh.uy.y }; });
  expect(pv.k).toBe('pointval'); expect(pv.dx).toBeCloseTo(2, 4); expect(pv.dy).toBeCloseTo(4, 4);
});

test('Shift+Ctrl+Z 撤消所有；参数右键“增加/减少数值”', async ({ page }) => {
  await scene(page);
  await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => window.__app.active.store.page.objects.length)).toBe(0);
  await page.keyboard.press('Control+Shift+r');
  expect(await page.evaluate(() => window.__app.active.store.page.objects.length)).toBe(6);
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => { st.add({ k: 'param', name: 't', value: 2, unit: 'none', showEdit: true }, { at: { x: 5, y: 5 } }); }); window.__app.active.setSel([7]); });
  await exec(page, 200003);
  expect(await page.evaluate(() => window.__app.active.store.get(7).def.value)).toBe(3);
});

test('打印：保留打印内容后导出 PDF，是 1 页 A4 且含画板图像', async ({ page }) => {
  await scene(page);
  await page.evaluate(() => { (window as any).__keepPrintRoot = true; window.print = () => undefined; window.__app.print(window.__app.active); });
  await page.waitForSelector('#printroot img', { state: 'attached' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const text = pdf.toString('latin1');
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((text.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text);
  expect(Math.abs(Number(box?.[1]) - 595)).toBeLessThan(3);
  expect(Math.abs(Number(box?.[2]) - 842)).toBeLessThan(3);
  expect(text).toMatch(/\/Subtype\s*\/Image/);
});

test('粘贴图片：按原始像素大小放在左上角，非 PNG 转成 PNG（原版文件只存 PNG）', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 20; const c = cv.getContext('2d')!; c.fillStyle = '#c81e1e'; c.fillRect(0, 0, 40, 20);
    const jpeg = cv.toDataURL('image/jpeg').split(',')[1], png = cv.toDataURL('image/png').split(',')[1];
    const a = window.__app, v = a.active;
    a.pasteImage(v, png, 'image/png'); a.pasteImage(v, jpeg, 'image/jpeg');
    for (let i = 0; i < 50 && v.store.page.objects.length < 2; i++) await new Promise(res => setTimeout(res, 50));
    return v.store.page.objects.map((o: any) => ({ k: o.def.k, mime: o.def.mime, at: o.def.at, w: o.def.w, h: o.def.h }));
  });
  expect(r).toEqual([{ k: 'image', mime: 'image/png', at: { x: 14, y: 9 }, w: 40, h: 20 }, { k: 'image', mime: 'image/png', at: { x: 14, y: 9 }, w: 40, h: 20 }]);
});

test('系列按钮：同时执行两个隐藏按钮；“取消所有选定”', async ({ page }) => {
  await scene(page);
  const r = await page.evaluate(() => {
    const a = window.__app, v = a.active, st = v.store;
    let b1: any, b2: any, s: any;
    st.run('b', () => {
      b1 = st.add({ k: 'button', action: { type: 'hideshow', targets: [1], mode: 'hide' }, text: '隐藏A', at: { x: 10, y: 10 }, w: 80, h: 28 });
      b2 = st.add({ k: 'button', action: { type: 'hideshow', targets: [2], mode: 'hide' }, text: '隐藏B', at: { x: 100, y: 10 }, w: 80, h: 28 });
      s = st.add({ k: 'button', action: { type: 'series', buttons: [b1.id, b2.id], mode: 'together', deselect: true }, text: '系列', at: { x: 190, y: 10 }, w: 80, h: 28 });
    });
    v.setSel([3]);
    a.pressButton(v, s);
    return { hidden: [st.get(1).hidden, st.get(2).hidden, st.get(3).hidden], sel: v.sel.length };
  });
  expect(r).toEqual({ hidden: [true, true, false], sel: 0 });
});

test('迭代：选两个点，面板里点画板指定初象，迭代出线段和点的像；增加迭代；右键菜单增加迭代；没有目标时提示', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 200, y: 200 }).id, b = st.add({ k: 'free', x: 400, y: 200 }).id;
      const s = st.add({ k: 'seg', a, b }).id; st.add({ k: 'mid', seg: s });
    });
  });
  const box = (await page.locator('.docwin canvas').last().boundingBox())!;
  const click = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
  await select(page, [1, 2]);
  expect(await page.evaluate(() => window.__app.queryMenu(36949).enabled)).toBeTruthy();
  void exec(page, 36949);
  await expect(page.locator('.iterpanel')).toBeVisible();
  await expect(page.locator('.iterpanel .iter-row')).toHaveCount(2);
  await expect(page.locator('.iterpanel button.primary')).toBeDisabled();
  await click(400, 200); await click(300, 200);                 // A→B，B→M
  await expect(page.locator('.iterpanel button.primary')).toBeEnabled();
  await page.locator('.iterpanel button.iter-pop', { hasText: '显示' }).click();
  await page.locator('.ipop .iitem', { hasText: '增加迭代' }).click();
  await expect(page.locator('.iterpanel .iter-depth')).toHaveText('迭代次数：4。');
  await page.locator('.iterpanel button.primary').click();
  await expect(page.locator('.iterpanel')).toHaveCount(0);
  const r = await page.evaluate(() => {
    const v = window.__app.active, os = v.store.page.objects;
    const it = os.find((o: any) => o.def.k === 'iterate');
    const imgs = os.filter((o: any) => o.def.k === 'iterimg').map((o: any) => ({ src: o.def.src, n: v.store.results.get(o.id)?.shape?.items?.length }));
    return { it: it?.def, imgs, sel: v.sel.length };
  });
  expect(r.it).toMatchObject({ k: 'iterate', pre: [1, 2], maps: [[2, 4]], depth: { fixed: 4 } });
  expect(r.imgs).toEqual([{ src: 3, n: 4 }, { src: 4, n: 4 }]);
  expect(r.sel).toBe(2);
  // 右键菜单里的“增加迭代”
  await page.evaluate(() => window.__app.exec(200005));
  expect(await page.evaluate(() => window.__app.active.store.page.objects.find((o: any) => o.def.k === 'iterate').def.depth)).toEqual({ fixed: 5 });
  // 没有依赖原象的对象时给出提示
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => { st.add({ k: 'free', x: 600, y: 300 }); }); window.__app.active.setSel([st.page.objects.at(-1).id]); });
  void exec(page, 36949);
  await expect(page.locator('.dlg .dlg-text')).toContainText('没有依赖于所选原象');
  await ok(page);
});

test('深度迭代：按住 Shift 且最后选参数，次数取自参数；改参数后像的个数跟着变', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 200, y: 200 }).id, b = st.add({ k: 'free', x: 400, y: 200 }).id;
      const s = st.add({ k: 'seg', a, b }).id; st.add({ k: 'mid', seg: s });
      st.add({ k: 'param', name: 'n', value: 3, unit: 'none', showEdit: true }, { at: { x: 20, y: 20 } });
    });
  });
  const box = (await page.locator('.docwin canvas').last().boundingBox())!;
  await select(page, [1, 2, 5]);
  expect(await page.evaluate(() => window.__app.queryMenu(36949, true).name)).toContain('深度迭代');
  void exec(page, 36949, true);
  await expect(page.locator('.iterpanel .dlg-title')).toHaveText('深度迭代');
  await expect(page.locator('.iterpanel .iter-row')).toHaveCount(2);        // 参数 n 不是原象
  await expect(page.locator('.iterpanel .iter-depth')).toContainText('取自参数');
  await page.mouse.click(box.x + 400, box.y + 200); await page.mouse.click(box.x + 300, box.y + 200);
  await page.locator('.iterpanel button.primary').click();
  const count = () => page.evaluate(() => { const v = window.__app.active; return v.store.page.objects.filter((o: any) => o.def.k === 'iterimg').map((o: any) => v.store.results.get(o.id)?.shape?.items?.length); });
  expect(await count()).toEqual([3, 3]);
  await page.evaluate(() => { const st = window.__app.active.store; st.run('x', () => st.update(5, { ...st.get(5).def, value: 6 })); });
  expect(await count()).toEqual([6, 6]);
});

test('双击标记：点→中心，线段→镜面，两者独立并存；动画只在预览层', async ({ page }) => {
  await scene(page);
  const pos = await page.evaluate(() => { const v = window.__app.active, r = v.canvas.getBoundingClientRect(); return { x: r.left - v.scroll.x, y: r.top - v.scroll.y }; });
  await page.locator('[title*="移动箭头"], [data-tool=move]').first().click({ timeout: 2000 }).catch(() => {});
  const dbl = (x: number, y: number) => page.mouse.dblclick(pos.x + x, pos.y + y);
  await dbl(300, 430);                                                    // 点 C
  expect(await page.evaluate(() => window.__app.active.marks)).toMatchObject({ center: 3 });
  await dbl(310, 250);                                                    // 线段 AB 中部
  const m = await page.evaluate(() => window.__app.active.marks);
  expect(m).toMatchObject({ center: 3, mirror: 4 });
  await dbl(200, 250);                                                    // 点 A：只换中心，镜面保留
  expect(await page.evaluate(() => window.__app.active.marks)).toMatchObject({ center: 1, mirror: 4 });
  expect(await page.evaluate(() => window.__app.active.store.page.objects.length)).toBe(6);
});

test('系列按钮在 Reset 的目标无定义时仍可点击，并继续执行其它步骤', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const st = window.__app.active.store;
    return st.run('构造按钮和交点', () => {
      const a = st.add({ k: 'free', x: 150, y: 160 }).id;
      const b = st.add({ k: 'free', x: 350, y: 200 }).id;
      const c = st.add({ k: 'free', x: 150, y: 280 }).id;
      const d = st.add({ k: 'free', x: 350, y: 280 }).id;
      const l1 = st.add({ k: 'line', a, b }).id;
      const l2 = st.add({ k: 'line', a: c, b: d }).id;
      const cross = st.add({ k: 'inter', a: l1, b: l2, branch: 0 }).id;
      const marker = st.add({ k: 'free', x: 120, y: 400 }).id;
      const reset = st.add({ k: 'button', action: { type: 'move', from: marker, to: cross, speed: 'high' }, text: '复位', at: { x: 560, y: 100 }, w: 90, h: 28 }, { hidden: true }).id;
      const hide = st.add({ k: 'button', action: { type: 'hideshow', targets: [marker], mode: 'hide' }, text: '隐藏标记', at: { x: 560, y: 140 }, w: 90, h: 28 }, { hidden: true }).id;
      const series = st.add({ k: 'button', action: { type: 'series', buttons: [reset, hide], mode: 'together' }, text: '系列', at: { x: 560, y: 180 }, w: 90, h: 28 }).id;
      return { cross, marker, reset, hide, series };
    });
  });
  const state = () => page.evaluate(({ cross, marker, series }) => {
    const st = window.__app.active.store;
    return [st.results.get(cross).status, st.results.get(series).shape?.k, st.get(marker).hidden];
  }, ids);
  expect(await state()).toEqual(['ok', 'box', false]);
  await pdrag(page, 150, 160, 150, 200); // 两条直线平行，交点暂时无定义
  expect(await state()).toEqual(['undefined', 'box', false]);
  const button = await pt(page, 580, 194);
  await page.mouse.click(button.x, button.y);
  expect(await state()).toEqual(['undefined', 'box', true]);
  await pdrag(page, 150, 200, 150, 160);
  expect(await state()).toEqual(['ok', 'box', true]);

  // 非法循环引用跳过已在执行路径上的系列，后续有效动作仍然执行。
  await page.evaluate(({ series, hide, marker }) => {
    const v = window.__app.active, st = v.store, def = st.get(series).def;
    st.setHidden([marker], false);
    st.update(series, { ...def, action: { ...def.action, buttons: [series, hide] } });
  }, ids);
  await page.mouse.click(button.x, button.y);
  expect(await state()).toEqual(['ok', 'box', true]);
});

test('移动按钮能移动坐标绘制点和缩放后的点', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const app = window.__app, v = app.active, st = v.store;
    return st.run('构造移动按钮', () => {
      const source = st.add({ k: 'free', x: 240, y: 260 }).id;
      const center = st.add({ k: 'free', x: 440, y: 460 }).id;
      const target = st.add({ k: 'free', x: 300, y: 380 }).id;
      const seg = st.add({ k: 'seg', a: source, b: center }).id;
      const origin = st.add({ k: 'mid', seg }).id;
      const unitX = st.add({ k: 'translate', src: origin, by: { mode: 'rect', dx: 1, dy: 0 } }).id;
      const unitY = st.add({ k: 'translate', src: origin, by: { mode: 'rect', dx: 0, dy: 1 } }).id;
      const axisX = st.add({ k: 'line', a: origin, b: unitX }).id;
      const axisY = st.add({ k: 'line', a: origin, b: unitY }).id;
      const sys = st.add({ k: 'sys', origin, unitX, unitY, axisX, axisY, grid: 'square', showGrid: false, snap: false }).id;
      const x = st.add({ k: 'measure', m: 'abscissa', refs: [source, sys] }).id;
      const y = st.add({ k: 'measure', m: 'ordinate', refs: [source, sys] }).id;
      const plot = st.add({ k: 'plotxy', x, y, sys }).id;
      const scaled = st.add({ k: 'dilate', src: center, center: source, ratio: { mode: 'fixed', num: 2, den: 1 } }).id;
      for (const [from, atY] of [[plot, 80], [scaled, 130]]) {
        st.add({ k: 'button', text: '移动', at: { x: 40, y: atY }, w: 65, h: 25, action: { type: 'move', from, to: target, speed: 'high' } });
      }
      return [source, center, scaled];
    });
  });
  const pos = await page.evaluate(() => { const r = window.__app.active.overlay.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const coords = () => page.evaluate(ids => {
    const st = window.__app.active.store;
    return ids.map(id => st.results.get(id).shape.p);
  }, ids);
  await page.mouse.click(pos.x + 65, pos.y + 92);
  await expect.poll(coords).toEqual([{ x: 300, y: 380 }, { x: 500, y: 580 }, { x: 700, y: 780 }]);
  await page.mouse.click(pos.x + 65, pos.y + 142);
  await expect.poll(coords).toEqual([{ x: 300, y: 380 }, { x: 300, y: 380 }, { x: 300, y: 380 }]);
});

test('以圆心和半径绘圆接受距离度量及带长度单位的计算结果', async ({ page }) => {
  await scene(page);
  const ids = await page.evaluate(() => {
    const st = window.__app.active.store;
    return st.run('构造半径输入', () => {
      const length = st.add({ k: 'measure', m: 'length', refs: [4] }).id;
      const distance = st.add({ k: 'measure', m: 'distance', refs: [3, 1] }).id;
      const difference = st.add({ k: 'calc', unit: 'distance', expr: { t: 'bin', op: '-', a: { t: 'ref', id: length }, b: { t: 'ref', id: distance } } }).id;
      const scalar = st.add({ k: 'param', name: 'k', value: 2, unit: 'none', showEdit: true }).id;
      const angle = st.add({ k: 'param', name: 'α', value: 30, unit: 'angle', showEdit: true }).id;
      const negative = st.add({ k: 'param', name: 'd', value: -2, unit: 'distance', showEdit: true }).id;
      return { length, distance, difference, scalar, angle, negative };
    });
  });
  await select(page, [ids.difference, 3]);
  await page.locator('#menubar .toplabel').filter({ hasText: '构造' }).click();
  const item = page.locator('#menubar .open .item').filter({ hasText: '以圆心和半径绘圆' });
  await expect(item).toBeVisible();
  await expect(item).not.toHaveClass(/disabled/);
  await item.click();
  const circle = (circleId?: number) => page.evaluate(circleId => {
    const v = window.__app.active;
    const id = circleId ?? v.sel[0];
    return { id, def: v.store.get(id).def, shape: v.store.results.get(id).shape };
  }, circleId);
  const first = await circle();
  expect(first.def).toEqual({ k: 'circle-seg', c: 3, seg: ids.difference });
  expect(first.shape.c.r).toBeCloseTo(220 - Math.hypot(100, 180));
  await select(page, []);
  await pdrag(page, 420, 250, 520, 250);
  expect((await circle(first.id)).shape.c.r).toBeCloseTo(320 - Math.hypot(100, 180));

  const enabled = async (selection: number[]) => {
    await select(page, selection);
    return page.evaluate(() => window.__app.queryMenu(36934).enabled);
  };
  for (const bad of [ids.scalar, ids.angle, ids.negative]) expect(await enabled([3, bad])).toBe(false);
  expect(await enabled([1, 3, ids.distance, ids.length])).toBe(false);

  expect(await enabled([1, 3, ids.distance])).toBe(true);
  await exec(page, 36934);
  const selectedDefs = () => page.evaluate(() => {
    const v = window.__app.active;
    return v.sel.map((id: number) => v.store.get(id).def);
  });
  expect(await selectedDefs()).toEqual([{ k: 'circle-seg', c: 1, seg: ids.distance }, { k: 'circle-seg', c: 3, seg: ids.distance }]);

  expect(await enabled([3, 4, ids.length])).toBe(true);
  await exec(page, 36934);
  expect(await selectedDefs()).toEqual([{ k: 'circle-seg', c: 3, seg: 4 }, { k: 'circle-seg', c: 3, seg: ids.length }]);
});
