import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { evaluateMeasure, evaluatePageGeometry, PageGeometryEvaluator, parseGsp, readDocumentModel, writeGsp } from '../src/index';
import type { ContainerModel, EvaluatedObject, Geometry, ObjectInfo, PageGeometry } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';

const base = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp')))).pages[0]!;
type RecordData = { kind: number; payload: Uint8Array; pad: number };
function record(kind: number, payload: Uint8Array): RecordData { return { kind, payload, pad: 0 }; }
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(2 * values.length), view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v, true));
  return bytes;
}
function obj(index: number, id: number, parents: number[], records: RecordData[] = []): ObjectInfo {
  const [mainKind, genera] = id === 0 ? [1, 4] : id === 52 || id === 54 ? [1, 40]
    : id === 61 ? [8, 39] : id === 69 ? [1, 56] : [58, 59, 60].includes(id) ? [9, 38] : [7, 51];
  return { ...base.objects[0]!, index, constraintId: id, mainKind: mainKind!, genera: genera!, parents,
    freePoint: undefined, node: { ...base.objects[0]!.node, records } };
}
function pt(index: number, x: number, y: number): ObjectInfo {
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  view.setFloat64(0, x, true); view.setFloat64(8, y, true);
  return obj(index, 0, [], [record(2201, bytes)]);
}
function unit(index: number, id: number, parent: number, size: number): ObjectInfo {
  const bytes = new Uint8Array(12), view = new DataView(bytes.buffer);
  view.setUint16(0, id, true); view.setFloat64(4, size, true);
  return obj(index, id, [parent], [record(2003, bytes)]);
}
function axisPoint(index: number, parent: number, t: number, genera = 38): ObjectInfo {
  const bytes = new Uint8Array(12), view = new DataView(bytes.buffer);
  view.setUint16(0, 15, true); view.setUint16(2, genera, true); view.setFloat64(4, t, true);
  return { ...obj(index, 15, [parent], [record(2003, bytes)]), mainKind: 1, genera: 10 };
}
function prefix(digits = 2): Uint8Array {
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  view.setUint16(16, 3, true); bytes.set([60, 48, 62], 18); view.setUint16(28, digits, true);
  return bytes;
}
function numeric(index: number, tokens: number[], digits = 0): ObjectInfo {
  const bytes = new Uint8Array(92 + 2 * tokens.length), view = new DataView(bytes.buffer);
  bytes.set(prefix(digits)); view.setUint32(32, 2311, true); view.setUint32(36, bytes.length - 32, true);
  view.setUint32(40, 48, true); view.setUint16(44, tokens.length, true); view.setUint16(46, 4, true);
  bytes.set(words(...tokens), 92);
  return { ...obj(index, 0, [], [record(2311, bytes)]), mainKind: 11, genera: 79 };
}
function measure(index: number, id: number, parents: number[], digits = 2): ObjectInfo {
  return obj(index, id, parents, [record(2307, prefix(digits))]);
}
function axis(index: number, id: number, parents: number[], direction: number, extra?: number): ObjectInfo {
  return obj(index, id, parents, [record(2309, extra === undefined ? words(direction) : words(direction, extra))]);
}
function system(index: number, x: number, y: number, mode = 1, extended = false): ObjectInfo {
  return obj(index, 61, [x, y], [record(2308, extended ? words(mode, 500, 600, 700) : words(mode))]);
}
function page(objects: ObjectInfo[]): ContainerModel { return { ...base, objects, numericPreferences: { distanceUnit: 1, angleUnit: 1, dpi: 96 } }; }
function result(evaluation: PageGeometry, index: number): EvaluatedObject { return evaluation.objects.find((o) => o.objectIndex === index)!; }
function square(): ObjectInfo[] {
  return [pt(1, 100, 200), unit(2, 52, 1, 10), unit(3, 54, 2, 37),
    axis(4, 58, [1, 2], 1, 1), axis(5, 58, [1, 3], 0), system(6, 4, 5),
    numeric(7, [0x1001, 2]), numeric(8, [3, 10, 5]), obj(9, 69, [7, 8, 6]),
    measure(10, 65, [9, 6], 4), measure(11, 66, [9, 6], 4)];
}
function magnitude(evaluation: PageGeometry, index: number): number {
  const r = result(evaluation, index);
  if (r.status !== 'ok' || r.kind !== 'measure') throw new Error(JSON.stringify(r));
  return r.measurement.internal.magnitude;
}

