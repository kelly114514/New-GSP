import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PageGeometryEvaluator, evaluatePageGeometry, parseGsp, readDocumentModel, readU32, writeGsp, writeU16, writeU32 } from '../src/index';
import type { ContainerModel, EvaluatedObject, Geometry, ObjectInfo, XY } from '../src/index';
import { baselineSamplesDir, corpusAvailable, corpusFiles, readBytes } from './support';

const baseline = () => readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp'))));
const base = baseline().pages[0]!;
function point(index: number, x: number, y: number): ObjectInfo {
  const template = base.objects[0]!, payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  view.setFloat64(0, x, true); view.setFloat64(8, y, true);
  return { ...template, index, node: { ...template.node, records: [{ kind: 2201, payload, pad: 0 }] } };
}
function object(index: number, constraintId: number, parents: number[], genera = 4, payload?: Uint8Array): ObjectInfo {
  const template = base.objects[2]!;
  return { ...template, index, constraintId, parents, genera, node: { ...template.node, records: payload === undefined ? [] : [{ kind: 2003, payload, pad: 0 }] } };
}
function parameter(id: number, fields: Array<[number, number]>): Uint8Array {
  const size = id === 17 ? 52 : id === 21 ? 60 : id === 18 || id === 19 || id === 23 ? 28 : id === 24 || id === 27 ? 36 : 12;
  const payload = new Uint8Array(size).fill(0xa7);
  const view = new DataView(payload.buffer);
  view.setUint32(0, id, true);
  fields.forEach(([offset, value]) => view.setFloat64(offset, value, true));
  return payload;
}
/** 32 字节 2307 前缀；+28 是对象自己的小数位数。 */
function measurePrefix(digits = 2): Uint8Array {
  const payload = new Uint8Array(32).fill(0);
  new DataView(payload.buffer).setUint16(28, digits, true);
  return payload;
}
function measure(index: number, constraintId: number, parents: number[], genera = 48): ObjectInfo {
  const template = base.objects[2]!;
  return { ...template, index, constraintId, parents, genera, node: { ...template.node, records: [{ kind: 2307, payload: measurePrefix(), pad: 0 }] } };
}
function expression(tokens: readonly number[]): Uint8Array {
  const payload = new Uint8Array(92 + 2 * tokens.length), view = new DataView(payload.buffer);
  view.setUint16(28, 2, true);
  view.setUint32(32, 2311, true);
  view.setUint32(36, payload.length - 32, true);
  view.setUint32(40, 48, true);
  view.setUint16(44, tokens.length, true);
  view.setUint16(46, 4, true);
  tokens.forEach((token, i) => view.setUint16(92 + 2 * i, token, true));
  return payload;
}
function calc(index: number, tokens: readonly number[], parents: number[], genera: number): ObjectInfo {
  const template = base.objects[2]!;
  return { ...template, index, constraintId: 48, parents, genera, node: { ...template.node, records: [{ kind: 2311, payload: expression(tokens), pad: 0 }] } };
}
function freeNumber(index: number, tokens: readonly number[], genera: number): ObjectInfo {
  const template = base.objects[2]!;
  return { ...template, index, constraintId: 0, mainKind: 11, parents: [], genera, node: { ...template.node, records: [{ kind: 2311, payload: expression(tokens), pad: 0 }] } };
}
function path(index: number, parent: number, genera: number, ...values: number[]): ObjectInfo {
  const payload = new Uint8Array(4 + 8 * values.length), view = new DataView(payload.buffer);
  view.setUint16(0, 15, true); view.setUint16(2, genera, true);
  values.forEach((value, i) => view.setFloat64(4 + 8 * i, value, true));
  return object(index, 15, [parent], 10, payload);
}
const page = (...objects: ObjectInfo[]): ContainerModel => ({
  ...base,
  objects,
  // 厘米 / 度页面：数值的显示单位与基准单位不同，量值来源才区分得开。
  numericPreferences: { distanceUnit: 1, angleUnit: 1, dpi: 96 },
});
const find = (p: ContainerModel, index: number): EvaluatedObject => evaluatePageGeometry(p).objects.find((o) => o.objectIndex === index)!;
function geometry(result: EvaluatedObject): Geometry {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}
function close(actual: readonly number[], expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
}
function pointClose(result: EvaluatedObject, expected: XY): void {
  const g = geometry(result);
  if (g.kind !== 'point') throw new Error('expected point');
  close([g.geometry.x, g.geometry.y], expected);
}

