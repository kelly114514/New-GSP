import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PageGeometryEvaluator, evaluatePageGeometry, parseGsp, readDocumentModel, toGeometryJson, writeGsp } from '../src/index';
import type { ContainerModel, EvaluatedObject, ObjectInfo } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';
function baseline(name = 'midpoint.gsp') { return readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, name)))); }
function pointObject(index: number, x: number, y: number): ObjectInfo {
  const base = baseline().pages[0]!.objects[0]!;
  const payload = new Uint8Array(16);
  new DataView(payload.buffer).setFloat64(0, x, true);
  new DataView(payload.buffer).setFloat64(8, y, true);
  return { ...base, index, node: { ...base.node, records: [{ kind: 2201, payload, pad: 0 }] } };
}
function object(index: number, constraintId: number, parents: number[]): ObjectInfo {
  const base = baseline().pages[0]!.objects[2]!;
  return { ...base, index, constraintId, parents, freePoint: undefined, node: { ...base.node, records: [] } };
}
function page(...objects: ObjectInfo[]): ContainerModel { return { ...baseline().pages[0]!, objects }; }

describe('M2 geometry and dependency propagation', () => {
  it('baseline midpoint, drag, 2201 write, and reopen agree', () => {
    const model = baseline();
    const evaluator = new PageGeometryEvaluator(model.pages[0]!);
    expect(evaluator.evaluate().objects[3]).toMatchObject({ exists: true, kind: 'point', geometry: { x: 311, y: 214 } });
    const after = evaluator.moveFreePoint(model.doc, 1, 251, 174);
    expect(after.objects[3]).toMatchObject({ exists: true, geometry: { x: 331, y: 227.5 } });
    expect(evaluator.recomputedIndices.sort()).toEqual([1, 3, 4]);
    const reopened = readDocumentModel(parseGsp(writeGsp(model.doc)));
    expect(toGeometryJson(reopened)).toEqual(toGeometryJson(model));
    expect(reopened.pages[0]!.objects[0]!.freePoint).toEqual({ x: 251, y: 174 });
    expect(() => evaluator.moveFreePoint(model.doc, 4, 0, 0)).toThrow(RangeError);
  });
  it('evaluates out-of-order parents and preserves repeated polygon vertices', () => {
    const evaluated = evaluatePageGeometry(page(object(4, 1, [3]), object(3, 2, [2, 1]), pointObject(1, 0, 0), pointObject(2, 10, 4), object(5, 8, [1, 2, 1])));
    expect(evaluated.objects[0]).toMatchObject({ geometry: { x: 5, y: 2 } });
    expect(evaluated.objects[4]).toMatchObject({ kind: 'polygon', geometry: { vertices: [[0, 0], [10, 4], [0, 0]] } });
  });
  it('missing parents and a dependency cycle do not prevent unrelated objects', () => {
    const results = evaluatePageGeometry(page(pointObject(1, 2, 3), object(2, 1, [3]), object(3, 1, [2]), object(4, 1, [99]))).objects;
    expect(results[0]).toMatchObject({ status: 'ok', exists: true });
    expect(results[1]).toMatchObject({ status: 'not-existing', reason: 'dependency-cycle' });
    expect(results[2]).toMatchObject({ status: 'not-existing' });
    expect(results[3]).toMatchObject({ status: 'not-existing', reason: 'missing-parent:99' });
  });
  it('nonexistence recovers after an ancestor changes and only descendants recompute', () => {
    const p = page(pointObject(1, 0, 0), pointObject(2, 10, 0), pointObject(3, 0, 1), pointObject(4, 10, 1), object(5, 63, [1, 2]), object(6, 63, [3, 4]), object(7, 9, [5, 6]), object(8, 2, [1, 7]));
    const evaluator = new PageGeometryEvaluator(p);
    expect(evaluator.evaluate().objects[7]).toMatchObject({ status: 'not-existing' });
    new DataView(p.objects[3]!.node.records[0]!.payload.buffer).setFloat64(8, -1, true);
    evaluator.invalidate(4);
    const after = evaluator.evaluate();
    expect(after.objects[6]).toMatchObject({ kind: 'point', geometry: { x: 5, y: 0 } });
    expect(after.objects[7]).toMatchObject({ exists: true });
    expect(evaluator.recomputedIndices).toEqual([4, 6, 7, 8]);
  });
  it('supports circle radius from a segment and keeps unsupported lengths explicit', () => {
    const results = evaluatePageGeometry(page(pointObject(1, 0, 0), pointObject(2, 3, 4), object(3, 2, [1, 2]), object(4, 4, [1, 3]), object(5, 4, [1, 2]))).objects;
    expect(results[3]).toMatchObject({ kind: 'circle', geometry: { center: [0, 0], radius: 5 } });
    expect(results[4]).toMatchObject({ exists: null, status: 'unsupported' });
  });
  it('does not treat every ID 0 as a point or tool placeholders as geometry', () => {
    const free = pointObject(1, 0, 0);
    expect(evaluatePageGeometry(page({ ...free, mainKind: 10 })).objects[0]).toMatchObject({ status: 'unsupported' });
    expect(evaluatePageGeometry({ ...page({ ...free, genera: 14 }), type: 'tool' }).objects[0]).toMatchObject({ status: 'unbound-input' });
  });
  it('keeps very distant intersections instead of a fixed pixel parallel tolerance', () => {
    const result = evaluatePageGeometry(page(pointObject(1, 0, 0), pointObject(2, 1, 0), pointObject(3, 0, 1), pointObject(4, 1, 1 + 1e-10), object(5, 63, [1, 2]), object(6, 63, [3, 4]), object(7, 9, [5, 6]))).objects[6]!;
    expect(result).toMatchObject({ exists: true, kind: 'point' });
    if (result.status === 'ok' && result.kind === 'point') expect(Math.abs(result.geometry.x)).toBeGreaterThan(1e9);
  });
});