describe('rectangular coordinate geometry and numeric values', () => {
  it('uses the parent 52 length for 54, positive y upward, and unrounded native X/Y parent order', () => {
    const evaluated = evaluatePageGeometry(page(square()));
    expect(result(evaluated, 2)).toMatchObject({ status: 'ok', kind: 'point', geometry: { x: 110, y: 200 } });
    expect(result(evaluated, 3)).toMatchObject({ status: 'ok', kind: 'point', geometry: { x: 100, y: 190 } });
    expect(result(evaluated, 4)).toMatchObject({ kind: 'line', geometry: { a: [0, 200], b: [200, 200] }, parameterizationKnown: true, axis: { direction: 'horizontal', origin: [100, 200], unit: [10, 0] } });
    expect(result(evaluated, 5)).toMatchObject({ kind: 'line', geometry: { a: [100, 100], b: [100, 300] }, parameterizationKnown: true, axis: { direction: 'vertical', origin: [100, 200], unit: [0, -10] } });
    expect(result(evaluated, 6)).toMatchObject({ kind: 'coordinate-system', status: 'ok', exists: true, geometry: { origin: [100, 200], u: [10, 0], v: [0, -10] } });
    expect(result(evaluated, 9)).toMatchObject({ kind: 'point', geometry: { x: 80, y: 165 } });
    expect(magnitude(evaluated, 10)).toBe(-2); expect(magnitude(evaluated, 11)).toBe(3.5);
    expect(result(evaluated, 11)).toMatchObject({ measurement: { displayNumber: '3.5000', displayUnitText: '' } });
  });

  it.each([0, 1, 2] as const)('keeps coordinates and point values independent of display unit code %i', (code) => {
    const p = page(square()); p.numericPreferences = { distanceUnit: code, angleUnit: code, dpi: 96 };
    const evaluated = evaluatePageGeometry(p);
    expect(result(evaluated, 9)).toMatchObject({ kind: 'point', geometry: { x: 80, y: 165 } });
    expect(magnitude(evaluated, 11)).toBe(3.5);
  });

  it('supports different axis units and computes distance in coordinate space', () => {
    const objects = [pt(1, 100, 200), pt(2, 120, 200), pt(3, 100, 190), axis(4, 58, [1, 2], 1), axis(5, 58, [1, 3], 0),
      system(6, 4, 5, 2, true), pt(7, 140, 170), pt(8, 60, 180), measure(9, 65, [7, 6]), measure(10, 66, [7, 6]), measure(11, 86, [7, 8, 6], 5)];
    const evaluated = evaluatePageGeometry(page(objects));
    expect(magnitude(evaluated, 9)).toBe(2); expect(magnitude(evaluated, 10)).toBe(3);
    expect(magnitude(evaluated, 11)).toBeCloseTo(4.1231056256, 9);
  });

  it('takes ordinary segment px length and unrounded length measurement magnitude as 59 unit', () => {
    const objects = [pt(1, 100, 200), pt(2, 196, 200), obj(3, 2, [1, 2]), measure(4, 37, [1, 2], 0),
      axis(5, 59, [1, 3], 1), axis(6, 59, [1, 4], 0, 1)];
    const evaluated = evaluatePageGeometry(page(objects));
    expect(result(evaluated, 4)).toMatchObject({ measurement: { displayValue: 3, internal: { magnitude: 96 } } });
    expect(result(evaluated, 5)).toMatchObject({ kind: 'line', geometry: { a: [0, 200], b: [200, 200] }, parameterizationKnown: true, axis: { origin: [100, 200], unit: [96, 0] } });
    expect(result(evaluated, 6)).toMatchObject({ kind: 'line', geometry: { a: [100, 100], b: [100, 300] }, parameterizationKnown: false, axis: { origin: [100, 200], unit: [0, -96] } });
  });

  it('uses the circle center and radius for both 60 axis directions', () => {
    const objects = [pt(1, 20, 30), pt(2, 20, 55), obj(3, 3, [1, 2]), axis(4, 60, [3], 1), axis(5, 60, [3], 0)];
    const evaluated = evaluatePageGeometry(page(objects));
    expect(result(evaluated, 4)).toMatchObject({ kind: 'line', geometry: { a: [-80, 30], b: [120, 30] }, parameterizationKnown: false, axis: { origin: [20, 30], unit: [25, 0] } });
    expect(result(evaluated, 5)).toMatchObject({ kind: 'line', geometry: { a: [20, -70], b: [20, 130] }, parameterizationKnown: false, axis: { origin: [20, 30], unit: [0, -25] } });
  });

  it('recomputes descendants when origin, unit length, or number parent changes', () => {
    const objects = square(), evaluator = new PageGeometryEvaluator(page(objects)); evaluator.evaluate();
    new DataView(objects[1]!.node.records[0]!.payload.buffer).setFloat64(4, 20, true);
    evaluator.invalidate(2);
    let evaluated = evaluator.evaluate();
    expect(result(evaluated, 3)).toMatchObject({ geometry: { x: 100, y: 180 } });
    expect(result(evaluated, 9)).toMatchObject({ geometry: { x: 60, y: 130 } });
    expect(magnitude(evaluated, 11)).toBe(3.5);
    new DataView(objects[0]!.node.records[0]!.payload.buffer).setFloat64(0, 150, true);
    evaluator.invalidate(1); evaluated = evaluator.evaluate();
    expect(result(evaluated, 9)).toMatchObject({ geometry: { x: 110, y: 130 } });
    new DataView(objects[6]!.node.records[0]!.payload.buffer).setUint16(94, 3, true);
    evaluator.invalidate(7); evaluated = evaluator.evaluate();
    expect(result(evaluated, 9)).toMatchObject({ geometry: { x: 90, y: 130 } });
    expect(magnitude(evaluated, 10)).toBe(-3);
  });
});

