import { describe, expect, it } from 'vitest';
import { evaluatePage, type Results } from '../src/core/engine';
import { iterFast } from '../src/core/iterfast';
import { createSystem } from '../src/core/construct';
import { Store } from '../src/core/store';
import type { Expr } from '../src/core/expr';
import type { Id } from '../src/core/model';

const num = (v: number): Expr => ({ t: 'num', v });
const ref = (id: Id): Expr => ({ t: 'ref', id });
const bin = (op: '+' | '-' | '*' | '/' | '^', a: Expr, b: Expr): Expr => ({ t: 'bin', op, a, b });
const fn = (name: string, a: Expr): Expr => ({ t: 'fn', name, a });

interface Options { angleUnit: 'deg' | 'rad'; depth: number; finalOnly: boolean; secondImage: boolean; table: boolean; shrink: number; sqrtOffset: number }

/** 仿 Mira 分形的迭代：前像是点和一个数，迭代体里有横纵坐标度量、计算（含三角、开方、除法、用户函数）和按坐标画点。 */
function build(o: Options) {
  const st = new Store();
  const sys = createSystem(st).id;
  const a = st.add({ k: 'free', x: 120, y: 200 }), b = st.add({ k: 'free', x: 260, y: 150 });
  const path = st.add({ k: 'seg', a: a.id, b: b.id });
  const driver = st.add({ k: 'onpath', path: path.id, t: 0.3 });
  const p0 = st.add({ k: 'param', name: 'p', value: 0.5, unit: 'none', showEdit: true });
  const k = st.add({ k: 'param', name: 'k', value: o.shrink, unit: 'none', showEdit: true });
  const f = st.add({ k: 'func', name: 'f', param: 'x', expr: bin('+', bin('*', ref(k.id), { t: 'x' }), bin('*', num(0.1), bin('^', { t: 'x' }, num(2)))) });
  const mx = st.add({ k: 'measure', m: 'abscissa', refs: [driver.id, sys] });
  const my = st.add({ k: 'measure', m: 'ordinate', refs: [driver.id, sys] });
  const c1 = st.add({ k: 'calc', unit: 'none', expr: bin('+', bin('*', ref(mx.id), ref(k.id)), { t: 'call', func: f.id, a: ref(my.id) }) });
  const c2 = st.add({ k: 'calc', unit: 'none', expr: bin('-', fn('sin', bin('*', num(0.5), ref(c1.id))), bin('/', ref(my.id), bin('+', num(2), fn('sqrt', bin('+', fn('abs', ref(c1.id)), num(o.sqrtOffset)))))) });
  const plot = st.add({ k: 'plotxy', x: c1.id, y: c2.id, sys });
  const next = st.add({ k: 'calc', unit: 'none', expr: bin('+', ref(p0.id), bin('*', num(0.01), fn('trunc', bin('*', num(3), ref(c2.id))))) });
  const plot2 = st.add({ k: 'plotxy', x: c2.id, y: next.id, sys });
  const depth = st.add({ k: 'param', name: 'n', value: o.depth, unit: 'none', showEdit: true });
  const iter = st.add({ k: 'iterate', pre: [driver.id, p0.id], maps: [[plot.id, next.id]], body: [mx.id, my.id, c1.id, c2.id, plot.id, next.id, plot2.id], depth: { param: depth.id }, finalOnly: o.finalOnly });
  const image = st.add({ k: 'iterimg', src: plot2.id, iter: iter.id });
  const point = st.add({ k: 'iterpt', img: image.id });
  let out = point.id;
  if (o.secondImage) {
    const image2 = st.add({ k: 'iterimg', src: plot.id, iter: iter.id });
    const point2 = st.add({ k: 'iterpt', img: image2.id });
    const seg = st.add({ k: 'seg', a: point.id, b: point2.id });
    out = st.add({ k: 'mid', seg: seg.id }).id;
  }
  if (o.table) st.add({ k: 'itertable', iter: iter.id, cols: [c1.id] });
  const locus = st.add({ k: 'locus', driver: driver.id, out, samples: 60 });
  return { st, locus: locus.id, point: out };
}

const snapshot = (results: Results) => JSON.stringify([...results.entries()], (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));

function run(o: Options, enabled: boolean) {
  const { st } = build(o);
  const before = iterFast.enabled;
  iterFast.enabled = enabled;
  try { return snapshot(evaluatePage(st.page, undefined, undefined, { angleUnit: o.angleUnit })); } finally { iterFast.enabled = before; }
}

describe('迭代数值快路径与通用求值器逐位一致', () => {
  const base: Options = { angleUnit: 'deg', depth: 40, finalOnly: false, secondImage: false, table: false, shrink: 0.8, sqrtOffset: 1 };
  const variants: [string, Partial<Options>][] = [
    ['度制', {}],
    ['弧度制', { angleUnit: 'rad' }],
    ['仅显示最终迭代', { finalOnly: true }],
    ['两个迭代象读取同一迭代', { secondImage: true }],
    ['有迭代数据表（需要保留各层状态）', { table: true }],
    ['中途开方无定义，只保留已算出的层', { sqrtOffset: -0.9, shrink: 1.4, depth: 200 }],
    ['中途数值发散成非有限数', { shrink: 40, depth: 400 }],
    ['深度很大', { depth: 3000 }],
  ];
  for (const [name, change] of variants) {
    it(name, () => {
      const o = { ...base, ...change };
      const slow = run(o, false), used = iterFast.used, fast = run(o, true);
      expect(fast).toBe(slow);
      expect(iterFast.used).toBeGreaterThan(used);
    });
  }

  it('快路径确实被用上，并且与逐样本完整展开的末点一致', () => {
    const o = { ...base, secondImage: true };
    const { st, locus, point } = build(o);
    const used = iterFast.used;
    const shape = evaluatePage(st.page, undefined, undefined, { angleUnit: o.angleUnit }).get(locus)?.shape;
    expect(iterFast.used).toBeGreaterThan(used);
    if (shape?.k !== 'paths') throw Error('轨迹无定义');
    const driver = st.page.objects.find(x => x.def.k === 'onpath' && x.def.t === 0.3)!.id;
    const expected = Array.from({ length: 61 }, (_, i) => {
      const without = structuredClone(st.page);
      without.objects = without.objects.filter(x => x.def.k !== 'locus');
      const s = evaluatePage(without, undefined, undefined, { angleUnit: o.angleUnit, tOverride: new Map([[driver, i / 60]]) }).get(point)?.shape;
      return s?.k === 'pt' ? s.p : undefined;
    });
    expect(shape.paths.flat()).toEqual(expected.filter(Boolean));
  });
});
