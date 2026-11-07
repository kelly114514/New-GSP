import { describe, it, expect } from 'vitest';
import { Store } from '../src/core/store';
import { evalFunction } from '../src/core/engine';
import { imageCorners } from '../src/core/image';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { bitmapProfile } from '../src/core/bitmap-profile';
import { hitAll } from '../src/core/hit';
import { rotateBy, reflectBy, translateBy } from '../src/core/construct';

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
 it('位图列取样忽略白色与透明像素，保留分断', () => {
  const rgba = new Uint8ClampedArray(4 * 3 * 4).fill(255);
  for (const [x,y] of [[0,0],[1,1],[3,2]]) { const i=(y*4+x)*4; rgba[i]=0;rgba[i+1]=0;rgba[i+2]=0; }
  expect(bitmapProfile(rgba,4,3)).toEqual([[{x:0,y:0},{x:1/3,y:0.5}],[{x:1,y:1}]]);
 });
 it('归一化仿射矩阵保留方向及负尺度', () => {
  expect(imageCorners({ at: { x: 0, y: 0 }, w: 1, h: 1, affine: [0, -30, 100, 40, 0, 30] })).toEqual([{ x: 100, y: 30 }, { x: 100, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 30 }]);
 });
});