describe('coordinate subset boundaries', () => {
  it.each([0, -10, NaN, Infinity])('rejects unverified 52 length %s', (size) => {
    const objects = square(); objects[1] = unit(2, 52, 1, size);
    expect(result(evaluatePageGeometry(page(objects)), 2)).toMatchObject({ status: 'unsupported', exists: null, reason: 'unit-point-52-length-must-be-positive-finite' });
  });
  it.each([
    ['54 parent is the origin', () => unit(3, 54, 1, 37), 3, 'unit-point-54-parent-must-be-52'],
    ['58 reversed', () => axis(4, 58, [2, 1], 1), 4, 'axis-58-slanted-reversed-or-zero-unit-unverified'],
    ['58 slanted', () => axis(4, 58, [2, 3], 1), 4, 'axis-58-slanted-reversed-or-zero-unit-unverified'],
    ['axis direction', () => axis(4, 58, [1, 2], 2), 4, 'axis-direction-unverified'],
    ['axis layout', () => obj(4, 58, [1, 2], [record(2309, words(1, 0, 0))]), 4, 'axis-2309-layout-unverified'],
    ['59 number source', () => axis(4, 59, [1, 7], 1), 4, 'axis-59-length-provider-unverified'],
    ['60 point source', () => axis(4, 60, [2], 1), 4, 'axis-60-parent-must-be-circle'],
    ['61 swapped axes', () => system(6, 5, 4), 6, 'coordinate-system-ordered-axis-parents-required'],
    ['61 same direction', () => system(6, 4, 4), 6, 'coordinate-system-ordered-axis-parents-required'],
    ['61 mode', () => system(6, 4, 5, 3), 6, 'coordinate-system-mode-unverified'],
    ['61 layout', () => obj(6, 61, [4, 5], [record(2308, words(1, 2))]), 6, 'coordinate-system-2308-layout-unverified'],
    ['69 HTML slot order', () => obj(9, 69, [7, 6, 8]), 9, 'plot-69-parent-types-unverified'],
  ] as const)('rejects %s with an explicit reason', (_label, make, index, reason) => {
    const objects = square(); objects[index - 1] = make();
    expect(result(evaluatePageGeometry(page(objects)), index)).toMatchObject({ status: 'unsupported', exists: null, reason });
  });
  it('rejects mismatched origins and dimensioned plotted coordinates', () => {
    const objects = square(); objects.push(pt(12, 50, 200), pt(13, 50, 190)); objects[4] = axis(5, 58, [12, 13], 0);
    expect(result(evaluatePageGeometry(page(objects)), 6)).toMatchObject({ status: 'unsupported', reason: 'coordinate-system-different-origins-unverified' });
    const other = square(); other[6] = numeric(7, [2, 0x0201]);
    expect(result(evaluatePageGeometry(page(other)), 9)).toMatchObject({ status: 'unsupported', reason: 'plot-69-coordinate-dimension-unverified' });
  });
  it('propagates missing and unsupported ancestors separately', () => {
    const objects = square(); objects[1]!.parents = [999];
    let evaluated = evaluatePageGeometry(page(objects));
    expect(result(evaluated, 3)).toMatchObject({ status: 'not-existing', exists: false, reason: 'parent:2:not-existing' });
    objects[0] = obj(1, 999, []); objects[1]!.parents = [1]; evaluated = evaluatePageGeometry(page(objects));
    expect(result(evaluated, 2)).toMatchObject({ status: 'unsupported', exists: null, reason: 'parent:1:unsupported' });
    expect(result(evaluated, 3)).toMatchObject({ status: 'unsupported', reason: 'parent:2:unsupported' });
  });
  it('leaves unrecognized records byte-for-byte intact during evaluation', () => {
    const doc = parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp'))), before = writeGsp(doc);
    const model = readDocumentModel(doc); model.pages[0]!.objects[0]!.constraintId = 52;
    evaluatePageGeometry(model.pages[0]!);
    expect(writeGsp(doc)).toEqual(before);
  });
});

