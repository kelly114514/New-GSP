import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import type { Expr } from '../src/core/expr';

/** 原版对照夹具：参数从 -4 到 4，绘制 (3 + x(a), a + y(a)) 的轨迹。 */
function trace(mode: 'step' | 'diagonal' | 'smooth' | 'line', amount: number, samples: number, boundary = 0.003) {
  const st = new Store(), sys = createSystem(st, { x: 400, y: 250 });
  const a = st.add({ k: 'param', name: 'a', value: -1, unit: 'none', showEdit: false }, {}, false);
  const x: Expr = { t: 'bin', op: '-', a: { t: 'ref', id: a.id }, b: { t: 'num', v: boundary } };
  const jump: Expr = { t: 'bin', op: '*', a: { t: 'num', v: amount }, b: { t: 'fn', name: 'sgn', a: x } };
  const smooth: Expr = { t: 'bin', op: '/', a: { t: 'bin', op: '*', a: { t: 'num', v: 2 }, b: x },
    b: { t: 'fn', name: 'sqrt', a: { t: 'bin', op: '+', a: { t: 'bin', op: '*', a: x, b: x }, b: { t: 'num', v: 0.000001 } } } };
  const term: Expr = mode === 'smooth' ? smooth : mode === 'line' ? { t: 'bin', op: '*', a: { t: 'num', v: amount }, b: { t: 'ref', id: a.id } } : jump;
  const px = st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'num', v: 3 }, b: term }, unit: 'none' }, {}, false);
  const py = mode === 'diagonal' ? st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: a.id }, b: jump }, unit: 'none' }, {}, false).id : a.id;
  const p = st.add({ k: 'plotxy', x: px.id, y: py, sys: sys.id }, {}, false);
  const locus = st.add({ k: 'locus', driver: a.id, out: p.id, samples, parameter: { range: [-4, 4] } }, {}, false);
  st.recompute();
  const shape = st.results.get(locus.id)?.shape;
  if (shape?.k !== 'paths') throw Error('轨迹无定义');
  return shape.paths;
}

describe('轨迹跳变', () => {
  for (const samples of [40, 500, 1000]) {
    it(`参数取 ${samples} 份时，按原版对照区分小跳变和大跳变`, () => {
      expect(trace('step', 0.34, samples)).toHaveLength(1);
      expect(trace('step', 0.35, samples)).toHaveLength(2);
    });
  }
  it('斜向跳变按单轴距离判定', () => {
    expect(trace('diagonal', 0.30, 500)).toHaveLength(1);
    expect(trace('diagonal', 0.35, 500)).toHaveLength(2);
  });
  it('首尾样本间的跳变也断开', () => {
    expect(trace('step', 1, 40, -3.9)).toHaveLength(2);
    expect(trace('step', 1, 40, 3.9)).toHaveLength(2);
  });
  it('陡峭的连续直线及快速变化的平滑曲线保持连接', () => {
    expect(trace('line', 10, 40)).toHaveLength(1);
    expect(trace('smooth', 1, 500)).toHaveLength(1);
  });
});

it('轨迹在有定义区间的边界继续细分，但不跨越无定义区间', () => {
  const st = new Store(), sys = createSystem(st, { x: 400, y: 250 });
  const a = st.add({ k: 'param', name: 'a', value: 2, unit: 'none', showEdit: false }, {}, false);
  const square: Expr = { t: 'bin', op: '*', a: { t: 'ref', id: a.id }, b: { t: 'ref', id: a.id } };
  const y = st.add({ k: 'calc', expr: { t: 'fn', name: 'sqrt', a: { t: 'bin', op: '-', a: square, b: { t: 'num', v: 1 } } }, unit: 'none' }, {}, false);
  const point = st.add({ k: 'plotxy', x: a.id, y: y.id, sys: sys.id }, {}, false);
  const locus = st.add({ k: 'locus', driver: a.id, out: point.id, samples: 40, parameter: { range: [-3.97, 4.03] } }, {}, false);
  st.recompute();
  const shape = st.results.get(locus.id)?.shape;
  if (shape?.k !== 'paths') throw Error('轨迹无定义');
  expect(shape.paths).toHaveLength(2);
  const firstEnd = shape.paths[0].at(-1)!, secondStart = shape.paths[1][0];
  expect(firstEnd.x).toBeCloseTo(400 - 96 / 2.54, 1);
  expect(secondStart.x).toBeCloseTo(400 + 96 / 2.54, 1);
  expect(Math.abs(firstEnd.y - 250)).toBeLessThan(1.5);
  expect(Math.abs(secondStart.y - 250)).toBeLessThan(1.5);
});