describe('line-circle intersections: constraints 11 and 12', () => {
  function circle(index: number, center: number, rim: number): ObjectInfo { return object(index, 3, [center, rim]); }
  function assertPoint(result: EvaluatedObject | undefined, x: number, y: number): void {
    expect(result).toMatchObject({ status: 'ok', exists: true, kind: 'point' });
    if (result?.status === 'ok' && result.kind === 'point') {
      expect(result.geometry.x).toBeCloseTo(x, 9);
      expect(result.geometry.y).toBeCloseTo(y, 9);
    }
  }
  it('picks the root with the smaller or larger parent parameter, not a coordinate order', () => {
    const results = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 2, 0), object(3, 2, [1, 2]),
      pointObject(4, 1, 0), pointObject(5, 1.5, 0), circle(6, 4, 5),
      object(7, 11, [3, 6]), object(8, 12, [3, 6]),
    )).objects;
    assertPoint(results[6], 0.5, 0);
    assertPoint(results[7], 1.5, 0);
  });
  it('falls back to the other root when the preferred one leaves the segment range', () => {
    const results = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 1, 0), object(3, 2, [1, 2]),
      pointObject(4, 2, 0), pointObject(5, 3.5, 0), circle(6, 4, 5),
      object(7, 11, [3, 6]), object(8, 12, [3, 6]),
    )).objects;
    assertPoint(results[6], 0.5, 0);
    assertPoint(results[7], 0.5, 0);
  });
  it('treats a tangent hit as one root and a separated circle as nonexistent', () => {
    const tangent = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 2, 0), object(3, 2, [1, 2]),
      pointObject(4, 1, 1), pointObject(5, 2, 1), circle(6, 4, 5),
      object(7, 11, [3, 6]), object(8, 12, [3, 6]),
    )).objects;
    assertPoint(tangent[6], 1, 0);
    assertPoint(tangent[7], 1, 0);
    const separated = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 2, 0), object(3, 2, [1, 2]),
      pointObject(4, 1, 5), pointObject(5, 2, 5), circle(6, 4, 5),
      object(7, 11, [3, 6]), object(8, 12, [3, 6]),
    )).objects;
    expect(separated[6]).toMatchObject({ status: 'not-existing', reason: 'line-circle-no-intersection' });
    expect(separated[7]).toMatchObject({ status: 'not-existing' });
  });
  it('reports a nonexistent intersection when both roots are outside every parent range', () => {
    const results = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 1, 0), object(3, 2, [1, 2]),
      pointObject(4, 5, 0), pointObject(5, 6, 0), circle(6, 4, 5),
      object(7, 11, [3, 6]), object(8, 12, [3, 6]),
    )).objects;
    expect(results[6]).toMatchObject({ status: 'not-existing', reason: 'intersection-outside-parent-range' });
    expect(results[7]).toMatchObject({ status: 'not-existing', reason: 'intersection-outside-parent-range' });
  });
  it('requires a linear first parent and a circle second parent', () => {
    const results = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 1, 0), object(3, 2, [1, 2]),
      pointObject(4, 5, 0), pointObject(5, 6, 0), object(6, 3, [4, 5]), object(7, 10, [6]),
      object(8, 11, [3, 7]), object(9, 12, [7, 3]),
    )).objects;
    expect(results[7]).toMatchObject({ status: 'unsupported', reason: 'intersection-circle-parent-required' });
    expect(results[8]).toMatchObject({ status: 'unsupported', reason: 'expected-linear-and-circle-parents' });
  });
});