describe('15 coordinate-axis path parameters', () => {
  it('uses the verified 200 px page basis rather than the coordinate unit and keeps vertical direction downward', () => {
    const objects = [pt(1, 105, 203), unit(2, 52, 1, 37.79527559055118), unit(3, 54, 2, 80),
      axis(4, 58, [1, 2], 1), axis(5, 58, [1, 3], 0), system(6, 4, 5),
      axisPoint(7, 4, 1.445), axisPoint(8, 5, 1.255), measure(9, 65, [7, 6]), measure(10, 66, [8, 6])];
    const evaluator = new PageGeometryEvaluator(page(objects));
    let evaluated = evaluator.evaluate();
    expect(result(evaluated, 7)).toMatchObject({ kind: 'point', geometry: { x: 294, y: 203 } });
    const vertical = result(evaluated, 8);
    expect(vertical).toMatchObject({ kind: 'point', geometry: { x: 105 } });
    if (vertical.status !== 'ok' || vertical.kind !== 'point') throw new Error('expected vertical axis point');
    expect(vertical.geometry.y).toBeCloseTo(354, 12);
    expect(magnitude(evaluated, 9)).toBeCloseTo(5.000625, 9);
    expect(magnitude(evaluated, 10)).toBeCloseTo(-3.99520833333333, 9);

    // Changing the coordinate unit changes coordinates, while preserving the stored axis-path t and page point.
    new DataView(objects[1]!.node.records[0]!.payload.buffer).setFloat64(4, 50, true);
    evaluator.invalidate(2); evaluated = evaluator.evaluate();
    expect(result(evaluated, 7)).toMatchObject({ geometry: { x: 294, y: 203 } });
    expect(magnitude(evaluated, 9)).toBeCloseTo(3.78, 12);
    expect(magnitude(evaluated, 10)).toBeCloseTo(-3.02, 12);

    const origin = new DataView(objects[0]!.node.records[0]!.payload.buffer);
    origin.setFloat64(0, 125, true); origin.setFloat64(8, 213, true);
    evaluator.invalidate(1); evaluated = evaluator.evaluate();
    expect(result(evaluated, 7)).toMatchObject({ geometry: { x: 314, y: 213 } });
    const movedVertical = result(evaluated, 8);
    if (movedVertical.status !== 'ok' || movedVertical.kind !== 'point') throw new Error('expected vertical axis point');
    expect(movedVertical.geometry.y).toBeCloseTo(364, 12);
    expect(magnitude(evaluated, 10)).toBeCloseTo(-3.02, 12);
  });

  it('accepts native path parameters on a horizontal 59 axis only', () => {
    const horizontal = [pt(1, 20, 30), pt(2, 20, 55), obj(3, 2, [1, 2]), axis(4, 59, [1, 3], 1), axisPoint(5, 4, -0.25)];
    const h = evaluatePageGeometry(page(horizontal));
    // a=(-80,30), b=(120,30): t=-0.25 -> (20,30) - 150e = (-130,30).
    expect(result(h, 5)).toMatchObject({ status: 'ok', kind: 'point', geometry: { x: -130, y: 30 } });

    const rejected = [pt(1, 20, 30), pt(2, 20, 55), obj(3, 2, [1, 2]), obj(4, 3, [1, 2]),
      axis(5, 59, [1, 3], 0), axis(6, 60, [4], 1), axisPoint(7, 5, 0.75), axisPoint(8, 6, 0.75)];
    const r = evaluatePageGeometry(page(rejected));
    expect(result(r, 7)).toMatchObject({ status: 'unsupported', exists: null, reason: 'axis-path-parameter-unverified' });
    expect(result(r, 8)).toMatchObject({ status: 'unsupported', exists: null, reason: 'axis-path-parameter-unverified' });
  });

  it('puts the 58 line on the native 200 px basis O -/+ 100e for both directions, independent of the unit', () => {
    const evaluated = evaluatePageGeometry(page([pt(1, 105, 203), pt(2, 145, 203), pt(3, 105, 163), axis(4, 58, [1, 2], 1), axis(5, 58, [1, 3], 0)]));
    expect(result(evaluated, 4)).toMatchObject({ geometry: { a: [5, 203], b: [205, 203] }, parameterizationKnown: true, axis: { origin: [105, 203], unit: [40, 0] } });
    expect(result(evaluated, 5)).toMatchObject({ geometry: { a: [105, 103], b: [105, 303] }, parameterizationKnown: true, axis: { origin: [105, 203], unit: [0, -40] } });
  });

  it('evaluates 15 on vertical and horizontal 58 axes with the card-15 values and no range clamp', () => {
    const objects = [pt(1, 105, 203), pt(2, 143, 203), pt(3, 105, 165), axis(4, 58, [1, 2], 1), axis(5, 58, [1, 3], 0),
      axisPoint(6, 5, 1.255), axisPoint(7, 4, 1.445), axisPoint(8, 4, -2), axisPoint(9, 5, 3)];
    const evaluated = evaluatePageGeometry(page(objects));
    const v = result(evaluated, 6);
    if (v.status !== 'ok' || v.kind !== 'point') throw new Error('expected point');
    expect(v.geometry.x).toBe(105); expect(v.geometry.y).toBeCloseTo(354, 12);
    const h = result(evaluated, 7);
    if (h.status !== 'ok' || h.kind !== 'point') throw new Error('expected point');
    expect(h.geometry.x).toBeCloseTo(294, 12); expect(h.geometry.y).toBe(203);
    expect(result(evaluated, 8)).toMatchObject({ status: 'ok', kind: 'point', geometry: { x: -395, y: 203 } });
    expect(result(evaluated, 9)).toMatchObject({ status: 'ok', kind: 'point', geometry: { x: 105, y: 703 } });
  });

  it.each([1, 0] as const)('5/6 through P on a 58 axis (direction %i) use the 200 px line basis, and 15 follows it', (direction) => {
    // Axis O=(100,200), unit L=10: the line a/b is O -/+ 100e, so d is 200 px long, not 10 px.
    const objects = [pt(1, 100, 200), pt(2, 110, 200), pt(3, 100, 190), axis(4, 58, [1, direction === 1 ? 2 : 3], direction), pt(5, 50, 60),
      { ...obj(6, 5, [5, 4]), mainKind: 2, genera: 47 }, { ...obj(7, 6, [5, 4]), mainKind: 2, genera: 46 },
      axisPoint(8, 6, 0.25, 47), axisPoint(9, 7, 0.75, 46), axisPoint(10, 6, 0.5, 47), axisPoint(11, 7, 0.5, 46)];
    const evaluated = evaluatePageGeometry(page(objects));
    if (direction === 1) {
      // d=(200,0): perpendicular n=(0,200), A'=P-n/2=(50,-40), B'=(50,160); parallel A'=(-50,60), B'=(150,60).
      expect(result(evaluated, 6)).toMatchObject({ kind: 'line', geometry: { a: [50, -40], b: [50, 160] }, parameterizationKnown: true });
      expect(result(evaluated, 7)).toMatchObject({ kind: 'line', geometry: { a: [-50, 60], b: [150, 60] }, parameterizationKnown: true });
      expect(result(evaluated, 8)).toMatchObject({ status: 'ok', geometry: { x: 50, y: 10 } });
      expect(result(evaluated, 9)).toMatchObject({ status: 'ok', geometry: { x: 100, y: 60 } });
    } else {
      // d=(0,200) (page +y): n=(-200,0), A'=(150,60), B'=(-50,60); parallel A'=(50,-40), B'=(50,160).
      expect(result(evaluated, 6)).toMatchObject({ kind: 'line', geometry: { a: [150, 60], b: [-50, 60] }, parameterizationKnown: true });
      expect(result(evaluated, 7)).toMatchObject({ kind: 'line', geometry: { a: [50, -40], b: [50, 160] }, parameterizationKnown: true });
      expect(result(evaluated, 8)).toMatchObject({ status: 'ok', geometry: { x: 100, y: 60 } });
      expect(result(evaluated, 9)).toMatchObject({ status: 'ok', geometry: { x: 50, y: 110 } });
    }
    expect(result(evaluated, 10)).toMatchObject({ status: 'ok', geometry: { x: 50, y: 60 } });
    expect(result(evaluated, 11)).toMatchObject({ status: 'ok', geometry: { x: 50, y: 60 } });
  });

  it('gives 5/6 and 15 the native 200 px basis on a horizontal 59 axis, and keeps 60 unverified', () => {
    const objects = [pt(1, 20, 30), pt(2, 20, 55), obj(3, 2, [1, 2]), axis(4, 59, [1, 3], 1), pt(5, 50, 60),
      { ...obj(6, 5, [5, 4]), mainKind: 2, genera: 47 }, { ...obj(7, 6, [5, 4]), mainKind: 2, genera: 46 },
      axisPoint(8, 6, 0.25, 47), axisPoint(9, 7, 0.25, 46)];
    const evaluated = evaluatePageGeometry(page(objects));
    expect(result(evaluated, 6)).toMatchObject({ status: 'ok', kind: 'line', parameterizationKnown: true, geometry: { a: [50, -40], b: [50, 160] } });
    expect(result(evaluated, 7)).toMatchObject({ status: 'ok', kind: 'line', parameterizationKnown: true, geometry: { a: [-50, 60], b: [150, 60] } });
    expect(result(evaluated, 8)).toMatchObject({ status: 'ok', geometry: { x: 50, y: 10 } });
    expect(result(evaluated, 9)).toMatchObject({ status: 'ok', geometry: { x: 0, y: 60 } });

    const circle = [pt(1, 20, 30), pt(2, 20, 55), obj(3, 3, [1, 2]), axis(4, 60, [3], 1), pt(5, 50, 60),
      { ...obj(6, 5, [5, 4]), mainKind: 2, genera: 47 }, axisPoint(7, 6, 0.25, 47)];
    const c = evaluatePageGeometry(page(circle));
    expect(result(c, 6)).toMatchObject({ status: 'ok', kind: 'line', parameterizationKnown: false });
    expect(result(c, 7)).toMatchObject({ status: 'unsupported', exists: null, reason: 'path-direction-and-unit-unverified' });
  });

  it('keeps 61, 65, 66, 86 and 69 on the coordinate unit basis when Lx differs from Ly', () => {
    // O=(100,200), Lx=20, Ly=10; the 200 px axis lines must not influence the coordinate basis.
    const objects = [pt(1, 100, 200), pt(2, 120, 200), pt(3, 100, 190), axis(4, 58, [1, 2], 1), axis(5, 58, [1, 3], 0), system(6, 4, 5),
      pt(7, 140, 170), pt(8, 60, 180), measure(9, 65, [7, 6]), measure(10, 66, [7, 6]), measure(11, 86, [7, 8, 6], 5),
      numeric(12, [0x1001, 2]), numeric(13, [3, 10, 5]), obj(14, 69, [12, 13, 6])];
    const evaluated = evaluatePageGeometry(page(objects));
    expect(result(evaluated, 6)).toMatchObject({ kind: 'coordinate-system', status: 'ok', geometry: { origin: [100, 200], u: [20, 0], v: [0, -10] } });
    expect(magnitude(evaluated, 9)).toBe(2); expect(magnitude(evaluated, 10)).toBe(3);
    expect(magnitude(evaluated, 11)).toBeCloseTo(Math.hypot(4, 1), 9);
    expect(result(evaluated, 14)).toMatchObject({ kind: 'point', status: 'ok' });
  });

  it('rejects 94 on coordinate axes while accepting an ordinary line with identical a/b', () => {
    const p: Geometry = { kind: 'point', geometry: { x: 130, y: 100 } };
    const line = { kind: 'line', geometry: { a: [100, 100], b: [110, 100] }, parameterizationKnown: true } satisfies Geometry;
    const o = measure(3, 94, [1, 2]);
    expect(evaluateMeasure(o, [p, line], page([]))).toMatchObject({ ok: true, measurement: { internal: { magnitude: 3 } } });
    expect(evaluateMeasure(o, [p, { ...line, axis: { direction: 'horizontal', origin: [100, 100], unit: [10, 0] } }], page([])))
      .toMatchObject({ ok: false, status: 'unsupported', reason: 'point-value-94-coordinate-axis-logical-parameter-unverified' });
  });
});

