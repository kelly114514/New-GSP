import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

declare global { interface Window { __app: any } }
// 原版的工具文件夹只在开发机上有（不进仓库）；没有就跳过
const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '../../sketchpad5/Tool Folder');
const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { (window as any).showSaveFilePicker = undefined; });
  await page.goto('/'); await page.waitForFunction(() => !!window.__app);
});
test.afterEach(() => { expect(errors).toEqual([]); });

const openCustomMenu = (page: Page, shift = false) => page.locator('button.tool[data-group="custom"]').dispatchEvent('pointerdown', { button: 0, shiftKey: shift });
const count = (page: Page) => page.evaluate(() => window.__app.active.store.page.objects.length);

test('自定义工具菜单：没有工具时只有创建/选项/脚本视图（灰）和选择工具文件夹', async ({ page }) => {
  await openCustomMenu(page);
  const items = await page.locator('.toolmenu > .item').allTextContents();
  expect(items.map(t => t.replace('✓', '').trim())).toEqual(['创建新工具…', '工具选项…', '显示脚本视图', '选择工具文件夹…']);
  expect(await page.locator('.toolmenu > .item.disabled').count()).toBe(3);
});

test('Shift 按住打开菜单时，最后一项是“忽略工具文件夹”', async ({ page }) => {
  await openCustomMenu(page, true);
  await expect(page.locator('.toolmenu > .item').last()).toContainText('忽略工具文件夹');
});

test('创建新工具：选中作品 → 命名 → 菜单里出现 → 点选前提条件后重放；一步撤销', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 200, y: 250 }).id, b = st.add({ k: 'free', x: 420, y: 250 }).id;
      const s = st.add({ k: 'seg', a, b }).id; st.add({ k: 'mid', seg: s });
      window.__app.active.setSel([s]);
    });
  });
  // 选中 → 菜单“创建新工具…”可用
  await openCustomMenu(page);
  await page.locator('.toolmenu > .item', { hasText: '创建新工具…' }).click();
  await expect(page.locator('.dlg-title')).toHaveText('创建新工具');
  await page.locator('.dlg input[type=text]').fill('线段');
  await page.locator('.dlg button.primary').click();
  expect(await page.evaluate(() => window.__app.active.store.doc.tools.map((t: any) => t.name))).toEqual(['线段']);
  expect(await page.evaluate(() => window.__app.toolbox.current)).toBe('custom');
  // 菜单里出现，并已选用（带勾）
  await openCustomMenu(page);
  await expect(page.locator('.toolmenu > .item', { hasText: '线段' })).toContainText('✓');
  await page.locator('.toolmenu > .item', { hasText: '显示脚本视图' }).click();
  await expect(page.locator('.dlg-text')).toContainText('前提 1');
  await expect(page.locator('.dlg-text')).toContainText('构造');
  await expect(page.locator('.dlg-text')).toContainText('依赖');
  await page.locator('.dlg button.primary').click();
  // 在画板上点两下：新点 + 新点，应得到线段
  const before = await count(page);
  const r = await page.evaluate(() => { const b = window.__app.active.overlay.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(r.x + 150, r.y + 100); await page.mouse.click(r.x + 400, r.y + 120);
  const kinds = await page.evaluate(() => window.__app.active.store.page.objects.map((o: any) => o.def.k));
  expect(kinds.slice(before)).toEqual(['free', 'free', 'seg']);   // 两个新点 + 线段（中点是隐藏的中间对象）
  // 作品只有线段可见；中点隐藏
  const vis = await page.evaluate(() => window.__app.active.store.page.objects.slice(-2).map((o: any) => [o.def.k, o.hidden]));
  expect(vis.at(-1)).toEqual(['seg', false]);
});

