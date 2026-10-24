import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PageGeometryEvaluator, evaluatePageGeometry, parseGsp, readDocumentModel, writeGsp, writeU16, writeU32 } from '../src/index';
import type { ContainerModel, EvaluatedObject, Geometry, ObjectInfo, XY } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';

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
  const payload = new Uint8Array(id === 17 ? 52 : id === 21 ? 60 : id === 27 ? 36 : 12).fill(0xa7);
  const view = new DataView(payload.buffer);
  view.setUint32(0, id, true);
  fields.forEach(([offset, value]) => view.setFloat64(offset, value, true));
  return payload;
}
function path(index: number, parent: number, genera: number, ...values: number[]): ObjectInfo {
  const payload = new Uint8Array(4 + 8 * values.length), view = new DataView(payload.buffer);
  view.setUint16(0, 15, true); view.setUint16(2, genera, true);
  values.forEach((value, i) => view.setFloat64(4 + 8 * i, value, true));
  return object(index, 15, [parent], 10, payload);
}
const page = (...objects: ObjectInfo[]): ContainerModel => ({ ...base, objects });
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
const parameters = [point(100, 10, 20), point(101, 0, 0), point(102, 4, 0), point(103, -2, 0), point(104, 0, -4), object(105, 2, [101, 102], 14), object(200, 48, [])];
const cases: Array<{ id: number; parents: number[]; payload?: Uint8Array; p: XY; a: XY; b: XY; radius: number; sweep: number }> = [
  { id: 16, parents: [101, 102], p: [6, 3], a: [11, 3], b: [6, -2], radius: 5, sweep: Math.PI / 2 },
  { id: 17, parents: [], payload: parameter(17, [[4, 5], [24, 7]]), p: [7, -4], a: [12, -4], b: [7, -9], radius: 5, sweep: Math.PI / 2 },
  { id: 21, parents: [], payload: parameter(21, [[4, -1], [12, 0], [32, 8]]), p: [2, -5], a: [7, -5], b: [2, -10], radius: 5, sweep: Math.PI / 2 },
  { id: 27, parents: [100], payload: parameter(27, [[4, -1], [12, 0]]), p: [-7, 28], a: [-7, 23], b: [-12, 28], radius: 5, sweep: Math.PI / 2 },
  { id: 28, parents: [100, 102, 101, 104], p: [-7, 28], a: [-7, 23], b: [-12, 28], radius: 5, sweep: Math.PI / 2 },
  { id: 30, parents: [100], payload: parameter(30, [[4, -2]]), p: [26, 54], a: [16, 54], b: [26, 64], radius: 10, sweep: Math.PI / 2 },
  { id: 32, parents: [100, 101, 102, 103], p: [14, 28.5], a: [11.5, 28.5], b: [14, 31], radius: 2.5, sweep: Math.PI / 2 },
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
      } else if (g.kind === 'measure') {
        throw new Error('a transform must not produce a numeric measure');
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
  it('measured parameter transforms report their root cause even when the numeric parent is unsupported', () => {
    for (const id of [18, 19, 20, 23, 24, 25, 26, 29, 31, 33]) {
      expect(find(page(...sources, ...parameters, object(300, id, [1, 200])), 300)).toMatchObject({ status: 'unsupported', exists: null, reason: 'parameter-from-unimplemented-measure' });
    }
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
    expect(evaluator.recomputedIndices.sort((a, b) => a - b)).toEqual([102, 105, 300, 301, 302]);
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