describe('94 nearest point path parameter', () => {
  function value(p: [number, number], path: Geometry) {
    return evaluateMeasure(measure(3, 94, [1, 2], 5), [{ kind: 'point', geometry: { x: p[0], y: p[1] } }, path], page([]));
  }
  it.each([
    ['segment', [-5, 9], 0], ['segment', [25, 9], 1], ['ray', [-5, 9], 0], ['ray', [25, 9], 2.5], ['line', [-5, 9], -0.5], ['line', [25, 9], 2.5],
  ] as const)('projects onto %s and applies its range', (kind, p, expected) => {
    expect(value([...p], { kind, geometry: { a: [0, 0], b: [10, 0] }, parameterizationKnown: true })).toMatchObject({ ok: true, measurement: { internal: { magnitude: expected, dimension: 'number' }, displayUnitText: '' } });
  });
  it('preserves the stored line basis rather than normalizing it', () => {
    expect(value([7, 100], { kind: 'line', geometry: { a: [2, 5], b: [22, 5] }, parameterizationKnown: true })).toMatchObject({ ok: true, measurement: { internal: { magnitude: 0.25 } } });
  });
  it.each([[[30, 20], 0], [[10, 0], 0.25], [[-10, 20], 0.5], [[10, 40], 0.75]] as const)('measures circle turns at %j', (p, expected) => {
    expect(value([...p], { kind: 'circle', geometry: { center: [10, 20], radius: 7 } })).toMatchObject({ ok: true, measurement: { internal: { magnitude: expected } } });
  });
  it.each([
    { kind: 'circle', geometry: { center: [0, 0], radius: 10 } },
    { kind: 'segment', geometry: { a: [1, 1], b: [1, 1] }, parameterizationKnown: true },
    { kind: 'segment', geometry: { a: [0, 0], b: [10, 0] }, parameterizationKnown: true, degenerateArc: true },
    { kind: 'ray', geometry: { a: [0, 0], b: [10, 0] }, parameterizationKnown: false },
    { kind: 'polygon', geometry: { vertices: [[0, 0], [10, 0], [0, 10]] } },
    { kind: 'arc', geometry: { center: [0, 0], radius: 10, startAngle: 0, sweepAngle: 1, start: [10, 0], end: [5, -8] } },
  ] satisfies Geometry[])('rejects ambiguous or unverified path %#', (path) => {
    expect(value([0, 0], path)).toMatchObject({ ok: false, status: 'unsupported', reason: expect.stringContaining('point-value-94-') });
  });
});