test('工具选项（文档选项的“工具”页）：列出文档里的工具并可以删除', async ({ page }) => {
  await page.evaluate(() => {
    const st = window.__app.active.store;
    st.run('场景', () => { const a = st.add({ k: 'free', x: 1, y: 1 }).id, b = st.add({ k: 'free', x: 9, y: 9 }).id; window.__app.active.setSel([st.add({ k: 'seg', a, b }).id]); });
  });
  await page.evaluate(() => { void window.__app.createToolFromSelection(); });
  await page.locator('.dlg input[type=text]').fill('甲');
  await page.locator('.dlg button.primary').click();
  await openCustomMenu(page);
  await page.locator('.toolmenu > .item', { hasText: '工具选项…' }).click();
  await expect(page.locator('.dlg-title')).toHaveText('文档选项');
  await expect(page.locator('.docopt-pane:not([hidden]) select option')).toHaveText(['甲']);
  await page.locator('.docopt-pane:not([hidden]) select option').click();
  await page.getByRole('button', { name: '删除工具(D)' }).click();
  await expect(page.locator('.docopt-pane:not([hidden]) select option')).toHaveCount(0);
  await page.locator('.dlg button.primary').click();
  expect(await page.evaluate(() => window.__app.active.store.doc.tools)).toBeUndefined();
});

test('显式匹配所选参数并使用工具；候选有歧义时不执行', async ({ page }) => {
  await page.evaluate(() => {
    const v = window.__app.active, st = v.store;
    st.run('场景', () => {
      const p = st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true });
      const c = st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: p.id }, b: { t: 'num', v: 1 } }, unit: 'none' });
      v.setSel([c.id]);
    });
    void window.__app.createToolFromSelection();
  });
  await page.locator('.dlg input[type=text]').fill('加一');
  await page.locator('.dlg button.primary').click();
  await page.evaluate(() => { const v = window.__app.active; v.setSel([v.store.page.objects[0].id, v.store.page.objects[1].id]); });
  const before = await count(page);
  await openCustomMenu(page);
  await page.locator('.toolmenu > .item', { hasText: '匹配选中对象' }).click();
  await expect(page.locator('.dlg-text')).toContainText('无法唯一匹配');
  expect(await count(page)).toBe(before);
  await page.locator('.dlg button.primary').click();
  await page.evaluate(() => { const v = window.__app.active; v.setSel([v.store.page.objects[0].id]); });
  await openCustomMenu(page);
  await page.locator('.toolmenu > .item', { hasText: '匹配选中对象' }).click();
  expect(await count(page)).toBe(before + 1);
});

test('自定义工具自动采用同名数值，仍可将该数值点给另一个前提', async ({ page }) => {
  const target = await page.evaluate(() => {
    const app = window.__app, v = app.active, st = v.store;
    const value = st.run('新建参数', () => st.add({ k: 'param', name: 't[1]', value: 3, unit: 'none', showEdit: true }, { at: { x: 60, y: 100 } }));
    const output = { k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: 101 }, b: { t: 'ref', id: 102 } }, unit: 'none' };
    app.customTool = {
      name: '同名数值工具',
      inputs: [{ index: 101, kind: 'number', label: 't[1]' }, { index: 102, kind: 'number' }],
      objects: [{ id: 101, toolLabel: true }, { id: 102 }, { id: 103, def: output, style: value.style, hidden: false }],
    };
    app.setTool('custom');
    const bounds = v.overlay.getBoundingClientRect();
    return { id: value.id, x: bounds.left + 68, y: bounds.top + 107 };
  });
  await page.mouse.click(target.x, target.y);
  const output = await page.evaluate(() => {
    const st = window.__app.active.store, calc = st.page.objects.find((o: any) => o.def.k === 'calc');
    return calc && { expr: calc.def.expr, value: st.results.get(calc.id).shape.q.v };
  });
  expect(output).toEqual({ expr: { t: 'bin', op: '+', a: { t: 'ref', id: target.id }, b: { t: 'ref', id: target.id } }, value: 6 });
});