// Three landmarks P=(2,3), A=(7,3), B=(2,-2) define every supported source shape.
const sources = [
  point(1, 2, 3), point(2, 7, 3), point(3, 2, -2),
  object(10, 2, [1, 2], 14), object(11, 63, [1, 2], 12), object(12, 64, [1, 2], 13),
  object(13, 3, [1, 2], 28), object(14, 80, [1, 2, 3], 67), object(15, 8, [1, 2, 3], 52),
  object(16, 10, [13], 16), object(17, 82, [14], 68), object(18, 83, [14], 69),
];
const parameters = [
  point(100, 10, 20), point(101, 0, 0), point(102, 4, 0), point(103, -2, 0), point(104, 0, -4),
  object(105, 2, [101, 102], 14), object(200, 48, []),
  // 数值父：113 是 10 px 长线段的长度度量，114 是 4 px；120 是 +90° 的三点角；121 是无量纲 −2 参数。
  point(110, 0, 0), point(111, 10, 0), object(112, 2, [110, 111], 14),
  measure(113, 36, [112]), measure(114, 36, [105]), measure(120, 41, [102, 101, 104], 49),
  freeNumber(121, [0x1001, 2], 51),
];
const cases: Array<{ id: number; parents: number[]; payload?: Uint8Array; p: XY; a: XY; b: XY; radius: number; sweep: number }> = [
  { id: 16, parents: [101, 102], p: [6, 3], a: [11, 3], b: [6, -2], radius: 5, sweep: Math.PI / 2 },
  { id: 17, parents: [], payload: parameter(17, [[4, 5], [24, 7]]), p: [7, -4], a: [12, -4], b: [7, -9], radius: 5, sweep: Math.PI / 2 },
  // 18: 固定水平 5 px + 父 113 的 10 px 向上；19: 固定垂直 7 px 向上 + 父 113 的 10 px 向右；
  // 20: 父 113 水平 10 px + 父 114 垂直 4 px。
  { id: 18, parents: [113], payload: parameter(18, [[4, 5]]), p: [7, -7], a: [12, -7], b: [7, -12], radius: 5, sweep: Math.PI / 2 },
  { id: 19, parents: [113], payload: parameter(19, [[4, 7]]), p: [12, -4], a: [17, -4], b: [12, -9], radius: 5, sweep: Math.PI / 2 },
  { id: 20, parents: [113, 114], p: [12, -1], a: [17, -1], b: [12, -6], radius: 5, sweep: Math.PI / 2 },
  { id: 21, parents: [], payload: parameter(21, [[4, -1], [12, 0], [32, 8]]), p: [2, -5], a: [7, -5], b: [2, -10], radius: 5, sweep: Math.PI / 2 },
  // 23: 固定 8 px、父 120 的 +90°；24: 固定 90°、父 113 的 10 px；25: ∠cde 为 +90°、父 114 的 4 px。
  { id: 23, parents: [120], payload: parameter(23, [[4, 8]]), p: [2, -5], a: [7, -5], b: [2, -10], radius: 5, sweep: Math.PI / 2 },
  { id: 24, parents: [113], payload: parameter(24, [[4, -1], [12, 0]]), p: [2, -7], a: [7, -7], b: [2, -12], radius: 5, sweep: Math.PI / 2 },
  { id: 25, parents: [102, 101, 104, 114], p: [2, -1], a: [7, -1], b: [2, -6], radius: 5, sweep: Math.PI / 2 },
  // 26: 父 120 的方向 + 父 113 的 10 px。
  { id: 26, parents: [120, 113], p: [2, -7], a: [7, -7], b: [2, -12], radius: 5, sweep: Math.PI / 2 },
  { id: 27, parents: [100], payload: parameter(27, [[4, -1], [12, 0]]), p: [-7, 28], a: [-7, 23], b: [-12, 28], radius: 5, sweep: Math.PI / 2 },
  { id: 28, parents: [100, 102, 101, 104], p: [-7, 28], a: [-7, 23], b: [-12, 28], radius: 5, sweep: Math.PI / 2 },
  { id: 29, parents: [100, 120], p: [-7, 28], a: [-7, 23], b: [-12, 28], radius: 5, sweep: Math.PI / 2 },
  { id: 30, parents: [100], payload: parameter(30, [[4, -2]]), p: [26, 54], a: [16, 54], b: [26, 64], radius: 10, sweep: Math.PI / 2 },
  // 31: k = |112|/|105| = 10/4 = 2.5；33: 父 121 的 −2。
  { id: 31, parents: [100, 112, 105], p: [-10, -22.5], a: [2.5, -22.5], b: [-10, -35], radius: 12.5, sweep: Math.PI / 2 },
  { id: 32, parents: [100, 101, 102, 103], p: [14, 28.5], a: [11.5, 28.5], b: [14, 31], radius: 2.5, sweep: Math.PI / 2 },
  { id: 33, parents: [100, 121], p: [26, 54], a: [16, 54], b: [26, 64], radius: 10, sweep: Math.PI / 2 },
  { id: 34, parents: [105], p: [2, -3], a: [7, -3], b: [2, 2], radius: 5, sweep: -Math.PI / 2 },
  { id: 75, parents: [200], p: [2, 3], a: [7, 3], b: [2, -2], radius: 5, sweep: Math.PI / 2 },
];

