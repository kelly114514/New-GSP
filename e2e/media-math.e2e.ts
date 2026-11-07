import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!(window as any).__app); });

test('导函数保留来源，修改原式后高阶导函数同步', async ({ page }) => {
  const values = await page.evaluate(async () => {
    const app = (window as any).__app, st = app.active.store;
    const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } });
    app.active.setSel([f.id]); await app.exec(36976);
    const derivative = st.page.objects.at(-1);
    st.update(f.id, { ...f.def, expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 3 } } }); st.recompute();
    const url = '/src/core/engine.ts', { evalFunction } = await import(/* @vite-ignore */ url);
    return { source: derivative.def.derivativeOf, f: f.id, value: evalFunction(st.page, st.results, derivative.id, 3) };
  });
  expect(values.source).toBe(values.f); expect(values.value).toBe(27);
});

test('图片函数读取像素并随源图片位置变化', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const app = (window as any).__app, st = app.active.store;
    const construct = '/src/core/construct.ts', engine = '/src/core/engine.ts';
    const { createSystem } = await import(/* @vite-ignore */ construct), { evalFunction } = await import(/* @vite-ignore */ engine);
    createSystem(st, { x: 100, y: 200 });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 9;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 9, 9); ctx.fillStyle = '#000'; for (let i = 0; i < 9; i++) ctx.fillRect(i, i, 1, 1);
    const cm = 96 / 2.54, image = st.add({ k: 'image', data: canvas.toDataURL().split(',')[1], mime: 'image/png', at: { x: 100, y: 200 - cm }, w: cm, h: cm });
    app.active.setSel([image.id]); await app.exec(36977);
    const func = st.page.objects.at(-1);
    const before = evalFunction(st.page, st.results, func.id, 0.5);
    st.update(image.id, { ...image.def, at: { x: 100, y: 200 - 2 * cm } }); st.recompute();
    return { type: func.def.k, before, after: evalFunction(st.page, st.results, func.id, 0.5) };
  });
  expect(result.type).toBe('picfunc'); expect(result.before).toBeCloseTo(0.5); expect(result.after).toBeCloseTo(1.5);
});

test('反射图片命令生成动态依赖，并保留多边形裁剪', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const app = (window as any).__app, st = app.active.store;
    const a = st.add({ k: 'free', x: 300, y: 100 }), b = st.add({ k: 'free', x: 300, y: 300 }), c = st.add({ k: 'free', x: 400, y: 200 });
    const mirror = st.add({ k: 'line', a: a.id, b: b.id }), clip = st.add({ k: 'poly', pts: [a.id, b.id, c.id] });
    const image = st.add({ k: 'image', data: 'test', mime: 'image/png', at: { x: 300, y: 100 }, w: 100, h: 200, clip: clip.id });
    app.active.marks.mirror = mirror.id; app.active.setSel([image.id]); await app.exec(36948);
    const reflected = st.page.objects.at(-1), shape = st.results.get(reflected.id)?.shape;
    return { kind: reflected.def.k, src: reflected.def.src, image: image.id, x: shape.image.corners[1].x, clip: shape.image.clip };
  });
  expect(result.kind).toBe('reflect'); expect(result.src).toBe(result.image); expect(result.x).toBe(200);
  expect(result.clip).toEqual([{ x: 300, y: 100 }, { x: 300, y: 300 }, { x: 200, y: 200 }]);
});
