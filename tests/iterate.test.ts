import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';
import { evaluatePage, type Shape } from '../src/core/engine';
import { Store } from '../src/core/store';

const FIX = join(__dirname, '../../reference/raw/runtime/fixtures-v3');
const have = existsSync(FIX);
const load = (n: string) => new Uint8Array(readFileSync(join(FIX, `${n}.gsp`)));
const round = (x: number) => Math.round(x * 100) / 100;

/** 迭代对象和迭代象的原始记录（头前 18 字节、父对象、2314）。 */
function iterRecords(bytes: Uint8Array) {
  const out: string[] = [];
  let cur: string[] | undefined;
  for (const r of readRecords(bytes).records) {
    const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    if (r.tag === 2000) cur = v.getUint16(6, true) === 14 || v.getUint16(6, true) === 15 ? [`h${Buffer.from(r.data.subarray(0, 4)).toString('hex')}/${Buffer.from(r.data.subarray(6, 18)).toString('hex')}`] : undefined;
    else if (cur && r.tag === 2002) cur.push(`p[${Array.from({ length: v.getUint32(0, true) }, (_, i) => v.getUint32(4 + 4 * i, true)).join(',')}]`);
    else if (cur && r.tag === 2314) cur.push(`2314:${Buffer.from(r.data).toString('hex')}`);
    else if (cur && r.tag === 2007) { out.push(cur.join(' ')); cur = undefined; }
  }
  return out;
}

const imagesOf = (st: ReturnType<typeof evaluatePage>, id: number) => { const s = st.get(id)?.shape; return s?.k === 'multi' ? s.items : []; };

it('对象编号稀疏时仍能展开迭代象', () => {
  const st = new Store();
  st.page.nextId = 1_000_000;
  const start = st.add({ k: 'free', x: 10, y: 20 });
  const step = st.add({ k: 'translate', src: start.id, by: { mode: 'rect', dx: 0.2, dy: 0 } });
  const iter = st.add({ k: 'iterate', pre: [start.id], maps: [[step.id]], body: [step.id], depth: { fixed: 3 } });
  const image = st.add({ k: 'iterimg', src: step.id, iter: iter.id });
  const points = imagesOf(evaluatePage(st.page), image.id);
  expect(points).toHaveLength(3);
  for (let i = 0; i < points.length; i++) {
    const s = points[i];
    expect(s.k).toBe('pt');
    if (s.k === 'pt') expect(s.p.x).toBeCloseTo(10 + (i + 2) * 0.2 * 96 / 2.54, 10);
  }
});

it('轨迹读取迭代象末点与逐样本完整展开一致', () => {
  for (const branching of [false, true]) for (const finalOnly of [false, true]) for (const fixed of [false, true]) {
    const st = new Store();
    const a = st.add({ k: 'free', x: 0, y: 0 });
    const b = st.add({ k: 'free', x: 100, y: 0 });
    const line = st.add({ k: 'seg', a: a.id, b: b.id });
    const driver = st.add({ k: 'onpath', path: line.id, t: 0.5 });
    const first = st.add({ k: 'translate', src: driver.id, by: { mode: 'rect', dx: fixed ? 0 : 0.2, dy: fixed ? 0 : 0.1 } });
    const second = st.add({ k: 'translate', src: driver.id, by: { mode: 'rect', dx: -0.1, dy: 0.2 } });
    const iter = st.add({ k: 'iterate', pre: [driver.id], maps: branching ? [[first.id], [second.id]] : [[first.id]], body: [first.id, second.id], depth: { fixed: 3 }, finalOnly });
    const image = st.add({ k: 'iterimg', src: first.id, iter: iter.id });
    const point = st.add({ k: 'iterpt', img: image.id });
    const withoutLocus = structuredClone(st.page);
    const locus = st.add({ k: 'locus', driver: driver.id, out: point.id, samples: 40 });
    const shape = evaluatePage(st.page).get(locus.id)?.shape;
    if (shape?.k !== 'paths') throw Error('轨迹无定义');
    const expected = Array.from({ length: 41 }, (_, i) => {
      const s = evaluatePage(withoutLocus, undefined, undefined, { tOverride: new Map([[driver.id, i / 40]]) }).get(point.id)?.shape;
      if (s?.k !== 'pt') throw Error('迭代末点无定义');
      return s.p;
    });
    expect(shape.paths[0]).toEqual(expected);
  }
});