describe('M4 transformations across existing geometry', () => {
  for (const c of cases) for (const index of [1, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
    it(`constraint ${c.id}, source ${index}: preserves shape, landmark order and directed sweep`, () => {
      const source = sources.find((o) => o.index === index)!;
      const result = find(page(...sources, ...parameters, object(300, c.id, [index, ...c.parents], source.genera, c.payload)), 300);
      const g = geometry(result);
      expect(result.objectIndex).toBe(300);
      if (g.kind === 'point') close([g.geometry.x, g.geometry.y], c.p);
      else if (g.kind === 'segment' || g.kind === 'line' || g.kind === 'ray') {
        close(g.geometry.a, c.p); close(g.geometry.b, c.a);
        expect(g.parameterizationKnown).toBe(true);
      } else if (g.kind === 'polygon') {
        expect(g.geometry.vertices).toHaveLength(3);
        g.geometry.vertices.forEach((v, i) => close(v, [c.p, c.a, c.b][i]!));
      } else if (g.kind === 'measure' || g.kind === 'coordinate-system') {
        throw new Error('a transform must produce drawable geometry');
      } else {
        close(g.geometry.center, c.p); expect(g.geometry.radius).toBeCloseTo(c.radius, 9);
        if (g.kind === 'arc' || g.kind === 'sector' || g.kind === 'circular-segment') {
          close(g.geometry.start!, c.a); close(g.geometry.end!, c.b);
          expect(g.geometry.sweepAngle).toBeCloseTo(c.sweep, 9);
        }
      }
      const before = geometry(find(page(...sources), index));
      expect(g.kind).toBe(before.kind);
    });
  }
  it('uses the whole support line as a mirror and preserves repeated polygon vertices', () => {
    const p = page(...sources, ...parameters, object(250, 8, [1, 2, 1]), object(300, 34, [250, 105]));
    expect(find(p, 300)).toMatchObject({ kind: 'polygon', geometry: { vertices: [[2, -3], [7, -3], [2, -3]] } });
    // x=7 is beyond the mirror segment [0,4], yet reflection is still defined.
    pointClose(find(page(...sources, ...parameters, object(300, 34, [2, 105])), 300), [7, -3]);
  });
  it('does not reinterpret pixel/direction fields using display values or unit codes; preserves residual bytes', () => {
    const model = baseline(), pg = model.pages[0]!;
    const node = pg.objects[3]!.node, payload = parameter(17, [[4, 5], [12, 99999], [24, 7], [32, -99999]]);
    writeU16(node.begin.payload, 0, 17);
    const parents = new Uint8Array(8); writeU32(parents, 0, 1); writeU32(parents, 4, 1);
    node.records = [{ kind: 2002, payload: parents, pad: 0 }, { kind: 2003, payload, pad: 0 }];
    const bytes = writeGsp(model.doc), decoded = readDocumentModel(parseGsp(bytes));
    pointClose(find(decoded.pages[0]!, 4), [216, 140]);
    expect(writeGsp(decoded.doc)).toEqual(bytes);
    expect(decoded.pages[0]!.objects[3]!.node.records[1]!.payload).toEqual(payload);
  });
});

describe('transform boundaries and dependency updates', () => {
  it('identity translations, zero rotation and unit scale remain present', () => {
    for (const image of [object(300, 16, [1, 101, 101]), object(300, 17, [1], 4, parameter(17, [[4, 0], [24, 0]])), object(300, 27, [1, 100], 4, parameter(27, [[4, 0], [12, 1]])), object(300, 30, [1, 100], 4, parameter(30, [[4, 1]]))]) {
      pointClose(find(page(...sources, ...parameters, image), 300), [2, 3]);
    }
  });
  it('keeps unknown zero-scale and noncollinear ratio boundaries unsupported', () => {
    expect(find(page(...sources, ...parameters, object(300, 30, [1, 100], 4, parameter(30, [[4, 0]]))), 300)).toMatchObject({ status: 'unsupported', reason: 'zero-scale-existence-unverified' });
    expect(find(page(...sources, ...parameters, object(300, 32, [1, 100, 101, 102, 104])), 300)).toMatchObject({ status: 'unsupported', reason: 'three-point-ratio-noncollinear-unverified' });
  });
  it('undefined angle and distance ratio are nonexistent; malformed native fields stay explicit', () => {
    expect(find(page(...sources, ...parameters, object(300, 28, [1, 100, 101, 101, 104])), 300)).toMatchObject({ status: 'not-existing', reason: 'zero-angle-arm' });
    expect(find(page(...sources, ...parameters, object(300, 32, [1, 100, 101, 101, 103])), 300)).toMatchObject({ status: 'not-existing', reason: 'zero-ratio-denominator' });
    for (const payload of [undefined, new Uint8Array(12), parameter(27, [[4, 0], [12, 0]])]) {
      expect(find(page(...sources, ...parameters, object(300, 27, [1, 100], 4, payload)), 300)).toMatchObject({ status: 'unsupported' });
    }
    expect(find(page(...sources, ...parameters, object(300, 17, [1], 4, parameter(17, [[4, Infinity], [24, 0]]))), 300)).toMatchObject({ status: 'not-existing', reason: 'non-finite-transform-parameter' });
  });
  it('measured parameter transforms propagate a failed numeric parent instead of inventing a value', () => {
    const slots: Record<number, number[]> = {
      18: [1, 200], 19: [1, 200], 20: [1, 200, 200], 23: [1, 200], 24: [1, 200],
      25: [1, 102, 101, 104, 200], 26: [1, 200, 200], 29: [1, 100, 200], 31: [1, 100, 200, 200], 33: [1, 100, 200],
    };
    for (const id of [18, 19, 20, 23, 24, 25, 26, 29, 31, 33]) {
      const parents = slots[id]!;
      expect(find(page(...sources, ...parameters, object(300, id, parents)), 300)).toMatchObject({ status: 'unsupported', exists: null, reason: 'parent:200:unsupported' });
      // 不存在的数值父（退化线段上的长度度量）同样向上传播。
      expect(find(page(...sources, ...parameters, object(401, 2, [101, 101], 14), measure(400, 36, [401]), object(402, id, [1, 400])), 402))
        .toMatchObject({ status: 'not-existing', reason: 'parent:400:not-existing' });
    }
  });
  it('uses every documented numeric parent type in base units', () => {
    // 48 计算值：10 厘米 = 96/2.54*10 px，父 18 的垂直位移就该是 377.95 px（显示值是 10）。
    const centimeters = calc(130, [1, 0, 0x0201], [], 48);
    pointClose(find(page(...sources, ...parameters, centimeters, object(300, 18, [1, 130], 4, parameter(18, [[4, 0]]))), 300), [2, 3 - (960 / 2.54)]);
    // 48 计算的 90 度：绕中心 (10,20) 逆时针转 90 度，与 27/29 的固定角一致。
    const degrees = calc(131, [9, 0, 0x0101], [], 49);
    pointClose(find(page(...sources, ...parameters, degrees, object(300, 29, [1, 100, 131])), 300), [-7, 28]);
    // 47 比值度量（10 px / 4 px = 2.5）与 31 的两线段之比是同一个 k。
    const ratio = measure(132, 47, [112, 105], 51);
    pointClose(find(page(...sources, ...parameters, ratio, object(300, 33, [1, 100, 132])), 300), [-10, -22.5]);
  });
  it('rejects a numeric parent whose dimension is not the one the card requires', () => {
    const unitless = freeNumber(150, [3], 51), length = calc(151, [1, 0, 0x0201], [], 48), angle = calc(152, [9, 0, 0x0101], [], 49);
    const wrong = 'numeric-parameter-dimension-unverified';
    const run = (id: number, parents: number[], payload?: Uint8Array) =>
      find(page(...sources, ...parameters, unitless, length, angle, object(300, id, parents, 4, payload)), 300);
    // 24 / 18 / 19 / 20 / 25 / 26 的距离槽：无单位或角度量都不行。
    expect(run(24, [1, 150], parameter(24, [[4, -1], [12, 0]]))).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(24, [1, 152], parameter(24, [[4, -1], [12, 0]]))).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(18, [1, 150], parameter(18, [[4, 5]]))).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(19, [1, 152], parameter(19, [[4, 7]]))).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(20, [1, 151, 150])).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(25, [1, 102, 101, 104, 150])).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(26, [1, 152, 150])).toMatchObject({ status: 'unsupported', reason: wrong });
    // 角度槽：23 / 26 / 29 不接受无单位数或长度。
    expect(run(23, [1, 150], parameter(23, [[4, 8]]))).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(26, [1, 151, 151])).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(29, [1, 100, 150])).toMatchObject({ status: 'unsupported', reason: wrong });
    expect(run(29, [1, 100, 151])).toMatchObject({ status: 'unsupported', reason: wrong });
    // 33 的比值必须是无量纲：长度不行。
    expect(run(33, [1, 100, 151])).toMatchObject({ status: 'unsupported', reason: wrong });
    // 正确量纲照常出几何。
    pointClose(run(24, [1, 151], parameter(24, [[4, -1], [12, 0]])), [2, 3 - 960 / 2.54]);
    pointClose(run(29, [1, 100, 152]), [-7, 28]);
    pointClose(run(33, [1, 100, 150]), [-14, -31]);
  });
  it('keeps the unverified zero-scale boundary for numeric ratios', () => {
    expect(find(page(...sources, ...parameters, freeNumber(140, [0], 51), object(300, 33, [1, 100, 140])), 300))
      .toMatchObject({ status: 'unsupported', reason: 'zero-scale-existence-unverified' });
  });
  it('missing sources remain nonexistent, and dynamic color does not replace source identity/geometry', () => {
    expect(find(page(...parameters, object(300, 75, [999, 200])), 300)).toMatchObject({ status: 'not-existing', reason: 'missing-parent:999' });
    const result = find(page(...sources, ...parameters, object(300, 75, [1, 200])), 300);
    expect(result).toMatchObject({ objectIndex: 300, constraintId: 75, kind: 'point', geometry: { x: 2, y: 3 } });
  });
  it('ancestor dragging recomputes a transform chain and its path points; unavailable geometry recovers', () => {
    const p = page(...sources, ...parameters, object(300, 16, [14, 101, 102], 67), object(301, 34, [300, 105], 67), path(302, 301, 67, 0.5), point(400, 900, 900));
    const evaluator = new PageGeometryEvaluator(p);
    pointClose(evaluator.evaluate().objects.find((o) => o.objectIndex === 302)!, [6 + 5 * Math.SQRT1_2, -3 + 5 * Math.SQRT1_2]);
    const payload = p.objects.find((o) => o.index === 102)!.node.records[0]!.payload;
    new DataView(payload.buffer).setFloat64(0, 0, true); // Mirror collapses; vector translation becomes identity.
    evaluator.invalidate(102);
    expect(evaluator.evaluate().objects.find((o) => o.objectIndex === 302)).toMatchObject({ status: 'not-existing' });
    new DataView(payload.buffer).setFloat64(0, 8, true);
    evaluator.invalidate(102);
    const after = evaluator.evaluate();
    pointClose(after.objects.find((o) => o.objectIndex === 302)!, [10 + 5 * Math.SQRT1_2, -3 + 5 * Math.SQRT1_2]);
    // 114 与 120 是挂在被拖点上的度量，跟着点一起失效；无关对象不重算。
    expect(evaluator.recomputedIndices.sort((a, b) => a - b)).toEqual([102, 105, 114, 120, 300, 301, 302]);
    expect(evaluator.recomputedIndices).not.toContain(400);
  });
  it('path points use the transformed endpoints/circle, not transformed storage parameters', () => {
    const p = page(...sources, ...parameters, object(300, 27, [10, 100], 14, parameter(27, [[4, -1], [12, 0]])), path(301, 300, 14, 0.25), object(302, 27, [13, 100], 28, parameter(27, [[4, -1], [12, 0]])), path(303, 302, 28, 1, 0));
    pointClose(find(p, 301), [-7, 26.75]);
    pointClose(find(p, 303), [-2, 28]);
  });
});

