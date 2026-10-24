import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARC_ORIENTATION, PageGeometryEvaluator, evaluatePageGeometry, parseGsp, readDocumentModel } from '../src/index';
import type { ContainerModel, EvaluatedObject, ObjectInfo } from '../src/index';
import { baselineSamplesDir, corpusAvailable, corpusFiles, readBytes } from './support';

const base = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp'))));
function pt(index: number, x: number, y: number): ObjectInfo {
  const b = base.pages[0]!.objects[0]!;
  const payload = new Uint8Array(16);
  new DataView(payload.buffer).setFloat64(0, x, true);
  new DataView(payload.buffer).setFloat64(8, y, true);
  return { ...b, index, node: { ...b.node, records: [{ kind: 2201, payload, pad: 0 }] } };
}
function obj(index: number, constraintId: number, parents: number[], genera?: number): ObjectInfo {
  const b = base.pages[0]!.objects[2]!;
  return { ...b, index, constraintId, parents, ...(genera === undefined ? {} : { genera }), freePoint: undefined, node: { ...b.node, records: [] } };
}
function pathPoint(index: number, parent: number, genera: number, bytes: Uint8Array): ObjectInfo {
  const o = obj(index, 15, [parent]);
  new DataView(bytes.buffer).setUint16(0, 15, true);
  new DataView(bytes.buffer).setUint16(2, genera, true);
  return { ...o, mainKind: 1, genera: 10, node: { ...o.node, records: [{ kind: 2003, payload: bytes, pad: 0 }] } };
}
function t12(index: number, parent: number, genera: number, t: number): ObjectInfo {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setFloat64(4, t, true);
  return pathPoint(index, parent, genera, bytes);
}
function polygonParam(index: number, parent: number, genera: number, s: number, edge: number): ObjectInfo {
  const bytes = new Uint8Array(20);
  new DataView(bytes.buffer).setFloat64(4, s, true);
  new DataView(bytes.buffer).setUint16(12, edge, true);
  return pathPoint(index, parent, genera, bytes);
}
const page = (...objects: ObjectInfo[]): ContainerModel => ({ ...base.pages[0]!, objects });
const evalAt = (objects: ObjectInfo[], i: number): EvaluatedObject => evaluatePageGeometry(page(...objects)).objects.find((o) => o.objectIndex === i)!;
const R = 5;
/** Circle (object 3) around the origin with radius 5, built from free points 1 and 2. */
const circle = [pt(1, 0, 0), pt(2, R, 0), obj(3, 3, [1, 2])];
const polar = (deg: number, centerX = 0): [number, number] => [centerX + R * Math.cos(deg * Math.PI / 180), -R * Math.sin(deg * Math.PI / 180)];

function arcOf(r: EvaluatedObject | undefined) {
  expect(r).toMatchObject({ status: 'ok', exists: true, kind: 'arc' });
  if (r?.status !== 'ok' || r.kind !== 'arc') throw new Error('not an arc');
  return r.geometry;
}
function pointOf(r: EvaluatedObject | undefined): [number, number] {
  if (r?.status !== 'ok' || r.kind !== 'point') throw new Error(`expected a point, got ${JSON.stringify(r)}`);
  return [r.geometry.x, r.geometry.y];
}
function close(a: readonly number[], b: readonly number[], digits = 9): void {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
}

describe('arc orientation convention', () => {
  it('lives in one constant: counter-clockwise as seen on the page', () => {
    expect(ARC_ORIENTATION).toBe(1);
  });
});

