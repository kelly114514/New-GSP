import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import { acceptsInput, applyTool, initialToolPathParameter, inputKindOf, toolInputFromHits, type Tool } from '../src/core/tooling';
import { readRichText } from '../src/gsp/richtext';
import { remapDef } from '../src/core/remap';
import { defaultStyle, type Obj } from '../src/core/model';
import { decodeGsp, encodeGsp, readTools } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';
import { clipStraight, drawPage, measureName } from '../src/ui/render';

const object = (id: number, def: Obj['def']): Obj => ({ id, def, style: defaultStyle(def), hidden: false, labelShown: false });
const rec = (tag: number, data: Uint8Array = new Uint8Array()) => {
  const b = new Uint8Array(data.length + 8), v = new DataView(b.buffer);
  v.setUint32(0, data.length, true); v.setUint32(4, tag, true); b.set(data, 8); return b;
};
const concat = (parts: Uint8Array[]) => { const b = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of parts) { b.set(p, i); i += p.length; } return b; };

describe('工具兼容修复', () => {
  it('渐近线附近的虚线轨迹只提交可见线段，普通与彩色轨迹都不绘制巨大屏外段', () => {
    const st = new Store(), o = object(1, { k: 'locus', driver: 2, out: 3, samples: 40 }); o.style.dash = 'dot';
    st.page.objects = [o];
    const calls: number[][] = [];
    const ctx = new Proxy({}, { get: (_t, key) => key === 'moveTo' || key === 'lineTo' ? (x: number, y: number) => calls.push([x, y]) : () => undefined }) as CanvasRenderingContext2D;
    for (const colors of [undefined, [['#ff0000', '#0000ff']]]) {
      calls.length = 0;
      const results = new Map([[1, { status: 'ok' as const, shape: { k: 'paths' as const, paths: [[{ x: -1e12, y: 100 }, { x: 1e12, y: 100 }]], colors } }]]);
      drawPage(ctx, st.page, results, { selection: new Set(), hideHidden: true, view: { x0: 0, y0: 0, x1: 800, y1: 600 } });
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(([x, y]) => x >= -31 && x <= 831 && y === 100)).toBe(true);
    }
  });
  it('发散迭代的巨大坐标不会提交给原生直线绘图；屏外定义的直线仍可穿过视口', () => {
    const view = { x0: 0, y0: 0, x1: 800, y1: 600 };
    expect(clipStraight({ a: { x: 5.6e12, y: -8.5e23 }, b: { x: 5.6e12 + 38, y: -8.5e23 - 1.1e13 }, ext: 'line' }, view)).toBeUndefined();
    expect(clipStraight({ a: { x: 10000, y: 100 }, b: { x: 10001, y: 100 }, ext: 'line' }, view)).toEqual([{ x: -30, y: 100 }, { x: 830, y: 100 }]);
    expect(clipStraight({ a: { x: 10000, y: 100 }, b: { x: 10001, y: 100 }, ext: 'ray' }, view)).toBeUndefined();
    const huge = clipStraight({ a: { x: -3.14159e120, y: 100 }, b: { x: 2.71828e120, y: 100 }, ext: 'segment' }, view);
    expect(huge?.every(p => p.x >= -30 && p.x <= 830 && p.y === 100)).toBe(true);
  });
  it('重复引用计算的显示名有展开上限，循环引用也不会无限递归', () => {
    const st = new Store(); let id = 0;
    st.run('计算链', () => {
      id = st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }).id;
      for (let i = 0; i < 40; i++) id = st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id }, b: { t: 'ref', id } }, unit: 'none' }).id;
    });
    expect(measureName(st.page, st.results, st.get(id)!)).toHaveLength(512);
    expect(st.results.get(id)?.shape).toMatchObject({ k: 'num', q: { v: 2 ** 40 } });
    st.run('循环', () => st.update(id, { k: 'calc', expr: { t: 'ref', id }, unit: 'none' }));
    expect(measureName(st.page, st.results, st.get(id)!)).toBe(`计算${id}`);
  });
  it('旧中文代码页的工具名和 UTF-8 工具名都可读，原始工具段保留', () => {
    for (const bytes of [new Uint8Array([0xb2, 0xe2, 0xca, 0xd4, 0]), new TextEncoder().encode('测试\0')]) {
      const body = concat([rec(1002), rec(1100, bytes), rec(1003)]);
      const tools = readTools(concat([new TextEncoder().encode('GSP4'), body]));
      expect(tools[0].name).toBe('测试');
      expect(Buffer.from(tools[0].data, 'base64')).toEqual(Buffer.from(body));
    }
  });

  it('坐标系输入可点原点或轴，线段输入接受变换后的线段但拒绝直线、点', () => {
    const st = new Store(); let sys = 0, seg = 0, moved = 0, line = 0;
    st.run('作图', () => {
      sys = createSystem(st).id;
      const a = st.add({ k: 'free', x: 100, y: 200 }).id, b = st.add({ k: 'free', x: 200, y: 300 }).id;
      seg = st.add({ k: 'seg', a, b }).id;
      moved = st.add({ k: 'translate', src: seg, by: { mode: 'vector', from: a, to: b } }).id;
      line = st.add({ k: 'line', a, b }).id;
    });
    const d = st.get(sys)!.def; if (d.k !== 'sys') throw Error();
    expect(toolInputFromHits('system', [d.origin], st.page, st.results, [])).toBe(sys);
    expect(toolInputFromHits('system', [d.axisX], st.page, st.results, [])).toBe(sys);
    expect(toolInputFromHits('system', [d.axisY], st.page, st.results, [sys])).toBeUndefined();
    expect(acceptsInput('segment', st.get(moved)!, st.results)).toBe(true);
    expect(acceptsInput('point', st.get(moved)!, st.results)).toBe(false);
    expect(acceptsInput('segment', st.get(line)!, st.results)).toBe(false);
    expect(acceptsInput('segment', st.get(d.origin)!, st.results)).toBe(false);
    for (const [c, k, kind] of [[1, 14, 'segment'], [1, 7, 'straight'], [1, 39, 'system'], [11, 49, 'number'], [11, 57, 'function']] as const) {
      expect(inputKindOf({ ...object(1, { k: 'unknown', note: '占位' }), src: { m: 0, c, k } })).toBe(kind);
    }
  });

  it('整批预映射保留按钮向前引用；类型错误在创建对象之前拒绝，撤销完整恢复', () => {
    const st = new Store();
    const input = st.run('输入', () => st.add({ k: 'free', x: 50, y: 80 }).id);
    const tool: Tool = { name: '向前引用', inputs: [{ index: 100, kind: 'point' }], objects: [
      object(100, { k: 'free', x: 0, y: 0 }),
      object(200, { k: 'button', action: { type: 'hideshow', targets: [300], mode: 'toggle' }, text: '显示', at: { x: 1, y: 1 }, w: 50, h: 20 }),
      object(300, { k: 'translate', src: 100, by: { mode: 'rect', dx: 1, dy: 2 } }),
    ] };
    const before = st.page.objects.length;
    st.run('工具', () => applyTool(st, tool, [input], () => ({ x: 10, y: 10 })));
    const [button, point] = st.page.objects.slice(-2);
    expect(button.def).toMatchObject({ action: { targets: [point.id] } });
    expect(st.results.get(button.id)?.status).toBe('ok');
    st.doUndo(); expect(st.page.objects).toHaveLength(before);
    expect(() => st.run('错误输入', () => applyTool(st, { ...tool, inputs: [{ index: 100, kind: 'number' }] }, [input], () => ({ x: 0, y: 0 })))).toThrow(/类型不符/);
    expect(st.page.objects).toHaveLength(before);
  });

  it('原版表达式的 π、e 和弧度单位能求值', () => {
    for (const [tokens, want, unit] of [[[13], Math.PI, 'none'], [[14], Math.E, 'none'], [[1, 0x100], 180 / Math.PI, 'angle']] as const) {
      const st = new Store(); st.run('计算', () => st.add({ k: 'calc', expr: { t: 'num', v: tokens.length === 1 ? 1 : 12 }, unit: 'none' }));
      const records = readRecords(encodeGsp(st.doc)).records;
      const bytes = concat([new TextEncoder().encode('GSP4'), ...records.map(r => {
        if (r.tag !== 2311) return r.raw;
        const d = r.data.slice(), v = new DataView(d.buffer);
        tokens.forEach((t, i) => v.setUint16(d.length - 2 * tokens.length + 2 * i, t, true));
        return rec(r.tag, d);
      })]);
      const back = decodeGsp(bytes).doc.pages[0];
      const s = new Store({ ...st.doc, pages: [back] }).results.get(back.objects[0].id)?.shape;
      expect(s?.k).toBe('num'); if (s?.k !== 'num') throw Error();
      expect(s.q.v).toBeCloseTo(want, 10); expect(s.q.u).toBe(unit);
    }
  });

  it('路径点按原版范围初始化一次，重算、撤销重做均不重新随机', () => {
    const line = { k: 'line' as const, s: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, ext: 'segment' as const } };
    let calls = 0; const values = [0.5, 0.25];
    expect(initialToolPathParameter(line, () => values[calls++])).toBeCloseTo(0.3);
    expect(calls).toBe(2);
    const st = new Store(); let circle = 0;
    st.run('输入', () => { const c = st.add({ k: 'free', x: 20, y: 30 }).id, p = st.add({ k: 'free', x: 120, y: 30 }).id; circle = st.add({ k: 'circle', c, p }).id; });
    const tool: Tool = { name: '路径点', inputs: [{ index: 1, kind: 'curve' }], objects: [object(1, { k: 'unknown', note: '占位' }), { ...object(2, { k: 'onpath', path: 1, t: 0 }), src: { m: 15, c: 1, k: 10, withParams: false } }] };
    st.run('工具', () => applyTool(st, tool, [circle], () => ({ x: 0, y: 0 }), { random: () => 0.5 }));
    const made = st.page.objects.at(-1)!;
    expect(made.def).toMatchObject({ k: 'onpath', t: Math.PI });
    expect(st.results.get(made.id)?.shape).toMatchObject({ k: 'pt', p: { x: -80 } });
    st.recompute(); st.doUndo(); st.doRedo();
    expect(st.get(made.id)?.def).toEqual(made.def);
  });

  it('文本载荷按字节读取尖括号、中文和插入对象；不重复输出占位回退文字', () => {
    const text = new TextEncoder().encode('<V<H<T2x<>><T6x测试>><H<?x1<T1x0>>>>');
    expect(readRichText(text, 1, 1)).toBe('<>测试\n0');
    expect(readRichText(new TextEncoder().encode('<H<?x2<T1x0>>>'), 1, 1)).toBeUndefined();
  });

  it('非附着插值文本和圆心弧上的点编码后保留内容与引用', () => {
    const st = new Store();
    st.run('构造', () => {
      const a = st.add({ k: 'free', x: 100, y: 100 }).id;
      const b = st.add({ k: 'free', x: 150, y: 100 }).id;
      const c = st.add({ k: 'free', x: 100, y: 150 }).id;
      const arc = st.add({ k: 'arc-center', c: a, a: b, b: c }).id;
      st.add({ k: 'onpath', path: arc, t: 0.25 });
      const n = st.add({ k: 'param', name: 't', value: 2, unit: 'none', showEdit: true }).id;
      st.add({ k: 'text', text: '数值：0\n第二行', at: { x: 20, y: 30 }, w: 100, h: 48, refs: [n], font: { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' } });
    });
    const decoded = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects;
    expect(decoded[4].def).toMatchObject({ k: 'onpath', path: decoded[3].id, t: 0.25 });
    expect(decoded[6].def).toMatchObject({ k: 'text', text: '数值：0\n第二行', refs: [decoded[5].id], at: { x: 20, y: 30 } });
  });

  it('距离轴与圆轴按各自父对象编码并读回', () => {
    const st = new Store();
    st.run('构造', () => {
      const a = st.add({ k: 'free', x: 100, y: 100 }).id;
      const b = st.add({ k: 'free', x: 150, y: 100 }).id;
      const seg = st.add({ k: 'seg', a, b }).id;
      const m = st.add({ k: 'measure', m: 'length', refs: [seg] }).id;
      const circle = st.add({ k: 'circle', c: a, p: b }).id;
      st.add({ k: 'axis-line', axis: 'x', mode: 'distance', origin: a, unit: m });
      st.add({ k: 'axis-line', axis: 'y', mode: 'circle', unit: circle });
      st.add({ k: 'axis-unit', axis: b, direction: 'y', distance: 50 });
    });
    const os = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects;
    expect(os[5].def).toEqual({ k: 'axis-line', axis: 'x', mode: 'distance', origin: os[0].id, unit: os[3].id });
    expect(os[6].def).toEqual({ k: 'axis-line', axis: 'y', mode: 'circle', unit: os[4].id });
    expect(os[7].def).toEqual({ k: 'axis-unit', axis: os[1].id, direction: 'y', distance: 50 });
  });

  it('变换线和弧交点依路径原象选用方法，保留分支和依赖', () => {
    const st = new Store();
    st.run('构造', () => {
      const a = st.add({ k: 'free', x: 100, y: 100 }).id;
      const b = st.add({ k: 'free', x: 150, y: 100 }).id;
      const c = st.add({ k: 'free', x: 100, y: 150 }).id;
      const seg = st.add({ k: 'seg', a, b }).id;
      const moved = st.add({ k: 'translate', src: seg, by: { mode: 'rect', dx: 1, dy: 0 } }).id;
      const arc = st.add({ k: 'arc-center', c: a, a: b, b: c }).id;
      st.add({ k: 'inter', a: moved, b: arc, branch: 1 });
    });
    const os = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects;
    expect(os[6].def).toMatchObject({ k: 'inter', a: os[4].id, b: os[5].id, branch: 1 });
  });

  it('着色保留数值范围并随参数重算，依赖的几何仍可用于后续构造', () => {
    const st = new Store(); let color = 0, value = 0;
    st.run('作图', () => {
      const p = st.add({ k: 'free', x: 80, y: 90 }).id;
      value = st.add({ k: 'param', name: 't', value: 0.5, unit: 'none', showEdit: true }).id;
      color = st.add({ k: 'colorize', src: p, params: [value], from: 0, to: 1, mode: 'gray', cycle: 'none' }).id;
      st.add({ k: 'seg', a: p, b: color });
    });
    expect(st.results.get(color)).toMatchObject({ status: 'ok', shape: { k: 'pt' }, color: '#808080' });
    st.run('参数', () => st.update(value, { k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }));
    expect(st.results.get(color)?.color).toBe('#ffffff');
    expect(remapDef({ k: 'colorize', src: 1, params: [2], from: 0, to: 1, mode: 'gray', cycle: 'none' }, new Map([[1, 9], [2, 8]]))).toMatchObject({ src: 9, params: [8], from: 0, to: 1 });
  });

  it('按长度定义的轴、混合轴坐标系和极坐标度量随长度变化', () => {
    const st = new Store(); let unit = 0, radius = 0, angle = 0, plotted = 0;
    st.run('作图', () => {
      const origin = st.add({ k: 'free', x: 100, y: 150 }).id;
      unit = st.add({ k: 'param', name: 'u', value: 2, unit: 'distance', showEdit: true }).id;
      const axisX = st.add({ k: 'axis-line', origin, unit, axis: 'x', mode: 'distance' }).id;
      const unitY = st.add({ k: 'axis-unit', axis: axisX, direction: 'y' }).id;
      const axisY = st.add({ k: 'line', a: origin, b: unitY }).id;
      const sys = st.add({ k: 'sys', origin, unitX: unit, unitY, axisX, axisY, grid: 'square', showGrid: true, snap: false }).id;
      const r = st.add({ k: 'param', name: 'r', value: 3, unit: 'none', showEdit: true }).id;
      const a = st.add({ k: 'param', name: 'a', value: 90, unit: 'angle', showEdit: true }).id;
      plotted = st.add({ k: 'plotxy', x: r, y: a, sys, polar: true }).id;
      radius = st.add({ k: 'measure', m: 'coordradius', refs: [plotted, sys] }).id;
      angle = st.add({ k: 'measure', m: 'coordangle', refs: [plotted, sys] }).id;
    });
    const radiusShape = st.results.get(radius)?.shape, angleShape = st.results.get(angle)?.shape;
    expect(radiusShape?.k).toBe('num'); expect(angleShape?.k).toBe('num');
    if (radiusShape?.k !== 'num' || angleShape?.k !== 'num') throw Error();
    expect(radiusShape.q.v).toBeCloseTo(3); expect(angleShape.q.v).toBeCloseTo(90);
    const y = (st.results.get(plotted)?.shape as { p: { y: number } }).p.y;
    st.run('尺度', () => st.update(unit, { k: 'param', name: 'u', value: 4, unit: 'distance', showEdit: true }));
    expect((st.results.get(plotted)?.shape as { p: { y: number } }).p.y).toBeCloseTo(150 + 2 * (y - 150));
  });

  it('自定义变换替换前像，不改动原构造；射线取前方最近的多边形边界交点', () => {
    const st = new Store(); let source = 0, pre = 0, image = 0, transformed = 0, inter = 0;
    st.run('作图', () => {
      pre = st.add({ k: 'free', x: 0, y: 0 }).id;
      image = st.add({ k: 'translate', src: pre, by: { mode: 'rect', dx: 1, dy: 0 } }).id;
      source = st.add({ k: 'free', x: 100, y: 120 }).id;
      transformed = st.add({ k: 'custom-point', src: source, pre, img: image, body: [image] }).id;
      const p = [[10, -10], [20, -10], [20, 10], [10, 10]].map(([x, y]) => st.add({ k: 'free', x, y }).id);
      const poly = st.add({ k: 'poly', pts: p }).id;
      const ray = st.add({ k: 'ray', a: pre, b: p[2] }).id;
      inter = st.add({ k: 'inter', a: ray, b: poly, branch: 0 }).id;
    });
    expect(st.results.get(transformed)?.shape).toMatchObject({ k: 'pt', p: { y: 120 } });
    expect((st.results.get(transformed)?.shape as { p: { x: number } }).p.x).toBeCloseTo(100 + 96 / 2.54);
    expect(st.results.get(pre)?.shape).toMatchObject({ k: 'pt', p: { x: 0, y: 0 } });
    expect(st.results.get(inter)?.shape).toMatchObject({ k: 'pt', p: { x: 10, y: 5 } });
    expect(remapDef({ k: 'custom-point', src: source, pre, img: image, body: [image] }, new Map([[pre, 99]]))).toHaveProperty('pre', 99);
  });
});