describe('94 boundary logical values for native polygons and ordinary 80 arcs', () => {
  const evaluated = (objects: ObjectInfo[]) => evaluatePageGeometry(page(objects));
  function rectangle(): ObjectInfo[] {
    return [pt(1, 0, 0), pt(2, 100, 0), pt(3, 100, 50), pt(4, 0, 50), obj(5, 8, [1, 2, 3, 4])];
  }

  it('uses cumulative perimeter length, not the edge index, for a polygon boundary point', () => {
    // 周长 300；P 在第二边中点：prefix 100 + 25。
    const objects = [...rectangle(), pt(6, 100, 25), measure(7, 94, [6, 5])];
    expect(magnitude(evaluated(objects), 7)).toBeCloseTo(125 / 300, 12);
  });

  it('merges the two equal parameters of a non-seam vertex', () => {
    const objects = [...rectangle(), pt(6, 100, 0), measure(7, 94, [6, 5])];
    expect(magnitude(evaluated(objects), 7)).toBeCloseTo(100 / 300, 12);
  });

  it('does not merge the V0 seam, and rejects a point off the boundary', () => {
    const seam = evaluated([...rectangle(), pt(6, 0, 0), measure(7, 94, [6, 5])]);
    expect(result(seam, 7)).toMatchObject({ status: 'unsupported', reason: 'point-value-94-nearest-logical-value-ambiguous' });
    const off = evaluated([...rectangle(), pt(6, 50, 25), measure(7, 94, [6, 5])]);
    expect(result(off, 7)).toMatchObject({ status: 'unsupported', reason: 'point-value-94-off-path' });
  });

  it('measures an ordinary 80 arc from its first endpoint along the directed sweep', () => {
    const base = [pt(1, 0, 0), pt(2, 10, 0), pt(3, 0, -10), obj(4, 80, [1, 2, 3])];
    const middle = evaluated([...base, pt(5, Math.SQRT1_2 * 10, -Math.SQRT1_2 * 10), measure(6, 94, [5, 4])]);
    expect(magnitude(middle, 6)).toBeCloseTo(0.5, 12);
    const end = evaluated([...base, pt(5, 0, -10), measure(6, 94, [5, 4])]);
    expect(magnitude(end, 6)).toBeCloseTo(1, 12);
    const outside = evaluated([...base, pt(5, 10 * Math.cos(-Math.PI / 6), -10 * Math.sin(-Math.PI / 6)), measure(6, 94, [5, 4])]);
    expect(result(outside, 6)).toMatchObject({ status: 'unsupported', reason: 'point-value-94-outside-arc' });
  });

  it('keeps a 79 arc parent unverified instead of reusing the 80 rule', () => {
    const objects = [pt(1, 0, 0), pt(2, 10, 0), pt(3, 0, 0), obj(4, 3, [1, 2]),
      pt(5, Math.SQRT1_2 * 10, -Math.SQRT1_2 * 10), obj(6, 79, [4, 2, 5]), measure(7, 94, [5, 6])];
    expect(result(evaluated(objects), 7))
      .toMatchObject({ status: 'unsupported', reason: 'point-value-94-path-constraint-unverified:79' });
  });
});
