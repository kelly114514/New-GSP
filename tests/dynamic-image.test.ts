import { describe, it, expect } from 'vitest';
import { encode } from 'fast-png';
import { Store } from '../src/core/store';
import { evalFunction } from '../src/core/engine';
import { imageCorners } from '../src/core/image';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { hitAll } from '../src/core/hit';
import { createSystem, rotateBy, reflectBy, translateBy } from '../src/core/construct';

const image = (st: Store) => st.add({ k: 'image', data: 'test', mime: 'image/png', at: { x: 100, y: 100 }, w: 80, h: 40 });
describe('动态导函数与图片', () => {
 it('修改原函数后各阶导数及数值立即变化，删除来源无定义', () => {
  const st = new Store();
  const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } });
  const d = st.add({ k: 'func', name: "f'", param: 'x', derivativeOf: f.id, expr: { t: 'num', v: 0 } });
  const d2 = st.add({ k: 'func', name: "f''", param: 'x', derivativeOf: d.id, expr: { t: 'num', v: 0 } });
  expect(evalFunction(st.page, st.results, d.id, 3)).toBe(6);
  st.update(f.id, { ...f.def as Extract<typeof f.def, { k: 'func' }>, expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 3 } } });
  st.recompute();
  expect(evalFunction(st.page, st.results, d.id, 3)).toBe(27);
  expect(evalFunction(st.page, st.results, d2.id, 3)).toBe(18);
  expect(encodeFile(st.doc, undefined).ok).toBe(false);
  expect(decodeFile(encodeNgsp(st.doc), 'x.ngsp').doc.pages[0].objects[1].def).toMatchObject({ derivativeOf: f.id });
  st.page.objects = st.page.objects.filter(o => o.id !== f.id); st.recompute();
  expect(evalFunction(st.page, st.results, d.id, 3)).toBeUndefined();
 });
 it('互相递归的用户函数不导致栈溢出', () => {
  const st = new Store();
  st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'call', func: 2, a: { t: 'x' } } });
  st.add({ k: 'func', name: 'g', param: 'x', expr: { t: 'call', func: 1, a: { t: 'x' } } });
  expect(evalFunction(st.page, st.results, 1, 3)).toBeUndefined();
 });
 it('图片旋转、反射、平移保留四角及裁剪，命中使用真实轮廓', () => {
  const st = new Store(), im = image(st);
  const center = st.add({ k: 'free', x: 100, y: 100 });
  const rotated = rotateBy(st, [im.id], center.id, { mode: 'fixed', deg: 45 }).at(-1)!;
  st.recompute();
  const shape = st.results.get(rotated.id)?.shape;
  if (shape?.k !== 'box' || !shape.image) throw Error('图片无定义');
  expect(shape.image.corners[1].x).toBeCloseTo(100 + 80 / Math.sqrt(2));
  expect(shape.image.corners[1].y).toBeCloseTo(100 - 80 / Math.sqrt(2));
  expect(hitAll(st.page, st.results, { x: shape.at.x + 1, y: shape.at.y + 1 }, 'low')).not.toContain(rotated.id);
  const a = st.add({ k: 'free', x: 0, y: 0 }), b = st.add({ k: 'free', x: 0, y: 200 });
  const mirror = st.add({ k: 'line', a: a.id, b: b.id });
  const reflected = reflectBy(st, [im.id], mirror.id).at(-1)!;
  const moved = translateBy(st, [reflected.id], { mode: 'rect', dx: 1, dy: 0 }).at(-1)!;
  st.recompute();
  const r = st.results.get(reflected.id)?.shape, m = st.results.get(moved.id)?.shape;
  expect(r?.k === 'box' && r.image?.corners[0].x).toBe(-100);
  expect(m?.k === 'box' && m.image?.corners[0].x).toBeCloseTo(-100 + 96 / 2.54);
  expect(decodeFile(encodeNgsp(st.doc), 'x.ngsp').doc).toEqual(st.doc);
 });
 it('原版图片函数读写保留白色、透明空列、取高阈值和旋转后的上边界', () => {
  const st = new Store(), sys = createSystem(st, { x: 0, y: 0 });
  const width = 12, height = 8, rgba = new Uint8Array(width * height * 4);
  const paint = (left: number, right: number, top: number, bottom: number, alpha: number) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) rgba.set([255, 255, 255, alpha], (y * width + x) * 4);
  };
  paint(1, 4, 0, 1, 191);
  paint(1, 4, 3, 6, 255);
  paint(7, 11, 1, 2, 192);
  paint(7, 11, 4, 6, 255);
  const data = Buffer.from(encode({ width, height, data: rgba, channels: 4 })).toString('base64');
  const image = st.add({ k: 'image', data, mime: 'image/png', at: { x: 100, y: 100 }, w: 48, h: 32 });
  const func = st.add({ k: 'picfunc', stroke: image.id, sys: sys.id, height: true }, { at: { x: 10, y: 5 }, label: 'f' });
  const saved = encodeFile(st.doc, undefined);
  if (!saved.ok) throw new Error(saved.reason);
  const opened = new Store(decodeFile(saved.bytes, '图片高度.gsp').doc);
  const unit = 96 / 2.54;
  const heightAt = (x: number) => {
    const y = evalFunction(opened.page, opened.results, func.id, x / unit);
    return y === undefined ? undefined : -y * unit;
  };
  expect(opened.get(func.id)?.def).toMatchObject({ height: true, stroke: image.id, sys: sys.id });
  expect(heightAt(114)).toBeCloseTo(118);
  expect(heightAt(124)).toBeUndefined();
  expect(heightAt(138)).toBeCloseTo(110);
  if (image.def.k !== 'image') throw new Error('图片缺失');
  opened.update(image.id, { ...image.def, affine: [-48, 0, 148, 0, -32, 132] });
  opened.recompute();
  expect(heightAt(110)).toBeCloseTo(106);
  expect(heightAt(134)).toBeCloseTo(106);
 });
 it('旧新版课件继续使用已保存的笔迹取样', () => {
  const st = new Store(), sys = createSystem(st, { x: 100, y: 200 });
  const source = image(st);
  const func = st.add({ k: 'picfunc', stroke: source.id, sys: sys.id, profile: [[{ x: 0, y: 0.75 }, { x: 1, y: 0.75 }]] });
  const opened = new Store(decodeFile(encodeNgsp(st.doc), '旧笔迹.ngsp').doc);
  expect(evalFunction(opened.page, opened.results, func.id, 1)).toBeCloseTo(70 / (96 / 2.54));
 });
 it('归一化仿射矩阵保留方向及负尺度', () => {
  expect(imageCorners({ at: { x: 0, y: 0 }, w: 1, h: 1, affine: [0, -30, 100, 40, 0, 30] })).toEqual([{ x: 100, y: 30 }, { x: 100, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 30 }]);
 });
});