describe('circle-circle intersections: constraints 13 and 14', () => {
  function circle(index: number, cx: number, cy: number, radius: number): ObjectInfo[] {
    return [pointObject(index, cx, cy), pointObject(index + 1, cx + radius, cy), object(index + 2, 3, [index, index + 1])];
  }
  function assertPoint(result: EvaluatedObject | undefined, x: number, y: number): void {
    expect(result).toMatchObject({ status: 'ok', exists: true, kind: 'point' });
    if (result?.status === 'ok' && result.kind === 'point') {
      expect(result.geometry.x).toBeCloseTo(x, 9);
      expect(result.geometry.y).toBeCloseTo(y, 9);
    }
  }
  it('places branch one and branch two on opposite sides of the O1 to O2 direction', () => {
    const results = evaluatePageGeometry(page(
      ...circle(1, 0, 0, 5), ...circle(4, 6, 0, 5),
      object(7, 13, [3, 6]), object(8, 14, [3, 6]),
    )).objects;
    assertPoint(results[6], 3, -4);
    assertPoint(results[7], 3, 4);
  });
  it('keeps the parent order, so swapping the parents swaps the branch points', () => {
    const results = evaluatePageGeometry(page(
      ...circle(1, 0, 0, 5), ...circle(4, 6, 0, 5),
      object(7, 13, [6, 3]), object(8, 14, [6, 3]),
    )).objects;
    assertPoint(results[6], 3, 4);
    assertPoint(results[7], 3, -4);
  });
  it('collapses both branches at a tangency and reports separated, contained and concentric parents as nonexistent', () => {
    const tangent = evaluatePageGeometry(page(
      ...circle(1, 0, 0, 5), ...circle(4, 8, 0, 3),
      object(7, 13, [3, 6]), object(8, 14, [3, 6]),
    )).objects;
    assertPoint(tangent[6], 5, 0);
    assertPoint(tangent[7], 5, 0);
    const separated = evaluatePageGeometry(page(
      ...circle(1, 0, 0, 5), ...circle(4, 20, 0, 5),
      object(7, 13, [3, 6]),
    )).objects;
    expect(separated[6]).toMatchObject({ status: 'not-existing', reason: 'circle-circle-no-intersection' });
    const contained = evaluatePageGeometry(page(
      ...circle(1, 0, 0, 5), ...circle(4, 1, 0, 2),
      object(7, 13, [3, 6]),
    )).objects;
    expect(contained[6]).toMatchObject({ status: 'not-existing', reason: 'circle-circle-no-intersection' });
    const concentric = evaluatePageGeometry(page(
      ...circle(1, 0, 0, 5), ...circle(4, 0, 0, 3),
      object(7, 13, [3, 6]), object(8, 14, [3, 6]),
      ...circle(9, 0, 0, 5), object(12, 13, [3, 11]),
    )).objects;
    expect(concentric[6]).toMatchObject({ status: 'not-existing', reason: 'concentric-circle-parents' });
    expect(concentric[7]).toMatchObject({ status: 'not-existing', reason: 'concentric-circle-parents' });
    expect(concentric[11]).toMatchObject({ status: 'not-existing', reason: 'concentric-circle-parents' });
  });
  it('requires two circle parents and does not reorder them by object index', () => {
    const results = evaluatePageGeometry(page(
      pointObject(1, 0, 0), pointObject(2, 5, 0), object(3, 3, [1, 2]), object(4, 10, [3]),
      object(5, 13, [3, 4]),
    )).objects;
    expect(results[4]).toMatchObject({ status: 'unsupported', reason: 'intersection-circle-parent-required' });
  });
});

function pathPoint(index: number, parent: number, genera: number, ...parameters: number[]): ObjectInfo {
  const base = object(index, 15, [parent]);
  const payload = new Uint8Array(4 + 8 * parameters.length);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 15, true); view.setUint16(2, genera, true);
  parameters.forEach((t, i) => view.setFloat64(4 + 8 * i, t, true));
  return { ...base, mainKind: 1, genera: 10, node: { ...base.node, records: [{ kind: 2003, payload, pad: 0 }] } };
}

