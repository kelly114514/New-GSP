/** 第十四轮全库截图对照中修复的兼容问题（依据见 docs/gsp格式.md “第十四轮”）。样例目录不存在时跳过对应用例。 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGsp, encodeFile, encodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';
import { parameterColor } from '../src/core/color';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import type { Obj, Page } from '../src/core/model';
import { valueText } from '../src/ui/render';

const SAMPLES = '../sketchpad5/Samples';
const sample = (rel: string) => join(SAMPLES, rel);
const load = (rel: string) => decodeGsp(new Uint8Array(readFileSync(sample(rel)))).doc;
const num = (page: Page, id: number, unit?: 'rad') => { const s = evaluatePage(page, undefined, undefined, unit ? { angleUnit: unit } : {}).get(id)?.shape; return s?.k === 'num' ? s.q.v : NaN; };

describe('全库截图对照修复', () => {
  it('原版数值显示方式与标签分别保存，引用沿用显示方式', () => {
    const st = new Store();
    const t = st.add({ k: 'param', name: 't', unit: 'none', value: 2, showEdit: false }, { at: { x: 10, y: 10 } });
    const modes = ['expression', 'number', 'equals', 'label'] as const;
    const objects = modes.map((valueDisplay, i) => st.add({
      k: 'calc', unit: 'none', expr: { t: 'bin', op: '+', a: { t: 'ref', id: t.id }, b: { t: 'num', v: 1 } },
    }, { valueDisplay, label: 'm[1]', at: { x: 10, y: 40 + i * 30 } }));
    const ref = st.add({ k: 'calc', unit: 'none', expr: { t: 'ref', id: objects[1].id } }, { at: { x: 10, y: 180 } });
    const saved = encodeFile(st.doc, undefined);
    if (!saved.ok) throw Error(saved.reason);
    const reopened = new Store(decodeGsp(saved.bytes).doc);
    expect(objects.map(o => reopened.get(o.id)?.valueDisplay)).toEqual(modes);
    const render = (id: number) => valueText(reopened.page, reopened.results, reopened.get(id)!);
    expect(objects.map(o => render(o.id))).toEqual(['t + 1 = 3.00', '3.00', ' = 3.00', 'm[1] = 3.00']);
    expect(render(ref.id)).toBe('m[1] = 3.00');
  });

  it('原版纵轴从上往下编号，派生线上的路径点按同一方向读写', () => {
    const st = new Store(), system = createSystem(st, { x: 250, y: 240 });
    if (system.def.k !== 'sys') throw Error('坐标系无定义');
    const { axisY, origin } = system.def;
    const edge = st.add({ k: 'free', x: 300, y: 240 });
    const circle = st.add({ k: 'circle', c: origin, p: edge.id });
    const hit = st.add({ k: 'inter', a: axisY, b: circle.id, branch: 0 });
    const parallel = st.add({ k: 'parallel', pt: edge.id, line: axisY });
    const on = st.add({ k: 'onpath', path: parallel.id, abs: true, t: -50 });
    const saved = encodeFile(st.doc, undefined);
    if (!saved.ok) throw Error(saved.reason);
    const back = new Store(decodeGsp(saved.bytes).doc);
    expect(back.get(on.id)?.def).toMatchObject({ abs: true, t: -50 });
    expect(back.results.get(on.id)?.shape).toEqual({ k: 'pt', p: { x: 300, y: 290 } });
    expect(back.results.get(hit.id)?.shape).toEqual({ k: 'pt', p: { x: 250, y: 190 } });
  });

  it('标记距离横轴的纵向单位点跟随标记距离，方法 56 可写回', () => {
    const st = new Store(), a = st.add({ k: 'free', x: 200, y: 300 }), b = st.add({ k: 'free', x: 300, y: 300 });
    const seg = st.add({ k: 'seg', a: a.id, b: b.id });
    const axis = st.add({ k: 'axis-line', mode: 'distance', axis: 'x', origin: a.id, unit: seg.id });
    const y = st.add({ k: 'axis-unit', axis: axis.id, direction: 'y' }, { hidden: true });
    const back = new Store(decodeGsp(encodeGsp(st.doc)).doc);
    expect(back.get(y.id)?.def).toEqual(y.def);
    expect(back.results.get(y.id)?.shape).toEqual({ k: 'pt', p: { x: 200, y: 200 } });
    back.moveFree(b.id, 350, 300);
    expect(back.results.get(y.id)?.shape).toEqual({ k: 'pt', p: { x: 200, y: 150 } });
  });

  it('直线驱动的轨迹保留采样范围并用于取样', () => {
    const st = new Store(), a = st.add({ k: 'free', x: 350, y: 290 }), b = st.add({ k: 'free', x: 450, y: 290 });
    const line = st.add({ k: 'line', a: a.id, b: b.id });
    const driver = st.add({ k: 'onpath', path: line.id, t: 0.5 });
    const moving = st.add({ k: 'seg', a: a.id, b: driver.id });
    const mid = st.add({ k: 'mid', seg: moving.id });
    const locus = st.add({ k: 'locus', out: mid.id, driver: driver.id, samples: 100, pathRange: [-1, 3] });
    const back = new Store(decodeGsp(encodeGsp(st.doc)).doc);
    expect(back.get(locus.id)?.def).toEqual(locus.def);
    const shape = back.results.get(locus.id)?.shape;
    if (shape?.k !== 'paths') throw Error('轨迹无定义');
    expect(shape.paths[0][0]).toEqual({ x: 300, y: 290 });
    expect(shape.paths[0].at(-1)).toEqual({ x: 500, y: 290 });
  });

  it.skipIf(!existsSync(sample('5.x实例/李章博作品/多边形折叠（李章博）.gsp')))('多边形折叠保留有向缩放及曲线交点的构造次序', () => {
    const pg = load('5.x实例/李章博作品/多边形折叠（李章博）.gsp').pages[0];
    const res = evaluatePage(pg);
    const point = (id: number) => {
      const shape = res.get(id)?.shape;
      if (shape?.k !== 'pt') throw Error('点无定义');
      return shape.p;
    };
    expect(point(41).y).toBeCloseTo(410, 0);
    expect(point(116).y).toBeCloseTo(262, 0);
    expect(point(117).y).toBeCloseTo(452, 0);
    expect(point(134).x).toBeCloseTo(281, 0);
    expect(point(134).y).toBeCloseTo(470, 0);
  });

  it.skipIf(!existsSync(sample('5.x实例/群师作品/综合杂例类/蚶线.gsp')))('蚶线的轨迹不跨越交点分支变化', () => {
    const doc = load('5.x实例/群师作品/综合杂例类/蚶线.gsp'), page = doc.pages[doc.current];
    const scroll = page.scroll ?? { x: 0, y: 0 };
    const results = evaluatePage(page, undefined, undefined, { angleUnit: doc.settings.display?.angleUnit,
      view: { x0: scroll.x, y0: scroll.y, x1: scroll.x + 1190, y1: scroll.y + 636 } });
    const shape = results.get(17)?.shape;
    if (shape?.k !== 'paths') throw Error('轨迹无定义');
    expect(shape.paths.length).toBeGreaterThan(1);
    for (const path of shape.paths) for (let i = 1; i < path.length; i++) {
      expect(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)).toBeLessThan(30);
    }
  });

  it('方形坐标系的横轴和纵轴可独立使用 π 刻度并写回原版记录', () => {
    for (const flags of [{ piX: true } as const, { piY: true } as const, { piX: true, piY: true } as const]) {
      const st = new Store();
      const sys = createSystem(st);
      if (sys.def.k !== 'sys') throw Error('坐标系无定义');
      st.update(sys.id, { ...sys.def, ...flags });
      const encoded = encodeFile(st.doc, undefined);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      const back = decodeGsp(encoded.bytes).doc.pages[0].objects.find(o => o.def.k === 'sys');
      expect(back?.def).toMatchObject({ k: 'sys', grid: 'square', ...flags });
    }
  });

  it.skipIf(!existsSync(sample('5.x实例/群师作品/技巧型案例/轨迹问题.gsp')))('原版课件的 π 刻度与角度单位分别读取', () => {
    const doc = load('5.x实例/群师作品/技巧型案例/轨迹问题.gsp');
    const sys = doc.pages[doc.current].objects.find(o => o.def.k === 'sys');
    expect(sys?.def).toMatchObject({ k: 'sys', grid: 'square', piX: true });
  });

  it('参数颜色：RGB、HSV 的参数按 [B,G,R]、[V,S,H] 存放，光谱和灰度与原版夹具一致', () => {
    const c = (mode: 'rgb' | 'hsv' | 'color' | 'gray', values: number[]) => parameterColor({ k: 'colorize', src: 0, params: values.map((_, i) => i), mode, cycle: 'none', from: 0, to: 1 }, values);
    expect(c('rgb', [1, 0, 0])).toBe('#0000ff');
    expect(c('hsv', [0.3333, 1, 1])).toBe('#550000');
    expect(c('gray', [0.25])).toBe('#404040');
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h!.slice(i, i + 2), 16));
    for (const [v, want] of [[0, [233, 0, 255]], [0.5, [69, 249, 0]], [1, [255, 0, 0]]] as const) rgb(c('color', [v])!).forEach((n, i) => expect(Math.abs(n - want[i])).toBeLessThanOrEqual(2));
  });

  it('三点比是有向比，弧度制文档的计算按弧度', () => {
    const st = new Store();
    const a = st.add({ k: 'free', x: 100, y: 100 }), b = st.add({ k: 'free', x: 200, y: 100 }), c = st.add({ k: 'free', x: 50, y: 100 });
    const r = st.add({ k: 'measure', m: 'ratio', refs: [a.id, b.id, c.id] });
    expect(num(st.page, r.id)).toBeCloseTo(-0.5);
    const ang = st.add({ k: 'param', name: 't', value: -130.2851, unit: 'angle', showEdit: true });
    const calc = st.add({ k: 'calc', unit: 'none', expr: { t: 'fn', name: 'sin', a: { t: 'bin', op: '+', a: { t: 'num', v: 1 }, b: { t: 'bin', op: '*', a: { t: 'num', v: 2 }, b: { t: 'ref', id: ang.id } } } } });
    expect(num(st.page, calc.id, 'rad')).toBeCloseTo(Math.sin(1 + 2 * -130.2851 * Math.PI / 180), 6);
    expect(num(st.page, calc.id)).toBeCloseTo(Math.sin((1 - 2 * 130.2851) * Math.PI / 180), 6);
  });

  it('迭代次数超过 20 层（原版 example-36.gsp 迭代 119 次）', () => {
    const st = new Store();
    const p = st.add({ k: 'free', x: 0, y: 0 });
    const q = st.add({ k: 'translate', src: p.id, by: { mode: 'rect', dx: 0.01, dy: 0 } });
    const it = st.add({ k: 'iterate', pre: [p.id], maps: [[q.id]], body: [q.id], depth: { fixed: 119 } });
    const s = evaluatePage(st.page).get(it.id)?.shape;
    expect(s?.k === 'iter' ? s.states.length : 0).toBe(119);
  });

  it('“到随机位置”的迭代：前像中的路径点每层取路径上的随机位置，结果稳定，并能写回', () => {
    const st = new Store();
    const a = st.add({ k: 'free', x: 0, y: 0 }), b = st.add({ k: 'free', x: 100, y: 0 });
    const seg = st.add({ k: 'seg', a: a.id, b: b.id });
    const on = st.add({ k: 'onpath', path: seg.id, t: 0.5 });
    const it = st.add({ k: 'iterate', pre: [on.id], maps: [[on.id]], body: [], depth: { fixed: 50 }, salt: 7, random: true });
    const xs = (() => { const s = evaluatePage(st.page).get(it.id)?.shape; return s?.k === 'iter' ? s.states.map(x => (x[0].shape as { p: { x: number } }).p.x) : []; })();
    expect(new Set(xs.map(x => Math.round(x))).size).toBeGreaterThan(20);
    const again = evaluatePage(st.page).get(it.id)?.shape;
    expect(again?.k === 'iter' ? again.states.map(x => (x[0].shape as { p: { x: number } }).p.x) : []).toEqual(xs);
    expect(decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects.find((o: Obj) => o.def.k === 'iterate')?.def).toMatchObject({ random: true, salt: 7 });
  });

  it('参数数值框、页背景和样式表在新版写出后读回不变', () => {
    const st = new Store();
    const boxed = st.add({ k: 'param', name: 'a', value: 1, unit: 'none', showEdit: true }, { at: { x: 10, y: 10 } });
    const plain = st.add({ k: 'param', name: 'b', value: 2, unit: 'none', showEdit: false }, { at: { x: 10, y: 40 } });
    plain.font = { name: 'Arial', size: 12, bold: true, italic: false, underline: false, color: '#000000' };
    st.page.background = '#000000';
    const back = decodeGsp(encodeGsp(st.doc)).doc.pages[0];
    const get = (id: number) => back.objects.find((o: Obj) => o.id === id)!;
    expect(get(boxed.id).def).toMatchObject({ showEdit: true });
    expect(get(plain.id).def).toMatchObject({ showEdit: false });
    expect(get(plain.id).font).toMatchObject({ name: 'Arial', size: 12, bold: true });
    expect(get(boxed.id).font).toBeUndefined();
    expect(back.background ?? '').toBe('#000000');
  });

  it.skipIf(!existsSync(sample('4.x实例/官长寿作品/杂例/example-40.gsp')))('example-40.gsp：负坐标按钮、样式表字体、4.x 参数不画数值框', () => {
    const page = load('4.x实例/官长寿作品/杂例/example-40.gsp').pages[0];
    const buttons = page.objects.filter(o => o.def.k === 'button');
    expect(buttons.every(o => o.def.k === 'button' && o.def.at.y < 0 && o.def.at.y > -300)).toBe(true);
    const k = page.objects.find(o => o.def.k === 'param')!;
    expect(k.def).toMatchObject({ showEdit: false });
    expect(k.font).toMatchObject({ name: 'Arial', size: 12, bold: true });
    expect(buttons.find(o => o.def.k === 'button' && o.def.action.type === 'link')?.font).toMatchObject({ name: 'Times New Roman', size: 14, bold: true, italic: true });
  });

  it.skipIf(!existsSync(sample('5.x实例/群师作品/技巧型案例/复变换.gsp')))('复变换.gsp：方形网格的纵轴单位跟随横轴单位', () => {
    const page = load('5.x实例/群师作品/技巧型案例/复变换.gsp').pages[0];
    const sys = evaluatePage(page).get(page.objects.find(o => o.def.k === 'sys')!.id)?.shape;
    if (sys?.k !== 'sys') throw Error('坐标系无定义');
    expect(Math.hypot(sys.uy.x, sys.uy.y)).toBeCloseTo(Math.hypot(sys.ux.x, sys.ux.y), 6);
  });

  it.skipIf(!existsSync(sample('5.x实例/群师作品/综合杂例类/幂函数.gsp')))('幂函数.gsp：每页各自的背景色', () => {
    const doc = load('5.x实例/群师作品/综合杂例类/幂函数.gsp');
    expect(doc.pages[1].background).toBe('#000000');
  });
  it('点的值：路径退化时用点自己的路径参数；轨迹的轨迹给出一族曲线', () => {
    const st = new Store();
    const a = st.add({ k: 'free', x: 10, y: 10 }), b = st.add({ k: 'free', x: 10, y: 10 });
    const seg = st.add({ k: 'seg', a: a.id, b: b.id });
    const on = st.add({ k: 'onpath', path: seg.id, t: 0.3 });
    const pv = st.add({ k: 'measure', m: 'pointvalue', refs: [on.id, seg.id] });
    expect(num(st.page, pv.id)).toBeCloseTo(0.3);
    const c = st.add({ k: 'free', x: 0, y: 0 }), d = st.add({ k: 'free', x: 100, y: 0 });
    const base = st.add({ k: 'seg', a: c.id, b: d.id });
    const drv = st.add({ k: 'onpath', path: base.id, t: 0.5 });
    const e = st.add({ k: 'free', x: 0, y: 50 }), f = st.add({ k: 'free', x: 100, y: 50 });
    const top = st.add({ k: 'seg', a: e.id, b: f.id });
    const drv2 = st.add({ k: 'onpath', path: top.id, t: 0.5 });
    const mid = st.add({ k: 'seg', a: drv.id, b: drv2.id });
    const m = st.add({ k: 'mid', seg: mid.id });
    const inner = st.add({ k: 'locus', driver: drv2.id, out: m.id, samples: 20 });
    const outer = st.add({ k: 'locus', driver: drv.id, out: inner.id, samples: 5 });
    const s = evaluatePage(st.page).get(outer.id)?.shape;
    expect(s?.k).toBe('multi');
    expect(s?.k === 'multi' ? s.items.length : 0).toBe(41);   // 轨迹样本数下限 40
  });

  it.skipIf(!existsSync(sample('5.x实例/方小庆作品/反比例函数课件(inRm).gsp')))('表格：负号写成“–”的单元和无法读成数的单元保持行列对齐', () => {
    const t = load('5.x实例/方小庆作品/反比例函数课件(inRm).gsp').pages.flatMap(pg => pg.objects).find(o => o.def.k === 'table');
    if (t?.def.k !== 'table') throw Error('没有表格');
    expect(t.def.rows[0]).toEqual([-10, -0.1]);
    expect(t.def.rows.length).toBeGreaterThan(15);
    expect(t.def.rows.every(r => r.length === 2)).toBe(true);
  });
});

