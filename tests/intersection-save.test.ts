import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { decodeGsp, encodeFile } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';
import { createSystem } from '../src/core/construct';

function fixture() {
  const st = new Store();
  const p = [[100, 100], [300, 100], [300, 300], [100, 300], [150, 150], [250, 150]]
    .map(([x, y]) => st.add({ k: 'free', x, y }).id);
  const poly = st.add({ k: 'poly', pts: p.slice(0, 4) }).id;
  const ray = st.add({ k: 'ray', a: p[4], b: p[5] }).id;
  const hit = st.add({ k: 'inter', a: ray, b: poly, branch: 0 }).id;
  return { st, hit };
}

describe('射线与多边形边界交点保存', () => {
  it('方法 93 按射线、多边形次序写出，读回后可继续动态求值', () => {
    const { st, hit } = fixture();
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw Error(encoded.reason);
    const hdr = readRecords(encoded.bytes).records.filter(r => r.tag === 2000).at(-1)!;
    expect(new DataView(hdr.data.buffer, hdr.data.byteOffset, hdr.data.byteLength).getUint16(0, true)).toBe(93);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    expect(reopened.get(hit)?.def).toEqual(st.get(hit)?.def);
    expect(reopened.results.get(hit)?.shape).toEqual({ k: 'pt', p: { x: 300, y: 150 } });
    st.moveFree(6, 250, 190); reopened.moveFree(6, 250, 190);
    expect(reopened.results.get(hit)?.shape).toEqual(st.results.get(hit)?.shape);
  });

  it('多边形在前的顺序不能直接写为方法 93', () => {
    const { st, hit } = fixture();
    st.update(hit, { k: 'inter', a: 7, b: 8, branch: 0 });
    expect(st.results.get(hit)?.shape?.k).toBe('pt');
    expect(encodeFile(st.doc, undefined).ok).toBe(false);
  });

  const dir = join('..', 'reference', 'raw', 'runtime', 'interop-evidence');
  const source = join(dir, 'ray-polygon.gsp'), original = join(dir, 'ray-polygon-resaved.gsp');
  it.skipIf(!existsSync(source) || !existsSync(original))('自制样本经原版打开另存后交点定义一致', () => {
    const before = decodeGsp(readFileSync(source)).doc.pages[0].objects;
    const after = decodeGsp(readFileSync(original)).doc.pages[0].objects;
    expect(before).toHaveLength(9);
    expect(after.map(o => o.def)).toEqual(before.map(o => o.def));
  });
});