describe('native paths: independent EMF numbers from spec/objects/cards/15,63,64', () => {
  for (const sample of [
    { id: 2, genera: 14, a: [55, 212], b: [327, 212], t: 0.28208010537472505, expected: [131.726, 212] },
    { id: 63, genera: 12, a: [11, 457], b: [676, 427], t: 0.7852970430403738, expected: [533.223, 433.441] },
    { id: 64, genera: 13, a: [30, 545], b: [192, 545], t: 1.6812613501140852, expected: [302.364, 545] },
  ]) {
    it(`constraint ${sample.id} keeps native parent direction`, () => {
      const p = page(pointObject(1, sample.a[0]!, sample.a[1]!), pointObject(2, sample.b[0]!, sample.b[1]!), { ...object(3, sample.id, [1, 2]), genera: sample.genera }, pathPoint(4, 3, sample.genera, sample.t));
      const result = evaluatePageGeometry(p).objects[3]!;
      expect(result).toMatchObject({ exists: true, kind: 'point' });
      if (result.status === 'ok' && result.kind === 'point') expect(Math.hypot(result.geometry.x - sample.expected[0]!, result.geometry.y - sample.expected[1]!)).toBeLessThan(0.1);
    });
  }
  it('circle native vector uses mathematical y, opposite page y', () => {
    const result = evaluatePageGeometry(page(pointObject(1, 311, 149), pointObject(2, 424, 214), { ...object(3, 3, [1, 2]), genera: 28 }, pathPoint(4, 3, 28, 0.9869866055863689, -0.16080248876524725))).objects[3]!;
    expect(result).toMatchObject({ exists: true, kind: 'point' });
    if (result.status === 'ok' && result.kind === 'point') expect(Math.hypot(result.geometry.x - 439.665, result.geometry.y - 169.962)).toBeLessThan(0.1);
  });
  it('missing and inconsistent native parameters remain explicit unsupported', () => {
    const p = page(pointObject(1, 0, 0), pointObject(2, 100, 0), object(3, 2, [1, 2]), pathPoint(4, 3, 13, 0.25), object(5, 15, [3]));
    expect(evaluatePageGeometry(p).objects[3]).toMatchObject({ status: 'unsupported', reason: 'native-path-genera-mismatch' });
    expect(evaluatePageGeometry(p).objects[4]).toMatchObject({ status: 'unsupported', reason: 'missing-native-path-parameter' });
  });
});

describe('angle bisector, disk and polygon boundary intersections', () => {
  it('angle bisector uses normalized arms, is a ray, and retains unknown parameter unit', () => {
    const result = evaluatePageGeometry(page(pointObject(1, 100, 0), pointObject(2, 0, 0), pointObject(3, 0, 1), object(4, 7, [1, 2, 3]))).objects[3]!;
    expect(result).toMatchObject({ kind: 'ray', geometry: { a: [0, 0], b: [1, 1] }, parameterizationKnown: false });
  });
  it('disk follows its circle without borrowing the circle drawing item', () => {
    const result = evaluatePageGeometry(page(pointObject(1, 0, 0), pointObject(2, 3, 4), object(3, 3, [1, 2]), object(4, 10, [3]))).objects[3]!;
    expect(result).toMatchObject({ kind: 'disk', geometry: { center: [0, 0], radius: 5 } });
  });
  it('ray picks first entering boundary from outside and first leaving boundary from inside', () => {
    const results = evaluatePageGeometry(page(pointObject(1, 0, 0), pointObject(2, 1, 0), pointObject(3, 10, -10), pointObject(4, 20, -10), pointObject(5, 20, 10), pointObject(6, 10, 10), object(7, 64, [1, 2]), object(8, 8, [3, 4, 5, 6]), object(9, 93, [7, 8]), pointObject(10, 15, 0), object(11, 64, [10, 2]), object(12, 93, [11, 8]))).objects;
    expect(results[8]).toMatchObject({ geometry: { x: 10, y: 0 } });
    expect(results[11]).toMatchObject({ geometry: { x: 10, y: 0 } });
  });
  it('coincident segment endpoints make the segment and midpoint nonexistent', () => {
    const results = evaluatePageGeometry(page(pointObject(1, 0, 0), pointObject(2, 0, 0), object(3, 2, [1, 2]), object(4, 1, [3]))).objects;
    expect(results[2]).toMatchObject({ status: 'not-existing', reason: 'coincident-defining-points' });
    expect(results[3]).toMatchObject({ status: 'not-existing' });
  });
});