describe('perpendicular / parallel native path bases', () => {
  for (const id of [5, 6]) it(`constraint ${id} keeps t=.5 at P and inherits the full source vector`, () => {
    const genus = id === 5 ? 47 : 46;
    const p = page(point(1, 2, 4), point(2, 8, 12), object(3, 2, [1, 2], 14), point(4, 20, 30), object(5, id, [4, 3], genus), path(6, 5, genus, 0), path(7, 5, genus, 0.5), path(8, 5, genus, 1));
    pointClose(find(p, 6), id === 5 ? [24, 27] : [17, 26]);
    pointClose(find(p, 7), [20, 30]);
    pointClose(find(p, 8), id === 5 ? [16, 33] : [23, 34]);
  });
});

describe('corpus: numeric transform payloads match the card layouts', () => {
  it.skipIf(!corpusAvailable())('18/19/23 are 28 bytes, 24 is 36 bytes, and 24 stores a unit direction', () => {
    const sizes = new Map([[18, 28], [19, 28], [23, 28], [24, 36]]);
    let seen = 0;
    for (const file of corpusFiles()) {
      const model = readDocumentModel(parseGsp(readBytes(file)));
      for (const pg of model.pages) for (const o of pg.objects) {
        const size = sizes.get(o.constraintId);
        if (size === undefined) continue;
        const payload = o.node.records.find((r) => r.kind === 2003)?.payload;
        expect(payload?.length).toBe(size);
        expect(readU32(payload!, 0)).toBe(o.constraintId);
        if (o.constraintId === 24) {
          const view = new DataView(payload!.buffer, payload!.byteOffset, payload!.byteLength);
          const a = view.getFloat64(4, true), b = view.getFloat64(12, true);
          expect(Math.hypot(a, b)).toBeCloseTo(1, 9);
          // 存档角度可能比方向对多出 360° 的整数倍（语料里有 9090°）；几何只信方向对，和 21/27 一致。
          const stored = view.getUint32(28, true) === 0 ? view.getFloat64(20, true) * 180 / Math.PI : view.getFloat64(20, true);
          const computed = Math.atan2(-a, b) * 180 / Math.PI;
          const wrapped = Math.abs(((computed - stored) % 360 + 540) % 360 - 180);
          expect(wrapped).toBeLessThan(1e-6);
        }
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(4000);
  }, 120_000);
});