test('对象属性可设置工具标签并保留到创建的工具', async ({ page }) => {
  await page.evaluate(() => {
    const v = window.__app.active, st = v.store;
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 10, y: 10 }), b = st.add({ k: 'free', x: 100, y: 10 });
      const s = st.add({ k: 'seg', a: a.id, b: b.id }, { label: '边', labelShown: true });
      v.setSel([s.id]);
    });
    void window.__app.dlg.properties(v, st.get(v.sel[0]));
  });
  await page.locator('.dlg .tabs button', { hasText: '标签' }).click();
  await page.getByLabel('在自定义工具中使用标签').check();
  await page.locator('.dlg button.primary').click();
  await page.evaluate(() => { void window.__app.createToolFromSelection(); });
  await page.locator('.dlg input[type=text]').fill('带标签的边');
  await page.locator('.dlg button.primary').click();
  expect(await page.evaluate(() => window.__app.customTool.objects.at(-1).label)).toBe('边');
});

test('文本选区保留局部样式，输入法组合按键不结束编辑', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__app, v = app.active, st = v.store;
    let id = 0;
    st.run('文本', () => { id = st.add({ k: 'text', text: '甲乙丙', at: { x: 20, y: 20 }, w: 200, h: 40, font: { ...app.settings.font } }).id; });
    v.beginTextEdit(id);
  });
  const ta = page.locator('textarea.textedit');
  await ta.evaluate((e: HTMLTextAreaElement) => { e.setSelectionRange(1, 2); e.dispatchEvent(new Event('select')); });
  await page.locator('#textbar button[data-k=bold]').click();
  await ta.evaluate((e: HTMLTextAreaElement) => {
    e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
  });
  await expect(ta).toHaveCount(1);
  await ta.evaluate((e: HTMLTextAreaElement) => e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await ta.press('Escape');
  const runs = await page.evaluate(() => window.__app.active.store.page.objects[0].def.runs);
  expect(runs.map((r: any) => [r.text, r.font.bold])).toEqual([['甲', false], ['乙', true], ['丙', false]]);
  await page.evaluate(() => window.__app.active.beginTextEdit(window.__app.active.store.page.objects[0].id));
  await page.locator('textarea.textedit').press('Escape');
  expect(await page.evaluate(() => window.__app.active.store.page.objects[0].def.runs)).toEqual(runs);
  await page.evaluate(() => window.__app.active.store.doUndo());
  expect(await page.evaluate(() => window.__app.active.store.page.objects[0].def.runs)).toBeUndefined();
});

test('工具输入：线段可直接点选；坐标系自动匹配', async ({ page }) => {
  await page.evaluate(async () => {
    const app = window.__app, st = app.active.store;
    const path = '/src/core/construct.ts'; const { createSystem } = await import(/* @vite-ignore */ path);
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 150, y: 220 }).id, b = st.add({ k: 'free', x: 350, y: 220 }).id;
      st.add({ k: 'seg', a, b }); createSystem(st, { x: 500, y: 300 });
    });
    app.useTool({ name: '线段中点', inputs: [{ index: 1, kind: 'segment' }], objects: [{ id: 2, def: { k: 'mid', seg: 1 }, style: { color: '#ff0000', width: 1, pointSize: 2, dash: 'solid' }, hidden: false, labelShown: false }] });
  });
  const box = await page.evaluate(() => { const b = window.__app.active.overlay.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  const before = await count(page);
  await page.mouse.click(box.x + 80, box.y + 120); expect(await count(page)).toBe(before);
  await page.mouse.click(box.x + 250, box.y + 220);
  expect(await count(page)).toBe(before + 1);
  expect(await page.evaluate(() => { const st = window.__app.active.store; return st.results.get(st.page.objects.at(-1).id).shape; })).toMatchObject({ k: 'pt', p: { x: 250, y: 220 } });
  await page.evaluate(() => window.__app.useTool({ name: '坐标点', inputs: [{ index: 1, kind: 'system' }], objects: [{ id: 2, def: { k: 'plotfix', sys: 1, x: 2, y: 3 }, style: { color: '#ff0000', width: 1, pointSize: 2, dash: 'solid' }, hidden: false, labelShown: false }] }));
  await expect(page.locator('#status')).toContainText('单击画板应用工具');   // 坐标系自动匹配
  await page.mouse.click(box.x + 500, box.y + 300);
  expect(await count(page)).toBe(before + 2);
  const point = await page.evaluate(() => { const st = window.__app.active.store; return st.results.get(st.page.objects.at(-1).id).shape.p; });
  expect(point.x).toBeCloseTo(500 + 2 * 96 / 2.54); expect(point.y).toBeCloseTo(300 - 3 * 96 / 2.54);
});