describe('直线或圆与采样曲线交点保存', () => {
  it('直线反向时函数图像交点反向编号，超出的分支落在最后一点', () => {
    const st = new Store(), sys = createSystem(st, { x: 350, y: 290 }).id;
    const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } }).id;
    const plot = st.add({ k: 'plot', func: f, sys, lo: -3, hi: 3, samples: 200 }).id;
    const left = st.add({ k: 'free', x: 200, y: 250 }).id, right = st.add({ k: 'free', x: 500, y: 250 }).id;
    const line = st.add({ k: 'line', a: right, b: left }).id;
    const hits = [0, 1, 2].map(branch => st.add({ k: 'inter', a: line, b: plot, branch }).id);
    const x = (id: number) => {
      const shape = st.results.get(id)?.shape;
      return shape?.k === 'pt' ? shape.p.x : NaN;
    };
    expect(x(hits[0])).toBeCloseTo(388.9, 0);
    expect(x(hits[1])).toBeCloseTo(311.1, 0);
    expect(x(hits[2])).toBe(x(hits[1]));
    st.update(line, { k: 'line', a: left, b: right });
    expect(x(hits[0])).toBeCloseTo(311.1, 0);
    expect(x(hits[1])).toBeCloseTo(388.9, 0);
  });

  it('同坐标系下两条函数图像按第一条采样方向排列交点并可写出', () => {
    const st = new Store(), sys = createSystem(st).id;
    const square = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '-', a: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } }, b: { t: 'num', v: 1 } } }, { at: { x: 20, y: 30 } }).id;
    const zero = st.add({ k: 'func', name: 'g', param: 'x', expr: { t: 'num', v: 0 } }, { at: { x: 20, y: 60 } }).id;
    const a = st.add({ k: 'plot', func: square, sys, lo: -15.74, hi: 15.74, samples: 300 }).id;
    const b = st.add({ k: 'plot', func: zero, sys, lo: -15.74, hi: 15.74, samples: 300 }).id;
    const hits = [0, 1].map(branch => st.add({ k: 'inter', a, b, branch }).id);
    for (const [index, id] of hits.entries()) {
      const shape = st.results.get(id)?.shape;
      expect(shape?.k).toBe('pt');
      if (shape?.k === 'pt') {
        expect(shape.p.x).toBeCloseTo(index === 0 ? 362.2 : 437.8, 0);
        expect(shape.p.y).toBeCloseTo(304, 8);
      }
    }
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw Error(encoded.reason);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    for (const id of hits) {
      expect(reopened.get(id)?.def).toEqual(st.get(id)?.def);
      expect(reopened.results.get(id)?.shape).toEqual(st.results.get(id)?.shape);
    }
    st.update(square, { k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '-', a: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } }, b: { t: 'num', v: 0.25 } } });
    for (const [index, id] of hits.entries()) {
      const shape = st.results.get(id)?.shape;
      expect(shape?.k).toBe('pt');
      if (shape?.k === 'pt') expect(shape.p.x).toBeCloseTo(index === 0 ? 381.1 : 418.9, 0);
    }
  });

  it('圆与轨迹的两个交点按方法 98 写出并读回', () => {
    const st = new Store();
    const a = st.add({ k: 'free', x: 100, y: 200 }).id, b = st.add({ k: 'free', x: 300, y: 200 }).id;
    const path = st.add({ k: 'seg', a, b }).id, driver = st.add({ k: 'onpath', path, t: 0.5 }).id;
    const moving = st.add({ k: 'seg', a: driver, b: a }).id, midpoint = st.add({ k: 'mid', seg: moving }).id;
    const locus = st.add({ k: 'locus', driver, out: midpoint, samples: 40 }).id;
    const center = st.add({ k: 'free', x: 150, y: 200 }).id, rim = st.add({ k: 'free', x: 175, y: 200 }).id;
    const circle = st.add({ k: 'circle', c: center, p: rim }).id;
    const hits = [0, 1].map(branch => st.add({ k: 'inter', a: circle, b: locus, branch }).id);
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw Error(encoded.reason);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    for (const id of hits) {
      expect(reopened.get(id)?.def).toEqual(st.get(id)?.def);
      expect(reopened.results.get(id)?.shape).toEqual(st.results.get(id)?.shape);
      expect(reopened.results.get(id)?.shape?.k).toBe('pt');
    }
    // 原版方法 98 要求圆型或直线型在曲线前；反序不能悄悄改动父对象顺序。
    st.update(hits[0], { k: 'inter', a: locus, b: circle, branch: 0 });
    expect(encodeFile(st.doc, undefined).ok).toBe(false);
  });

  it('直线与参数曲线的交点按方法 98 写出并读回', () => {
    const st = new Store(), sys = createSystem(st).id;
    const fx = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 20, y: 30 } }).id;
    const fy = st.add({ k: 'func', name: 'g', param: 'x', expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } }, { at: { x: 20, y: 60 } }).id;
    const curve = st.add({ k: 'pcurve', fx, fy, sys, lo: -2, hi: 2, polar: false, samples: 40 }).id;
    const a = st.add({ k: 'free', x: 420, y: 100 }).id, b = st.add({ k: 'free', x: 420, y: 400 }).id;
    const line = st.add({ k: 'line', a, b }).id, hit = st.add({ k: 'inter', a: line, b: curve, branch: 0 }).id;
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw Error(encoded.reason);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    expect(reopened.get(hit)?.def).toEqual(st.get(hit)?.def);
    expect(reopened.results.get(hit)?.shape).toEqual(st.results.get(hit)?.shape);
    expect(reopened.results.get(hit)?.shape?.k).toBe('pt');
  });

  const dir = join('..', 'reference', 'raw', 'runtime', 'interop-evidence');
  const source = join(dir, 'path-intersections.gsp'), original = join(dir, 'path-intersections-resaved.gsp');
  it.skipIf(!existsSync(source) || !existsSync(original))('圆与轨迹、直线与参数曲线样本经原版另存后定义和求值一致', () => {
    const before = new Store(decodeGsp(readFileSync(source)).doc), after = new Store(decodeGsp(readFileSync(original)).doc);
    expect(before.page.objects).toHaveLength(25);
    expect(after.page.objects.map(o => o.def)).toEqual(before.page.objects.map(o => o.def));
    for (const id of [11, 12, 25]) {
      expect(after.results.get(id)).toEqual(before.results.get(id));
      expect(after.results.get(id)?.shape?.k).toBe('pt');
    }
  });
  const plots = join(dir, 'plot-intersections.gsp'), plotsOriginal = join(dir, 'plot-intersections-resaved.gsp');
  it.skipIf(!existsSync(plots) || !existsSync(plotsOriginal))('两函数图像样本经原版另存后定义及交点求值一致', () => {
    const before = new Store(decodeGsp(readFileSync(plots)).doc), after = new Store(decodeGsp(readFileSync(plotsOriginal)).doc);
    expect(before.page.objects).toHaveLength(15);
    expect(after.page.objects.map(o => o.def)).toEqual(before.page.objects.map(o => o.def));
    for (const id of [14, 15]) {
      expect(after.results.get(id)).toEqual(before.results.get(id));
      expect(after.results.get(id)?.shape?.k).toBe('pt');
    }
  });
});