describe('constraint 79: arc on an existing circle', () => {
  it('runs counter-clockwise on the page from A to B and carries its end points', () => {
    const g = arcOf(evalAt([...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 4, 5], 67)], 6));
    close(g.center, [0, 0]);
    expect(g.radius).toBeCloseTo(R, 9);
    expect(g.startAngle).toBeCloseTo(0, 9);
    expect(g.sweepAngle).toBeCloseTo(Math.PI / 2, 9);
    close(g.start, [R, 0]);
    close(g.end, [0, -R]);
  });
  it('swapping A and B gives the complementary arc', () => {
    const g = arcOf(evalAt([...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 5, 4], 67)], 6));
    expect(g.startAngle).toBeCloseTo(Math.PI / 2, 9);
    expect(g.sweepAngle).toBeCloseTo(3 * Math.PI / 2, 9);
    close(g.start, [0, -R]);
    close(g.end, [R, 0]);
  });
  it('takes the radius from |OA| so B only supplies the end direction (card 79 synthesis)', () => {
    // 原版合成输入：O=(300,300)、父圆半径 150。A=(450,300) 时半径 150；A 改成 (510,300) 后半径 210，扫角都还是 90°。
    const big = (ax: number) => [pt(1, 300, 300), pt(2, 450, 300), obj(3, 3, [1, 2]), pt(4, ax, 300), pt(5, 300, 90), obj(6, 79, [3, 4, 5], 67)];
    const onCircle = arcOf(evalAt(big(450), 6));
    close(onCircle.center, [300, 300]);
    expect(onCircle.radius).toBeCloseTo(150, 9);
    expect(onCircle.sweepAngle).toBeCloseTo(Math.PI / 2, 9);
    const offCircle = arcOf(evalAt(big(510), 6));
    close(offCircle.center, [300, 300]);
    expect(offCircle.radius).toBeCloseTo(210, 9);
    expect(offCircle.sweepAngle).toBeCloseTo(Math.PI / 2, 9);
    close(offCircle.start, [510, 300]);
    // B 离圆时只给方向：B=(0,-6) 与 B=(0,-5) 得到同一条弧。
    const far = arcOf(evalAt([...circle, pt(4, R, 0), pt(5, 0, -6), obj(6, 79, [3, 4, 5], 67)], 6));
    close(far.start, [R, 0]);
    close(far.end, [0, -R]);
    expect(far.radius).toBeCloseTo(R, 9);
    expect(far.sweepAngle).toBeCloseTo(Math.PI / 2, 9);
  });
  it('keeps the unverified boundaries distinct: A = B and a direction at the centre', () => {
    expect(evalAt([...circle, pt(4, R, 0), pt(5, R, 0), obj(6, 79, [3, 4, 5], 67)], 6)).toMatchObject({ status: 'unsupported', reason: 'arc-coincident-endpoints-unverified' });
    expect(evalAt([...circle, pt(4, 0, 0), pt(5, 0, -R), obj(6, 79, [3, 4, 5], 67)], 6)).toMatchObject({ status: 'not-existing', reason: 'arc-start-point-coincides-with-circle-center' });
    expect(evalAt([...circle, pt(4, R, 0), pt(5, 0, 0), obj(6, 79, [3, 4, 5], 67)], 6)).toMatchObject({ status: 'not-existing', reason: 'arc-end-point-coincides-with-circle-center' });
  });
  it('needs a circle then two points, and is nonexistent when a parent is', () => {
    expect(evalAt([...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [4, 4, 5], 67)], 6)).toMatchObject({ status: 'unsupported', reason: 'arc-on-circle-needs-circle-and-two-points' });
    expect(evalAt([pt(1, 0, 0), pt(2, 0, 0), obj(3, 2, [1, 2]), pt(4, 0, 0), pt(5, 1, 0), obj(6, 79, [3, 4, 5], 67)], 6).status).toBe('not-existing');
  });
});