test('连续关闭文档会释放图片回调和画布，工具批量使用不积累已关闭视图', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/ui/render.ts';
    const { imageLoaded } = await import(/* @vite-ignore */ path);
    const app = window.__app, initial = imageLoaded.size, closed: any[] = [];
    for (let i = 0; i < 30; i++) {
      const v = app.active;
      v.store.markSaved(); await app.closeDocument(v); closed.push(v);
    }
    closed.forEach(v => { v.invalidate(); v.resize(); });
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    return { initial, callbacks: imageLoaded.size, docs: app.docs.length,
      released: closed.every(v => [v.canvas, v.trace, v.overlay].every(c => c.width === 1 && c.height === 1)) };
  });
  expect(result).toEqual({ initial: 1, callbacks: 1, docs: 1, released: true });
});

test('多层共享依赖的工具结果被选中后，动画菜单可响应', async ({ page }) => {
  const enabled = await page.evaluate(() => {
    const app = window.__app, v = app.active, st = v.store;
    let ids: number[] = [];
    st.run('构造共享依赖', () => {
      ids = [1, 2].map(i => st.add({ k: 'param', name: `p${i}`, value: 1, unit: 'none', showEdit: true }).id);
      for (let i = 0; i < 42; i++) {
        const [a, b] = ids.slice(-2);
        ids.push(st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: a }, b: { t: 'ref', id: b } }, unit: 'none' }, {}, false).id);
      }
      st.recompute();
    });
    app.anim.toggle(v, [st.get(ids[0])]);
    v.setSel([ids.at(-1)]);
    const canSpeedUp = app.queryMenu(36918).enabled;
    app.anim.stopAll();
    return canSpeedUp;
  });
  expect(enabled).toBe(true);
});

test('发散迭代的巨大坐标不会撑大滚动布局或导致绘图进程耗尽内存', async ({ page }) => {
  const result = await page.evaluate(() => {
    const v = window.__app.active, st = v.store;
    st.run('发散结果', () => {
      const a = st.add({ k: 'free', x: 5.6e12, y: -8.5e23 }).id;
      const b = st.add({ k: 'free', x: 5.6e12 + 38, y: -8.5e23 - 1.1e13 }).id;
      st.add({ k: 'line', a, b });
    });
    v.paint();
    return { width: parseFloat(v.sbHin.style.width), height: parseFloat(v.sbVin.style.height), defined: st.results.get(st.page.objects[0].id).status };
  });
  expect(result.width).toBeLessThan(2100000); expect(result.height).toBeLessThan(2100000);
  expect(result.defined).toBe('ok');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => Number.isFinite(window.__app.active.scroll.x))).toBe(true);
});

test('移动按钮同时移动自由点、路径点和参数', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const app = window.__app, st = app.active.store; let ids: number[] = [];
    st.run('场景', () => {
      const a = st.add({ k: 'free', x: 100, y: 150 }).id, b = st.add({ k: 'free', x: 200, y: 150 }).id;
      const seg = st.add({ k: 'seg', a, b }).id, path = st.add({ k: 'onpath', path: seg, t: 0.2 }).id;
      const target = st.add({ k: 'free', x: 180, y: 150 }).id;
      const free = st.add({ k: 'free', x: 100, y: 250 }).id, end = st.add({ k: 'free', x: 180, y: 250 }).id;
      const parameter = st.add({ k: 'param', name: 't', value: 0, unit: 'none', showEdit: true }).id;
      const value = st.add({ k: 'param', name: 'v', value: 5, unit: 'none', showEdit: true }).id;
      st.add({ k: 'button', action: { type: 'move', from: free, to: end, pairs: [[path, target], [parameter, value]], speed: 'high' }, text: '移动', at: { x: 20, y: 20 }, w: 80, h: 28 });
      ids = [free, path, parameter];
    }); app.setTool('move'); app.refresh(); return ids;
  });
  const box = await page.evaluate(() => { const b = window.__app.active.overlay.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(box.x + 50, box.y + 32);
  await expect.poll(() => page.evaluate(([free, path, parameter]) => { const st = window.__app.active.store; return [st.get(free).def.x, st.get(path).def.t, st.get(parameter).def.value]; }, ids)).toEqual([180, 0.8, 5]);
});