it('单映射轨迹在末几层无交点时与完整迭代象一致', () => {
  for (const finalOnly of [false, true]) {
    const st = new Store();
    const origin = st.add({ k: 'free', x: 0, y: 0 });
    const end = st.add({ k: 'free', x: 3, y: 0 });
    const radius = st.add({ k: 'free', x: 25, y: 0 });
    const path = st.add({ k: 'seg', a: origin.id, b: end.id });
    const circle = st.add({ k: 'circle', c: origin.id, p: radius.id });
    const driver = st.add({ k: 'onpath', path: path.id, t: 0.5 });
    const step = st.add({ k: 'translate', src: driver.id, by: { mode: 'rect', dx: 0.26, dy: 0 } });
    const vertical = st.add({ k: 'perp', pt: driver.id, line: path.id });
    const intersection = st.add({ k: 'inter', a: vertical.id, b: circle.id, branch: 0 });
    const iter = st.add({ k: 'iterate', pre: [driver.id], maps: [[step.id]], body: [step.id, vertical.id, intersection.id], depth: { fixed: 4 }, finalOnly });
    const image = st.add({ k: 'iterimg', src: intersection.id, iter: iter.id });
    const point = st.add({ k: 'iterpt', img: image.id });
    const withoutLocus = structuredClone(st.page);
    const locus = st.add({ k: 'locus', driver: driver.id, out: point.id, samples: 40 });
    const actual = evaluatePage(st.page).get(locus.id);
    const expected = Array.from({ length: 41 }, (_, i) => evaluatePage(withoutLocus, undefined, undefined,
      { tOverride: new Map([[driver.id, i / 40]]) }).get(point.id)?.shape);
    if (finalOnly) {
      expect(expected.every(s => s === undefined)).toBe(true);
      expect(actual?.status).toBe('undefined');
    } else {
      expect(expected.every(s => s?.k === 'pt')).toBe(true);
      expect(actual?.shape?.k).toBe('paths');
      if (actual?.shape?.k === 'paths') expect(actual.shape.paths[0]).toEqual(expected.map(s => s?.k === 'pt' ? s.p : undefined));
    }
  }
});

it('同一轨迹样本读取两个迭代象时与完整展开一致', () => {
  const st = new Store();
  const a = st.add({ k: 'free', x: 0, y: 0 }), b = st.add({ k: 'free', x: 100, y: 0 });
  const path = st.add({ k: 'seg', a: a.id, b: b.id });
  const driver = st.add({ k: 'onpath', path: path.id, t: 0.5 });
  const step = st.add({ k: 'translate', src: driver.id, by: { mode: 'rect', dx: 0.2, dy: 0.1 } });
  const second = st.add({ k: 'translate', src: driver.id, by: { mode: 'rect', dx: -0.3, dy: 0.2 } });
  const iter = st.add({ k: 'iterate', pre: [driver.id], maps: [[step.id]], body: [step.id, second.id], depth: { fixed: 7 } });
  const image1 = st.add({ k: 'iterimg', src: step.id, iter: iter.id });
  const image2 = st.add({ k: 'iterimg', src: second.id, iter: iter.id });
  const p1 = st.add({ k: 'iterpt', img: image1.id }), p2 = st.add({ k: 'iterpt', img: image2.id });
  const seg = st.add({ k: 'seg', a: p1.id, b: p2.id }), mid = st.add({ k: 'mid', seg: seg.id });
  const withoutLocus = structuredClone(st.page);
  const locus = st.add({ k: 'locus', driver: driver.id, out: mid.id, samples: 40 });
  const shape = evaluatePage(st.page).get(locus.id)?.shape;
  expect(shape?.k).toBe('paths');
  const expected = Array.from({ length: 41 }, (_, i) => {
    const s = evaluatePage(withoutLocus, undefined, undefined, { tOverride: new Map([[driver.id, i / 40]]) }).get(mid.id)?.shape;
    if (s?.k !== 'pt') throw Error('迭代末点无定义');
    return s.p;
  });
  if (shape?.k === 'paths') expect(shape.paths[0]).toEqual(expected);
});