describe('constraint 80: centre and two direction points', () => {
  it('uses |OA| as the radius and runs counter-clockwise', () => {
    const g = arcOf(evalAt([pt(1, 10, 10), pt(2, 13, 6), pt(3, 6, 13), obj(4, 80, [1, 2, 3], 67)], 4));
    close(g.center, [10, 10]);
    expect(g.radius).toBeCloseTo(5, 9);
    // A is at math angle atan2(4, 3), B at atan2(-3, -4); counter-clockwise from A to B is the wrapped difference.
    const expected = (Math.atan2(-3, -4) - Math.atan2(4, 3) + 2 * Math.PI) % (2 * Math.PI);
    expect(g.sweepAngle).toBeCloseTo(expected, 9);
    close(g.end, [6, 13]);
  });
  it('swapping the direction points gives the complementary arc', () => {
    const a = arcOf(evalAt([pt(1, 0, 0), pt(2, R, 0), pt(3, 0, -R), obj(4, 80, [1, 2, 3], 67)], 4));
    const b = arcOf(evalAt([pt(1, 0, 0), pt(2, R, 0), pt(3, 0, -R), obj(4, 80, [1, 3, 2], 67)], 4));
    expect(a.sweepAngle + b.sweepAngle).toBeCloseTo(2 * Math.PI, 9);
    close(a.end, b.start);
  });
  it('uses |OA| as the radius and lets B be closer or farther (card 80 synthesis)', () => {
    // 原版合成输入：O=(300,300)、A=(450,300) 时半径 150，B 从 (300,150) 移到 (300,90) 半径不变；
    // A 再改成 (510,300)、B=(300,150) 时半径 210，扫角都还是 90°。
    const arc = (ax: number, by: number) => arcOf(evalAt([pt(1, 300, 300), pt(2, ax, 300), pt(3, 300, by), obj(4, 80, [1, 2, 3], 67)], 4));
    for (const by of [150, 90]) {
      expect(arc(450, by).radius).toBeCloseTo(150, 9);
      expect(arc(450, by).sweepAngle).toBeCloseTo(Math.PI / 2, 9);
    }
    const wide = arc(510, 150);
    close(wide.center, [300, 300]);
    expect(wide.radius).toBeCloseTo(210, 9);
    expect(wide.sweepAngle).toBeCloseTo(Math.PI / 2, 9);
    close(wide.start, [510, 300]);
    // B 只提供方向：终边端点落在半径 210 的圆上，不是 B 自己的位置。
    close(wide.end, [300, 300 - 210]);
  });
  it('rejects only what the card leaves undefined, with distinct reasons', () => {
    expect(evalAt([pt(1, 0, 0), pt(2, 0, 0), pt(3, 0, -R), obj(4, 80, [1, 2, 3], 67)], 4)).toMatchObject({ status: 'not-existing', reason: 'arc-center-coincides-with-direction-point' });
    expect(evalAt([pt(1, 0, 0), pt(2, R, 0), pt(3, 0, 0), obj(4, 80, [1, 2, 3], 67)], 4)).toMatchObject({ status: 'not-existing', reason: 'arc-center-coincides-with-direction-point' });
    expect(evalAt([pt(1, 0, 0), pt(2, R, 0), pt(3, R, 0), obj(4, 80, [1, 2, 3], 67)], 4)).toMatchObject({ status: 'unsupported', reason: 'arc-coincident-directions-unverified' });
  });
});

describe('constraint 81: arc through three points', () => {
  it('takes the side of the circle that contains M, in either direction', () => {
    const top = arcOf(evalAt([pt(1, R, 0), pt(2, 0, -R), pt(3, -R, 0), obj(4, 81, [1, 2, 3], 67)], 4));
    expect(top.sweepAngle).toBeCloseTo(Math.PI, 9);
    close(top.center, [0, 0]);
    const bottom = arcOf(evalAt([pt(1, R, 0), pt(2, 0, R), pt(3, -R, 0), obj(4, 81, [1, 2, 3], 67)], 4));
    expect(bottom.sweepAngle).toBeCloseTo(-Math.PI, 9);
    // From the top through the left to the right is the long way round: 270 degrees, not the short 90.
    const long = arcOf(evalAt([pt(1, 0, -R), pt(2, -R, 0), pt(3, R, 0), obj(4, 81, [1, 2, 3], 67)], 4));
    expect(long.sweepAngle).toBeCloseTo(3 * Math.PI / 2, 9);
    close(long.start, [0, -R]);
    close(long.end, [R, 0]);
  });
  it('collinear points with M between A and B degrade to the chord, flagged as a degenerate arc', () => {
    const r = evalAt([pt(1, 0, 0), pt(2, 5, 0), pt(3, 10, 0), obj(4, 81, [1, 2, 3], 67)], 4);
    expect(r).toMatchObject({ status: 'ok', kind: 'segment', geometry: { a: [0, 0], b: [10, 0] }, degenerateArc: true, parameterizationKnown: false });
  });
  it('a radius beyond 30,000 page units also degrades to the chord', () => {
    expect(evalAt([pt(1, 0, 0), pt(2, 50, -0.001), pt(3, 100, 0), obj(4, 81, [1, 2, 3], 67)], 4)).toMatchObject({ kind: 'segment', degenerateArc: true });
    expect(evalAt([pt(1, 0, 0), pt(2, 50, -0.1), pt(3, 100, 0), obj(4, 81, [1, 2, 3], 67)], 4)).toMatchObject({ kind: 'arc' });
  });
  it('does not guess the collinear case with M outside the chord, and A = B has no path', () => {
    expect(evalAt([pt(1, 0, 0), pt(2, 15, 0), pt(3, 10, 0), obj(4, 81, [1, 2, 3], 67)], 4)).toMatchObject({ status: 'unsupported', reason: 'three-point-arc-degenerate-middle-outside-chord-unverified' });
    expect(evalAt([pt(1, 3, 3), pt(2, 5, 0), pt(3, 3, 3), obj(4, 81, [1, 2, 3], 67)], 4)).toMatchObject({ status: 'not-existing', reason: 'coincident-arc-endpoints' });
  });
  it('keeps the parent order: reversing A and B reverses the arc, not the circle', () => {
    const a = arcOf(evalAt([pt(1, R, 0), pt(2, 0, -R), pt(3, -R, 0), obj(4, 81, [1, 2, 3], 67)], 4));
    const b = arcOf(evalAt([pt(1, R, 0), pt(2, 0, -R), pt(3, -R, 0), obj(4, 81, [3, 2, 1], 67)], 4));
    expect(b.sweepAngle).toBeCloseTo(-a.sweepAngle, 9);
    close(b.start, a.end);
  });
});