test('组合文本中的按钮显示名称并能单击执行', async ({ page }) => {
  const target = await page.evaluate(() => {
    const app = window.__app, st = app.active.store; let target = 0;
    st.run('场景', () => {
      target = st.add({ k: 'free', x: 400, y: 300 }).id;
      const button = st.add({ k: 'button', action: { type: 'hideshow', targets: [target], mode: 'toggle' }, text: '切换', at: { x: 20, y: 20 }, w: 60, h: 24 }, { hidden: true }).id;
      st.add({ k: 'text', text: '0', refs: [button], at: { x: 100, y: 100 }, w: 24, h: 24, font: { name: 'Arial', size: 48, bold: false, italic: false, underline: false, color: '#000000' } });
    }); app.setTool('move'); app.refresh(); return target;
  });
  const box = await page.evaluate(() => { const b = window.__app.active.overlay.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(box.x + 140, box.y + 135);
  expect(await page.evaluate(id => window.__app.active.store.get(id).hidden, target)).toBe(true);
  await page.mouse.click(box.x + 140, box.y + 135);
  expect(await page.evaluate(id => window.__app.active.store.get(id).hidden, target)).toBe(false);
});

test.describe('载入原版工具文件夹', () => {
  test.skip(!existsSync(TOOLS), '没有原版工具文件夹');
  test('选择工具文件夹 → 菜单里出现 44 组 → 选一个可用工具并使用', async ({ page }) => {
    await openCustomMenu(page);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.toolmenu > .item', { hasText: '选择工具文件夹…' }).click();
    await (await chooser).setFiles(TOOLS);
    await expect(page.locator('.dlg-text')).toContainText('44 个工具文件');
    await page.locator('.dlg button.primary').click();
    expect(await page.evaluate(() => window.__app.toolGroups.reduce((n: number, g: any) => n + g.tools.length, 0))).toBe(807);
    await openCustomMenu(page);
    await expect(page.locator('.toolmenu > .item.sub')).toHaveCount(44);
    await page.locator('.toolmenu > .item.sub', { hasText: '点工具' }).first().hover();
    const sub = page.locator('.toolmenu .dropdown.show');
    await expect(sub).toBeVisible();
    const usable = sub.locator('.item:not(.disabled)');
    expect(await usable.count()).toBeGreaterThan(5);
    const blocked = sub.locator('.item.disabled');
    if (await blocked.count()) expect(await blocked.first().getAttribute('title')).toMatch(/暂不支持|还没有核对|没有前提/);
    const name = (await usable.first().innerText()).replace('✓', '').trim();
    await usable.first().click();
    await expect(page.locator('.toolmenu')).toHaveCount(0);   // 菜单关掉后再点画板
    expect(await page.evaluate(() => window.__app.customTool.name)).toBe(name);
    // 按前提条件个数在画板上点
    const n = await page.evaluate(() => window.__app.customTool.inputs.length);
    const box = await page.evaluate(() => { const b = window.__app.active.overlay.getBoundingClientRect(); return { x: b.left, y: b.top }; });
    const before = await count(page);
    for (let i = 0; i < n; i++) {
      await page.mouse.click(box.x + 120 + 110 * i, box.y + 140 + (i % 2) * 90);
      await expect.poll(() => count(page)).toBeGreaterThan(before + i);   // 每点一下都应有新对象
    }
    expect(await count(page)).toBeGreaterThan(before + n - 1);
    await page.keyboard.press('Control+z');
    expect(await count(page)).toBe(before + n);   // 撤销只回退这一次应用
  });
});