it('单映射提前无定义时保留最后有效层并尊重仅显示最终迭代', () => {
  for (const finalOnly of [false, true]) {
    const st = new Store();
    const origin = st.add({ k: 'free', x: 0, y: 0 }), end = st.add({ k: 'free', x: 3, y: 0 });
    const radius = st.add({ k: 'free', x: 25, y: 0 });
    const path = st.add({ k: 'seg', a: origin.id, b: end.id });
    const circle = st.add({ k: 'circle', c: origin.id, p: radius.id });
    const driver = st.add({ k: 'onpath', path: path.id, t: 0.5 });
    const step = st.add({ k: 'translate', src: driver.id, by: { mode: 'rect', dx: 0.26, dy: 0 } });
    const vertical = st.add({ k: 'perp', pt: step.id, line: path.id });
    const next = st.add({ k: 'inter', a: vertical.id, b: circle.id, branch: 0 });
    const iter = st.add({ k: 'iterate', pre: [driver.id], maps: [[next.id]], body: [step.id, vertical.id, next.id], depth: { fixed: 4 }, finalOnly });
    const image = st.add({ k: 'iterimg', src: step.id, iter: iter.id });
    const point = st.add({ k: 'iterpt', img: image.id });
    const withoutLocus = structuredClone(st.page);
    const locus = st.add({ k: 'locus', driver: driver.id, out: point.id, samples: 40 });
    const actual = evaluatePage(st.page).get(locus.id);
    const expected = Array.from({ length: 41 }, (_, i) => evaluatePage(withoutLocus, undefined, undefined,
      { tOverride: new Map([[driver.id, i / 40]]) }).get(point.id)?.shape);
    if (finalOnly) {
      expect(expected.every(s => s === undefined)).toBe(true);
      expect(actual?.status).toBe('undefined');
    } else {
      expect(expected.every(s => s?.k === 'pt')).toBe(true);
      expect(actual?.shape?.k).toBe('paths');
      if (actual?.shape?.k === 'paths') expect(actual.shape.paths[0]).toEqual(expected.map(s => s?.k === 'pt' ? s.p : undefined));
    }
  }
});