describe('constraints 82 and 83: sector and circular segment', () => {
  const arc = [...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 5, 4], 67)];
  it('copy the large arc without choosing the smaller area', () => {
    const objects = [...arc, obj(7, 82, [6], 68), obj(8, 83, [6], 69)];
    const sector = evalAt(objects, 7), segment = evalAt(objects, 8);
    expect(sector).toMatchObject({ status: 'ok', kind: 'sector', geometry: { radius: R } });
    expect(segment).toMatchObject({ status: 'ok', kind: 'circular-segment', geometry: { radius: R } });
    if (sector.status === 'ok' && sector.kind === 'sector') expect(sector.geometry.sweepAngle).toBeCloseTo(3 * Math.PI / 2, 9);
  });
  it('follow the arc: nonexistent or unsupported parents propagate', () => {
    expect(evalAt([pt(1, 1, 1), pt(2, 5, 0), pt(3, 1, 1), obj(4, 81, [1, 2, 3], 67), obj(5, 82, [4], 68)], 5).status).toBe('not-existing');
    expect(evalAt([pt(1, 0, 0), pt(2, R, 0), pt(3, R, 0), obj(4, 80, [1, 2, 3], 67), obj(5, 83, [4], 69)], 5).status).toBe('unsupported');
  });
  it('refuse non-arc and degenerate-arc parents with their own reasons', () => {
    expect(evalAt([...circle, obj(4, 82, [3], 68)], 4)).toMatchObject({ status: 'unsupported', reason: 'arc-interior-needs-one-arc-parent' });
    expect(evalAt([pt(1, 0, 0), pt(2, 5, 0), pt(3, 10, 0), obj(4, 81, [1, 2, 3], 67), obj(5, 83, [4], 69)], 5)).toMatchObject({ status: 'unsupported', reason: 'arc-interior-of-degenerate-arc-unverified' });
  });
});