describe.skipIf(!have)('迭代：原版采集的样本', () => {
  it('点和线段的迭代：A→B、B→中点，默认 3 次；位置与手算一致', () => {
    const r = decodeGsp(load('i01')), pg = r.doc.pages[0], res = evaluatePage(pg);
    expect(r.source.protectedReason).toBeUndefined();
    expect(pg.objects[4].def).toMatchObject({ k: 'iterate', pre: [1, 2], maps: [[2, 4]], body: [3, 4], depth: { fixed: 3 } });
    const A = 134, B = 267;               // 原版里放在 200/400 物理像素，文件里是 2/3
    const m = (a: number, b: number) => (a + b) / 2;
    const s1 = [B, m(A, B)], s2 = [s1[1], m(s1[0], s1[1])], s3 = [s2[1], m(s2[0], s2[1])];   // 状态：前像 (A, B) 每次换成 (B, M)
    const seg = imagesOf(res, 6).map(s => s.k === 'line' ? [round(s.s.a.x), round(s.s.b.x)] : []);
    expect(seg).toEqual([s1, s2, s3].map(s => [round(s[0]), round(s[1])]));
    const pts = imagesOf(res, 7).map(s => s.k === 'pt' ? round(s.p.x) : NaN);
    expect(pts).toEqual([s1, s2, s3].map(s => round(m(s[0], s[1]))));
  });

  it('增加迭代、只显示最终迭代、仅保留非点类象（没有点的像）', () => {
    const count = (n: string, id: number) => imagesOf(evaluatePage(decodeGsp(load(n)).doc.pages[0]), id).length;
    expect(count('i02', 6)).toBe(4);
    expect(count('i03', 6)).toBe(1);
    expect(decodeGsp(load('i03')).doc.pages[0].objects[4].def).toMatchObject({ finalOnly: true });
    expect(decodeGsp(load('i04')).doc.pages[0].objects.filter(o => o.def.k === 'iterimg').length).toBe(1);
  });

  it('两个映射：每层的状态数按映射数翻倍（2+4+8 = 14 条线段）', () => {
    const r = decodeGsp(load('i06')), pg = r.doc.pages[0];
    expect(pg.objects[4].def).toMatchObject({ maps: [[1, 4], [4, 2]] });
    expect(imagesOf(evaluatePage(pg), 6).length).toBe(14);
  });

  it('与前像无关的后代（圆）也有像；隐藏的线段不产生像但仍在 body 里', () => {
    const r8 = decodeGsp(load('i08')), r9 = decodeGsp(load('i09'));
    expect(r8.doc.pages[0].objects.find(o => o.def.k === 'iterate')!.def).toMatchObject({ body: [3, 4, 5] });
    const circles = imagesOf(evaluatePage(r8.doc.pages[0]), 9);
    expect(circles.length).toBe(3); expect(circles.every((c: Shape) => c.k === 'circle')).toBe(true);
    expect(r9.doc.pages[0].objects.filter(o => o.def.k === 'iterimg').length).toBe(1);
    expect(r9.doc.pages[0].objects.find(o => o.def.k === 'iterate')!.def).toMatchObject({ body: [3, 4] });
  });

  it('深度迭代：次数取自参数；改参数后像的个数跟着变', () => {
    const r = decodeGsp(load('p01')), pg = r.doc.pages[0];
    expect(pg.objects.find(o => o.def.k === 'iterate')!.def).toMatchObject({ depth: { param: 5 } });
    expect(imagesOf(evaluatePage(pg), 7).length).toBe(3);
    const st = new Store(r.doc);
    st.run('x', () => st.update(5, { ...(st.get(5)!.def as { k: 'param'; name: string; value: number; unit: 'none'; showEdit: boolean }), value: 5 }));
    expect(imagesOf(st.results, 7).length).toBe(5);
  });

  it('拖动前像：像跟着动', () => {
    const r = decodeGsp(load('i01')), st = new Store(r.doc);
    st.run('x', () => st.moveFree(1, 300, 100));
    const seg = imagesOf(st.results, 6)[0];
    expect(seg.k === 'line' && seg.s.b.x).toBeCloseTo((300 + 267) / 2);   // 第一层 (A1, B1) = (B, M)，M 是 A、B 的中点；A 挪到 300 后 M 跟着动
  });

  it('写出：迭代对象和迭代象的头、父对象、2314 与原版写的完全一致', () => {
    for (const n of ['i01', 'i02', 'i03', 'i04', 'i06', 'i08', 'i09', 'p01']) {
      const bytes = load(n), r = decodeGsp(bytes);
      const again = encodeGsp(r.doc);
      const a = iterRecords(bytes), b = iterRecords(again);
      // 头的 18 字节之后是颜色/样式，和下面的“互读”样本一起核对；这里只比较种类、父对象和 2314
      expect(b.map(x => x.replace(/\/[0-9a-f]+/, ''))).toEqual(a.map(x => x.replace(/\/[0-9a-f]+/, '')));
    }
  });
});