describe('constraint 15 on arcs and polygons', () => {
  const quarter = [...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 4, 5], 67)];
  it('arc parameter is the arc-length fraction from start to end', () => {
    close(pointOf(evalAt([...quarter, t12(7, 6, 67, 0.5)], 7)), [R * Math.SQRT1_2, -R * Math.SQRT1_2]);
    close(pointOf(evalAt([...quarter, t12(7, 6, 67, 1)], 7)), [0, -R]);
    close(pointOf(evalAt([...quarter, t12(7, 6, 67, 0)], 7)), [R, 0]);
    expect(evalAt([...quarter, t12(7, 6, 67, 1.2)], 7)).toMatchObject({ status: 'not-existing', reason: 'path-parameter-outside-range' });
    expect(evalAt([...quarter, t12(7, 6, 67, -0.2)], 7)).toMatchObject({ status: 'not-existing' });
  });
  it('on the complementary arc the same fraction lands elsewhere', () => {
    const swapped = [...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 5, 4], 67)];
    close(pointOf(evalAt([...swapped, t12(7, 6, 67, 0.5)], 7)), [-R * Math.SQRT1_2, R * Math.SQRT1_2]);
  });
  it('arc path point reports a layout or genera mismatch instead of guessing', () => {
    expect(evalAt([...quarter, t12(7, 6, 28, 0.5)], 7)).toMatchObject({ status: 'unsupported', reason: 'native-path-genera-mismatch' });
    expect(evalAt([...quarter, polygonParam(7, 6, 67, 0.5, 0)], 7)).toMatchObject({ status: 'unsupported', reason: 'native-arc-parameter-layout' });
  });
  it('degenerate three-point arc stays unsupported as a path', () => {
    expect(evalAt([pt(1, 0, 0), pt(2, 5, 0), pt(3, 10, 0), obj(4, 81, [1, 2, 3], 67), t12(5, 4, 67, 0.5)], 5)).toMatchObject({ status: 'unsupported', reason: 'path-direction-and-unit-unverified' });
  });
  const tri = [pt(1, 0, 0), pt(2, 10, 0), pt(3, 10, 10), obj(4, 8, [1, 2, 3], 52)];
  it('polygon parameter is Vi + s (V(i+1) - Vi), wrapping the closing edge', () => {
    close(pointOf(evalAt([...tri, polygonParam(5, 4, 52, 0.25, 0)], 5)), [2.5, 0]);
    close(pointOf(evalAt([...tri, polygonParam(5, 4, 52, 0.5, 1)], 5)), [10, 5]);
    close(pointOf(evalAt([...tri, polygonParam(5, 4, 52, 0.5, 2)], 5)), [5, 5]);
  });
  it('polygon edge index and parameter errors are explicit', () => {
    expect(evalAt([...tri, polygonParam(5, 4, 52, 0.5, 3)], 5)).toMatchObject({ status: 'unsupported', reason: 'native-polygon-edge-index-out-of-range' });
    expect(evalAt([...tri, polygonParam(5, 4, 52, 1.5, 0)], 5)).toMatchObject({ status: 'unsupported', reason: 'native-polygon-parameter-out-of-range-unverified' });
    expect(evalAt([...tri, t12(5, 4, 52, 0.5)], 5)).toMatchObject({ status: 'unsupported', reason: 'native-polygon-parameter-layout' });
  });
});

describe('intersections 11-14 with arc parents', () => {
  const line = [pt(10, -10, -3), pt(11, 10, -3), obj(12, 63, [10, 11])];
  const quarter = [...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 4, 5], 67)];
  it('accepts only candidates inside the directed arc range', () => {
    // y = -3 meets the circle at x = +-4; only (4,-3) is on the first-quadrant arc.
    for (const id of [11, 12]) close(pointOf(evalAt([...quarter, ...line, obj(13, id, [12, 6])], 13)), [4, -3]);
  });
  it('rejects hits outside the arc range; the complementary arc takes them back (two valid roots are not guessed)', () => {
    const below = [pt(10, -10, 3), pt(11, 10, 3), obj(12, 63, [10, 11])];
    expect(evalAt([...quarter, ...below, obj(13, 11, [12, 6])], 13)).toMatchObject({ status: 'not-existing', reason: 'intersection-outside-parent-range' });
    const complement = [...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 5, 4], 67)];
    expect(evalAt([...complement, ...below, obj(13, 12, [12, 6])], 13)).toMatchObject({ status: 'unsupported', reason: 'intersection-arc-root-order-unverified' });
  });
  it('a line that misses the supporting circle stays nonexistent', () => {
    const far = [pt(10, -10, -9), pt(11, 10, -9), obj(12, 63, [10, 11])];
    expect(evalAt([...quarter, ...far, obj(13, 11, [12, 6])], 13)).toMatchObject({ status: 'not-existing', reason: 'line-circle-no-intersection' });
  });
  it('segment ends are still honoured as the first parent range', () => {
    const shortSegment = [pt(10, 0, -3), pt(11, 3, -3), obj(12, 2, [10, 11])];
    expect(evalAt([...quarter, ...shortSegment, obj(13, 11, [12, 6])], 13)).toMatchObject({ status: 'not-existing' });
  });
  it('circle-circle: the arc range filters the candidates and both ids agree on a single valid one', () => {
    const second = [pt(20, 6, 0), pt(21, 11, 0), obj(22, 3, [20, 21])];
    const top = [pt(23, 11, 0), pt(24, 1, 0), obj(25, 79, [22, 23, 24], 67)];
    for (const id of [13, 14]) close(pointOf(evalAt([...circle, ...second, ...top, obj(26, id, [3, 25])], 26)), [3, -4]);
    const bottom = [pt(23, 1, 0), pt(24, 11, 0), obj(25, 79, [22, 23, 24], 67)];
    close(pointOf(evalAt([...circle, ...second, ...bottom, obj(26, 13, [3, 25])], 26)), [3, 4]);
    close(pointOf(evalAt([...circle, ...second, ...bottom, obj(26, 14, [25, 3])], 26)), [3, 4]);
  });
  it('circle-circle with two valid arc candidates is not guessed', () => {
    const second = [pt(20, 6, 0), pt(21, 11, 0), obj(22, 3, [20, 21])];
    const [ax, ay] = polar(170, 6), [bx, by] = polar(160, 6);
    const wide = [pt(23, ax, ay), pt(24, bx, by), obj(25, 79, [22, 23, 24], 67)];
    expect(evalAt([...circle, ...second, ...wide, obj(26, 13, [3, 25])], 26)).toMatchObject({ status: 'unsupported', reason: 'intersection-arc-root-order-unverified' });
  });
  it('a degenerate 81 arc intersects as a linear object', () => {
    const deg = [pt(20, -10, -3), pt(21, 0, -3), pt(22, 10, -3), obj(23, 81, [20, 21, 22], 67)];
    const vertical = [pt(30, 1, -10), pt(31, 1, 10), obj(32, 63, [30, 31])];
    close(pointOf(evalAt([...deg, ...vertical, obj(33, 11, [32, 23])], 33)), [1, -3]);
    // The chord y = -3 cuts the circle twice; which root 13/14 prefer for that mix is unknown.
    expect(evalAt([...circle, ...deg, obj(33, 13, [3, 23])], 33)).toMatchObject({ status: 'unsupported', reason: 'intersection-degenerate-arc-root-order-unverified' });
    const chordEnd = [pt(20, 0, -3), pt(21, 2, -3), pt(22, 5, -3), obj(23, 81, [20, 21, 22], 67)];
    close(pointOf(evalAt([...circle, ...chordEnd, obj(33, 14, [23, 3])], 33)), [4, -3]);
  });
});

describe('dragging through an arc', () => {
  it('moving a free parent recomputes only the arc, its dependants and nothing else', () => {
    const p = page(...circle, pt(4, R, 0), pt(5, 0, -R), obj(6, 79, [3, 4, 5], 67), t12(7, 6, 67, 0.5), obj(8, 82, [6], 68), pt(9, 100, 100));
    const evaluator = new PageGeometryEvaluator(p);
    close(pointOf(evaluator.evaluate().objects[6]), [R * Math.SQRT1_2, -R * Math.SQRT1_2]);
    // Drag B from (0,-5) to (-5,0): the quarter arc becomes a half arc, so its midpoint moves to the top.
    const payload = p.objects[4]!.node.records[0]!.payload;
    new DataView(payload.buffer, payload.byteOffset).setFloat64(0, -R, true);
    new DataView(payload.buffer, payload.byteOffset).setFloat64(8, 0, true);
    evaluator.invalidate(5);
    const after = evaluator.evaluate();
    expect(evaluator.recomputedIndices.sort((a, b) => a - b)).toEqual([5, 6, 7, 8]);
    close(pointOf(after.objects[6]), [0, -R]);
    expect(arcOf(after.objects[5]).sweepAngle).toBeCloseTo(Math.PI, 9);
    expect(after.objects[7]).toMatchObject({ kind: 'sector' });
  });
});

describe('corpus: arcs by constraint id', () => {
  it.skipIf(!corpusAvailable())('every evaluated arc and interior has finite, non-degenerate geometry', () => {
    let seen = 0;
    for (const file of corpusFiles()) {
      const model = readDocumentModel(parseGsp(readBytes(file)));
      for (const pg of model.pages) {
        for (const r of evaluatePageGeometry(pg).objects) {
          if (![79, 80, 81, 82, 83].includes(r.constraintId) || r.status !== 'ok') continue;
          if (r.kind === 'segment') { expect(r.constraintId).toBe(81); continue; }
          if (r.kind !== 'arc' && r.kind !== 'sector' && r.kind !== 'circular-segment') throw new Error(`unexpected kind ${r.kind}`);
          seen++;
          expect(r.geometry.radius).toBeGreaterThan(0);
          expect(Math.abs(r.geometry.sweepAngle ?? 0)).toBeGreaterThan(0);
          expect(Math.abs(r.geometry.sweepAngle ?? 0)).toBeLessThan(2 * Math.PI);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 120_000);
});
