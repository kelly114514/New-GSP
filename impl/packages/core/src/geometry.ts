import { ARC_ANGLE_TOLERANCE, ARC_SEGMENT_LIMIT, circumcircle, directedSweep, inArcRange, mathAngle, pointAtAngle, sweepThrough } from './arc.ts';
import { readF64, readU16, readU32 } from './bytes.ts';
import { setFreePointCoordinates } from './edit.ts';
import { evaluateMeasure, isMeasureObject } from './measure.ts';
import type { MeasureGeometry } from './measure.ts';
import type { ContainerModel, DocumentModel, ObjectInfo } from './model.ts';
import { isNumericParameterTransform, numericParameterTransform } from './transform-numeric.ts';
import { isContainerNode, isEnvelopeNode } from './tree.ts';
import type { GspDocument } from './tree.ts';
import { decodeFreePoint } from './views/object.ts';

export type XY = [number, number];
export interface PointGeometry { kind: 'point'; geometry: { x: number; y: number } }
export type LinearGeometry = { [K in 'segment' | 'line' | 'ray']: {
  kind: K;
  geometry: { a: XY; b: XY };
  parameterizationKnown: boolean;
  /** Set when constraint 81 degenerated into the chord A-B (card 81); it intersects as a linear object. */
  degenerateArc?: true;
} }['segment' | 'line' | 'ray'];
export interface CircleGeometry { kind: 'circle'; geometry: { center: XY; radius: number } }
export interface PolygonGeometry { kind: 'polygon'; geometry: { vertices: XY[] } }
/**
 * Angles are math angles (see arc.ts): point = center + r(cos a, -sin a), positive sweep is counter-clockwise on screen.
 * An arc whose three-point circle degenerates (card 81) is a LinearGeometry segment with degenerateArc set instead.
 */
export interface ArcGeometry {
  kind: 'arc';
  geometry: { center: XY; radius: number; startAngle: number; sweepAngle: number; start: XY; end: XY };
}
export type RegionGeometry = { [K in 'disk' | 'sector' | 'circular-segment']: {
  kind: K;
  geometry: { center: XY; radius: number; startAngle?: number; sweepAngle?: number; start?: XY; end?: XY };
} }['disk' | 'sector' | 'circular-segment'];
export type Geometry = PointGeometry | LinearGeometry | CircleGeometry | PolygonGeometry | ArcGeometry | RegionGeometry | MeasureGeometry;
export type GeometryStatus = 'ok' | 'not-existing' | 'unsupported' | 'unbound-input';
export type EvaluatedObject = { objectIndex: number; constraintId: number } & (
  | ({ exists: true; status: 'ok' } & Geometry)
  | { exists: false; status: 'not-existing'; reason: string }
  | { exists: null; status: 'unsupported' | 'unbound-input'; reason: string }
);
export interface PageGeometry { pageIndex: number; objects: EvaluatedObject[] }
export interface GeometryDocument { schema: 'gsp-core-geometry-v1'; pages: PageGeometry[] }

type Failure = { status: Exclude<GeometryStatus, 'ok'>; reason: string };
type Outcome = Geometry | Failure;
const unsupported = (reason: string): Failure => ({ status: 'unsupported', reason });
const absent = (reason: string): Failure => ({ status: 'not-existing', reason });
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const cross = (a: XY, b: XY): number => a[0] * b[1] - a[1] * b[0];
const length = (a: XY): number => Math.hypot(...a);
const at = (a: XY, d: XY, t: number): XY => [a[0] + t * d[0], a[1] + t * d[1]];
const point = (p: XY): PointGeometry => ({ kind: 'point', geometry: { x: p[0], y: p[1] } });
const pointXY = (p: PointGeometry): XY => [p.geometry.x, p.geometry.y];
function isLinear(g: Geometry): g is LinearGeometry { return g.kind === 'segment' || g.kind === 'line' || g.kind === 'ray'; }
function inLinearRange(g: LinearGeometry, t: number): boolean {
  const e = 64 * Number.EPSILON * Math.max(1, Math.abs(t));
  return g.kind === 'line' || (t >= -e && (g.kind === 'ray' || t <= 1 + e));
}
function inUnitRange(t: number): boolean { const e = 64 * Number.EPSILON * Math.max(1, Math.abs(t)); return t >= -e && t <= 1 + e; }
function finiteGeometry(g: Geometry): boolean {
  if (g.kind === 'measure') {
    return Number.isFinite(g.measurement.displayValue) && Number.isFinite(g.measurement.internal.magnitude);
  }
  if (g.kind === 'point') return Number.isFinite(g.geometry.x) && Number.isFinite(g.geometry.y);
  if (isLinear(g)) return [...g.geometry.a, ...g.geometry.b].every(Number.isFinite);
  if (g.kind === 'polygon') return g.geometry.vertices.flat().every(Number.isFinite);
  const { center, radius, start, end } = g.geometry as { center: XY; radius: number; start?: XY; end?: XY };
  return [...center, radius, ...(start ?? []), ...(end ?? []), ...('startAngle' in g.geometry ? [g.geometry.startAngle, g.geometry.sweepAngle] : [])].every((v) => v === undefined || Number.isFinite(v));
}

/** `start`/`end` are the page-space end points, derived from the angles so the exchange format does not depend on the orientation convention. */
function arcOf(center: XY, radius: number, startAngle: number, sweepAngle: number): ArcGeometry {
  return { kind: 'arc', geometry: { center, radius, startAngle, sweepAngle, start: pointAtAngle(center, radius, startAngle), end: pointAtAngle(center, radius, startAngle + sweepAngle) } };
}
type Circular = CircleGeometry | ArcGeometry;
function isCircular(g: Geometry): g is Circular { return g.kind === 'circle' || g.kind === 'arc'; }
function isDegenerateArc(g: Geometry): g is LinearGeometry & { degenerateArc: true } { return isLinear(g) && g.degenerateArc === true; }

/** Card 9 style crossing of two linear objects; also used when a degenerate 81 arc takes part in 11-14. */
function intersectLinear(first: LinearGeometry, second: LinearGeometry): Outcome {
  const a = first.geometry.a, b = second.geometry.a;
  const d = sub(first.geometry.b, a), e = sub(second.geometry.b, b);
  const den = cross(d, e);
  if (Math.abs(den) <= 32 * Number.EPSILON * length(d) * length(e)) return absent('parallel-or-coincident-lines');
  const t = cross(sub(b, a), e) / den, u = cross(sub(b, a), d) / den;
  return inLinearRange(first, t) && inLinearRange(second, u) ? point(at(a, d, t)) : absent('intersection-outside-parent-range');
}

/**
 * Points where the supporting line meets the supporting circle, ascending in the line parameter,
 * restricted to the linear range and (for arcs) the directed arc range. An empty list carries the reason.
 */
function lineCircleCandidates(l: LinearGeometry, c: Circular): { points: XY[] } | Failure {
  const origin = l.geometry.a, d = sub(l.geometry.b, origin);
  const qa = d[0] * d[0] + d[1] * d[1];
  if (qa === 0) return absent('degenerate-direction');
  const offset = sub(origin, c.geometry.center), radius = c.geometry.radius;
  const qb = 2 * (d[0] * offset[0] + d[1] * offset[1]);
  const qc = offset[0] * offset[0] + offset[1] * offset[1] - radius * radius;
  const discriminant = qb * qb - 4 * qa * qc;
  const tolerance = 64 * Number.EPSILON * (qb * qb + Math.abs(4 * qa * qc));
  if (discriminant < -tolerance) return absent('line-circle-no-intersection');
  const roots = discriminant <= tolerance
    ? [-qb / (2 * qa)]
    : [(-qb - Math.sqrt(discriminant)) / (2 * qa), (-qb + Math.sqrt(discriminant)) / (2 * qa)];
  const points = roots.filter((t) => inLinearRange(l, t)).map((t) => at(origin, d, t))
    .filter((p) => c.kind !== 'arc' || inArcRange(c.geometry, p));
  return points.length === 0 ? absent('intersection-outside-parent-range') : { points };
}

/** Similarities use page coordinates. The separate scale/orientation avoid cancellation in det(M). */
interface Similarity { xx: number; xy: number; yx: number; yy: number; tx: number; ty: number; scale: number; orientation: 1 | -1 }
function transformGeometry(source: Geometry, m: Similarity): Geometry {
  if (source.kind === 'measure') return source;
  const map = ([x, y]: XY): XY => [m.xx * x + m.xy * y + m.tx, m.yx * x + m.yy * y + m.ty];
  if (source.kind === 'point') return point(map(pointXY(source)));
  if (isLinear(source)) return { kind: source.kind, geometry: { a: map(source.geometry.a), b: map(source.geometry.b) }, parameterizationKnown: source.parameterizationKnown, ...(source.degenerateArc ? { degenerateArc: true } : {}) };
  if (source.kind === 'polygon') return { kind: 'polygon', geometry: { vertices: source.geometry.vertices.map(map) } };
  const g = source.geometry, center = map(g.center), radius = g.radius * m.scale;
  if (source.kind === 'circle' || source.kind === 'disk') return { kind: source.kind, geometry: { center, radius } };
  const arc = source.geometry;
  const start = map(arc.start!), end = map(arc.end!);
  const startAngle = mathAngle(start[0] - center[0], start[1] - center[1]);
  return { kind: source.kind, geometry: { center, radius, startAngle, sweepAngle: arc.sweepAngle! * m.orientation, start, end } };
}
const identity = (): Similarity => ({ xx: 1, xy: 0, yx: 0, yy: 1, tx: 0, ty: 0, scale: 1, orientation: 1 });
function centeredMatrix(center: XY, xx: number, xy: number, yx: number, yy: number, scale: number, orientation: 1 | -1 = 1): Similarity {
  return { xx, xy, yx, yy, scale, orientation, tx: center[0] - xx * center[0] - xy * center[1], ty: center[1] - yx * center[0] - yy * center[1] };
}
function transform(o: ObjectInfo, p: Geometry[]): Outcome | undefined {
  const id = o.constraintId;
  if (![16, 17, 21, 27, 28, 30, 32, 34, 75].includes(id) && !isNumericParameterTransform(id)) return undefined;
  const source = p[0];
  if (source === undefined) return unsupported('transform-needs-source');
  if (source.kind === 'measure') return unsupported('transform-source-not-geometric');
  if (id === 75) return transformGeometry(source, identity()); // Card 75: geometry only; the colour formula is unspecified (questions.md Q10.1).
  if (isNumericParameterTransform(id)) {
    // Cards 18-20/23-26/29/31/33: the displacement/angle/ratio comes from a numeric parent, so the
    // matrix depends on measured values; the shape transform itself stays shared with 16-34.
    const outcome = numericParameterTransform(id, p, o.node.records.find((r) => r.kind === 2003)?.payload);
    return outcome.ok ? transformGeometry(source, outcome.matrix) : { status: outcome.status, reason: outcome.reason };
  }
  let m = identity();
  const expectedParents = id === 16 ? 3 : id === 17 || id === 21 ? 1 : id === 28 || id === 32 ? 5 : 2;
  if (p.length !== expectedParents) return unsupported('transform-parent-count');
  const fixedSize = id === 17 ? 52 : id === 21 ? 60 : id === 27 ? 36 : id === 30 ? 12 : undefined;
  const payload = o.node.records.find((r) => r.kind === 2003)?.payload;
  if (fixedSize !== undefined && (payload === undefined || payload.length !== fixedSize || readU32(payload, 0) !== id)) return unsupported('invalid-native-transform-parameter');
  if (id === 17) {
    m.tx = readF64(payload!, 4); m.ty = -readF64(payload!, 24);
  } else if (id === 21 || id === 27) {
    const a = readF64(payload!, 4), b = readF64(payload!, 12);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return absent('non-finite-transform-parameter');
    if (Math.abs(Math.hypot(a, b) - 1) > 1e-8) return unsupported('invalid-native-transform-direction');
    // Native (a,b)=(-sin(theta),cos(theta)); units/angle display fields do not drive geometry.
    if (id === 21) {
      const distance = readF64(payload!, 32);
      m.tx = distance * b; m.ty = distance * a;
    } else {
      if (p[1]?.kind !== 'point') return unsupported('transform-center-must-be-point');
      m = centeredMatrix(pointXY(p[1]), b, -a, a, b, 1);
    }
  } else if (id === 34) {
    const mirror = p[1];
    if (mirror === undefined || !isLinear(mirror)) return unsupported('reflection-mirror-must-be-linear');
    const d = sub(mirror.geometry.b, mirror.geometry.a), size = length(d);
    if (size === 0) return absent('degenerate-reflection-mirror');
    const dx = d[0] / size, dy = d[1] / size;
    m = centeredMatrix(mirror.geometry.a, 2 * dx * dx - 1, 2 * dx * dy, 2 * dx * dy, 2 * dy * dy - 1, 1, -1);
  } else {
    if (p.slice(1).some((g) => g.kind !== 'point')) return unsupported('transform-parameters-must-be-points');
    if (id === 16) {
      const delta = sub(pointXY(p[2] as PointGeometry), pointXY(p[1] as PointGeometry));
      [m.tx, m.ty] = delta;
    } else {
      const center = pointXY(p[1] as PointGeometry);
      if (id === 28) {
        const u = sub(pointXY(p[2] as PointGeometry), pointXY(p[3] as PointGeometry));
        const v = sub(pointXY(p[4] as PointGeometry), pointXY(p[3] as PointGeometry));
        const ul = length(u), vl = length(v);
        if (ul === 0 || vl === 0) return absent('zero-angle-arm');
        const ux = u[0] / ul, uy = u[1] / ul, vx = v[0] / vl, vy = v[1] / vl;
        const cos = ux * vx + uy * vy, sin = uy * vx - ux * vy;
        m = centeredMatrix(center, cos, sin, -sin, cos, 1);
      } else {
        let ratio: number;
        if (id === 30) ratio = readF64(payload!, 4);
        else {
          const d = pointXY(p[2] as PointGeometry), e = sub(pointXY(p[3] as PointGeometry), d), f = sub(pointXY(p[4] as PointGeometry), d);
          const denominator = length(e), numerator = length(f);
          if (denominator === 0) return absent('zero-ratio-denominator');
          if (Math.abs(cross(e, f)) > 64 * Number.EPSILON * denominator * numerator) return unsupported('three-point-ratio-noncollinear-unverified');
          ratio = numerator / denominator * (e[0] * f[0] + e[1] * f[1] < 0 ? -1 : 1);
        }
        if (!Number.isFinite(ratio)) return absent('non-finite-transform-parameter');
        if (ratio === 0) return unsupported('zero-scale-existence-unverified');
        m = centeredMatrix(center, ratio, 0, 0, ratio, Math.abs(ratio));
      }
    }
  }
  if (![m.xx, m.xy, m.yx, m.yy, m.tx, m.ty, m.scale].every(Number.isFinite)) return absent('non-finite-transform-parameter');
  return transformGeometry(source, m);
}

function construct(o: ObjectInfo, parents: Geometry[], page: ContainerModel, byIndex: ReadonlyMap<number, ObjectInfo>): Outcome {
  const p = parents;
  const first = p[0];
  const second = p[1];
  const id = o.constraintId;
  const transformed = transform(o, p);
  if (transformed !== undefined) return transformed;
  if (isMeasureObject(o)) {
    const measured = evaluateMeasure(o, p, page);
    return measured.ok
      ? { kind: 'measure', measurement: measured.measurement }
      : { status: measured.status, reason: measured.reason };
  }
  if (id === 0) {
    if (o.mainKind !== 1) return unsupported('free-object-main-kind');
    if (page.type === 'tool' && o.genera !== 4) return { status: 'unbound-input', reason: 'tool-input-not-bound' };
    const r = o.node.records.find((r) => r.kind === 2201);
    const xy = r === undefined ? undefined : decodeFreePoint(r.payload);
    if (xy === undefined) return absent('missing-free-point-coordinates');
    return point([xy.x, xy.y]);
  }
  if (id === 1) {
    if (p.length !== 1 || first?.kind !== 'segment') return unsupported('midpoint-parent-must-be-segment');
    return point(at(first.geometry.a, sub(first.geometry.b, first.geometry.a), 0.5));
  }
  if (id === 2 || id === 3 || id === 63 || id === 64) {
    if (p.length !== 2 || first?.kind !== 'point' || second?.kind !== 'point') return unsupported('expected-two-point-parents');
    const a = pointXY(first), b = pointXY(second);
    const size = length(sub(b, a));
    if (id === 3) return size === 0 ? unsupported('zero-radius-circle-boundary-unverified') : { kind: 'circle', geometry: { center: a, radius: size } };
    if (size === 0) return absent('coincident-defining-points');
    return { kind: id === 2 ? 'segment' : id === 63 ? 'line' : 'ray', geometry: { a, b }, parameterizationKnown: true };
  }
  if (id === 4) {
    if (p.length !== 2 || first?.kind !== 'point' || second?.kind !== 'segment') return unsupported('circle-radius-provider-not-supported');
    const radius = length(sub(second.geometry.b, second.geometry.a));
    return radius === 0 ? unsupported('zero-radius-circle-boundary-unverified') : { kind: 'circle', geometry: { center: pointXY(first), radius } };
  }
  if (id === 5 || id === 6) {
    if (p.length !== 2 || first?.kind !== 'point' || second === undefined || !isLinear(second)) return unsupported('expected-point-and-linear-parents');
    let d = sub(second.geometry.b, second.geometry.a);
    if (length(d) === 0) return absent('degenerate-direction');
    if (id === 5) d = [-d[1], d[0]];
    const a = pointXY(first);
    return { kind: 'line', geometry: { a: at(a, d, -0.5), b: at(a, d, 0.5) }, parameterizationKnown: second.parameterizationKnown };
  }
  if (id === 7) {
    if (p.length !== 3 || p.some((g) => g.kind !== 'point')) return unsupported('angle-bisector-needs-three-points');
    const a = pointXY(p[0] as PointGeometry), b = pointXY(p[1] as PointGeometry), c = pointXY(p[2] as PointGeometry);
    const u = sub(a, b), v = sub(c, b), ul = length(u), vl = length(v);
    if (ul === 0 || vl === 0) return absent('zero-angle-arm');
    if (Math.abs(cross(u, v)) <= 32 * Number.EPSILON * ul * vl) return unsupported('collinear-angle-bisector-boundary-unverified');
    const d: XY = [u[0] / ul + v[0] / vl, u[1] / ul + v[1] / vl];
    return { kind: 'ray', geometry: { a: b, b: at(b, d, 1) }, parameterizationKnown: false };
  }
  if (id === 10) {
    if (p.length !== 1 || first?.kind !== 'circle') return unsupported('disk-needs-circle-parent');
    return { kind: 'disk', geometry: { ...first.geometry } };
  }
  if (id === 79) {
    if (p.length !== 3 || first?.kind !== 'circle' || second?.kind !== 'point' || p[2]?.kind !== 'point') return unsupported('arc-on-circle-needs-circle-and-two-points');
    // Card 79: the centre comes from the parent circle but the radius is |OA| — equal to the parent
    // radius only while A sits on the circle; B contributes the end direction alone.
    const { center } = first.geometry, a = pointXY(second), b = pointXY(p[2]);
    const radius = length(sub(a, center));
    if (radius === 0) return absent('arc-start-point-coincides-with-circle-center');
    const endOffset = sub(b, center);
    if (length(endOffset) === 0) return absent('arc-end-point-coincides-with-circle-center');
    const start = mathAngle(a[0] - center[0], a[1] - center[1]);
    const sweep = directedSweep(start, mathAngle(endOffset[0], endOffset[1]));
    if (Math.abs(sweep) <= ARC_ANGLE_TOLERANCE || Math.abs(sweep) >= 2 * Math.PI - ARC_ANGLE_TOLERANCE) return unsupported('arc-coincident-endpoints-unverified');
    return arcOf(center, radius, start, sweep);
  }
  if (id === 80) {
    if (p.length !== 3 || p.some((g) => g.kind !== 'point')) return unsupported('arc-from-center-needs-three-points');
    // Card 80: radius is |OA|; B only supplies the end direction, so |OA| != |OB| is allowed.
    const center = pointXY(p[0] as PointGeometry), a = pointXY(p[1] as PointGeometry), b = pointXY(p[2] as PointGeometry);
    const radius = length(sub(a, center));
    if (radius === 0 || length(sub(b, center)) === 0) return absent('arc-center-coincides-with-direction-point');
    const start = mathAngle(a[0] - center[0], a[1] - center[1]);
    const sweep = directedSweep(start, mathAngle(b[0] - center[0], b[1] - center[1]));
    if (Math.abs(sweep) <= ARC_ANGLE_TOLERANCE || Math.abs(sweep) >= 2 * Math.PI - ARC_ANGLE_TOLERANCE) return unsupported('arc-coincident-directions-unverified');
    return arcOf(center, radius, start, sweep);
  }
  if (id === 81) {
    if (p.length !== 3 || p.some((g) => g.kind !== 'point')) return unsupported('three-point-arc-needs-three-points');
    const a = pointXY(p[0] as PointGeometry), m = pointXY(p[1] as PointGeometry), b = pointXY(p[2] as PointGeometry);
    const chord = sub(b, a), chordSquared = chord[0] * chord[0] + chord[1] * chord[1];
    if (chordSquared === 0) return absent('coincident-arc-endpoints');
    const circle = circumcircle(a, m, b);
    if (circle === undefined || circle.radius > ARC_SEGMENT_LIMIT || Math.abs(circle.center[0]) > ARC_SEGMENT_LIMIT || Math.abs(circle.center[1]) > ARC_SEGMENT_LIMIT) {
      // Card 81: the collinear / huge-circle case degrades to the chord A-B; where M must sit for that is unverified.
      const along = ((m[0] - a[0]) * chord[0] + (m[1] - a[1]) * chord[1]) / chordSquared;
      if (along <= 0 || along >= 1) return unsupported('three-point-arc-degenerate-middle-outside-chord-unverified');
      return { kind: 'segment', geometry: { a, b }, parameterizationKnown: false, degenerateArc: true };
    }
    const { start, sweep } = sweepThrough(circle.center, a, m, b);
    return arcOf(circle.center, circle.radius, start, sweep);
  }
  if (id === 82 || id === 83) {
    if (p.length !== 1 || first === undefined) return unsupported('arc-interior-needs-one-arc-parent');
    if (isDegenerateArc(first)) return unsupported('arc-interior-of-degenerate-arc-unverified');
    if (first.kind !== 'arc') return unsupported('arc-interior-needs-one-arc-parent');
    return { kind: id === 82 ? 'sector' : 'circular-segment', geometry: { ...first.geometry } };
  }
  if (id === 93) {
    if (p.length !== 2 || first?.kind !== 'ray' || second?.kind !== 'polygon') return unsupported('first-boundary-intersection-needs-ray-and-polygon');
    const a = first.geometry.a, d = sub(first.geometry.b, a), vertices = second.geometry.vertices;
    const dl = length(d);
    if (dl === 0) return absent('degenerate-ray');
    let earliest = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const b = vertices[i]!, e = sub(vertices[(i + 1) % vertices.length]!, b), el = length(e);
      if (el === 0) continue;
      const den = cross(d, e), offset = sub(b, a);
      if (Math.abs(den) <= 32 * Number.EPSILON * dl * el) {
        if (Math.abs(cross(offset, d)) <= 32 * Number.EPSILON * Math.max(1, length(offset)) * dl) {
          const t0 = (offset[0] * d[0] + offset[1] * d[1]) / (dl * dl);
          const t1 = t0 + (e[0] * d[0] + e[1] * d[1]) / (dl * dl);
          if (Math.max(t0, t1) >= 0) return unsupported('ray-overlaps-polygon-edge-boundary-unverified');
        }
        continue;
      }
      const t = cross(offset, e) / den, u = cross(offset, d) / den;
      if (t >= 0 && u >= -64 * Number.EPSILON && u <= 1 + 64 * Number.EPSILON) earliest = Math.min(earliest, t);
    }
    if (!Number.isFinite(earliest)) return absent('no-forward-polygon-boundary-intersection');
    if (earliest === 0) return unsupported('ray-origin-on-polygon-boundary-unverified');
    return point(at(a, d, earliest));
  }
  if (id === 98) return unsupported('unsupported-parent:sampled-curve');
  if (id === 8) {
    if (p.length < 3 || p.some((g) => g.kind !== 'point')) return unsupported('polygon-needs-at-least-three-point-parents');
    return { kind: 'polygon', geometry: { vertices: p.map((g) => pointXY(g as PointGeometry)) } };
  }
  if (id === 9) {
    if (p.length !== 2 || first === undefined || second === undefined || !isLinear(first) || !isLinear(second)) return unsupported('expected-two-linear-parents');
    return intersectLinear(first, second);
  }
  if (id === 11 || id === 12) {
    if (p.length !== 2 || first === undefined || second === undefined || !isLinear(first)) return unsupported('expected-linear-and-circle-parents');
    if (isDegenerateArc(second)) return intersectLinear(first, second);
    if (!isCircular(second)) return unsupported('intersection-circle-parent-required');
    const found = lineCircleCandidates(first, second);
    if ('status' in found) return found;
    if (second.kind === 'arc' && found.points.length > 1) return unsupported('intersection-arc-root-order-unverified');
    return point(id === 11 ? found.points[0]! : found.points[found.points.length - 1]!);
  }
  if (id === 13 || id === 14) {
    if (p.length !== 2 || first === undefined || second === undefined) return unsupported('expected-two-circle-parents');
    const f = isDegenerateArc(first), s2 = isDegenerateArc(second);
    if (f && s2) return intersectLinear(first, second);
    if (f || s2) {
      const line = (f ? first : second) as LinearGeometry, other = f ? second : first;
      if (!isCircular(other)) return unsupported('intersection-circle-parent-required');
      const found = lineCircleCandidates(line, other);
      if ('status' in found) return found;
      return found.points.length > 1 ? unsupported('intersection-degenerate-arc-root-order-unverified') : point(found.points[0]!);
    }
    if (!isCircular(first) || !isCircular(second)) return unsupported('intersection-circle-parent-required');
    const o1 = first.geometry.center, o2 = second.geometry.center;
    const r1 = first.geometry.radius, r2 = second.geometry.radius;
    const delta = sub(o2, o1), distance = length(delta);
    if (distance === 0) return absent('concentric-circle-parents');
    const ex = delta[0] / distance, ey = delta[1] / distance;
    const along = (r1 * r1 - r2 * r2 + distance * distance) / (2 * distance);
    const h2 = r1 * r1 - along * along;
    const tolerance = 64 * Number.EPSILON * (r1 * r1 + along * along);
    if (h2 < -tolerance) return absent('circle-circle-no-intersection');
    const h = h2 <= tolerance ? 0 : Math.sqrt(h2);
    const base: XY = [o1[0] + along * ex, o1[1] + along * ey];
    const candidate = (sign: number): XY => [base[0] + sign * h * ey, base[1] - sign * h * ex];
    if (first.kind === 'circle' && second.kind === 'circle') return point(candidate(id === 13 ? 1 : -1));
    // Arc parents: the sign rule is only known for whole circles (cards 13/14), so a second valid candidate is not guessed.
    const inRange = (q: XY): boolean => (first.kind !== 'arc' || inArcRange(first.geometry, q)) && (second.kind !== 'arc' || inArcRange(second.geometry, q));
    const valid = (h === 0 ? [candidate(1)] : [candidate(1), candidate(-1)]).filter(inRange);
    if (valid.length === 0) return absent('intersection-outside-parent-range');
    return valid.length > 1 ? unsupported('intersection-arc-root-order-unverified') : point(valid[0]!);
  }
  if (id === 15) {
    if (p.length !== 1 || first === undefined) return unsupported('path-point-needs-one-parent');
    const record = o.node.records.find((r) => r.kind === 2003);
    if (record === undefined) return unsupported('missing-native-path-parameter');
    if (record.payload.length < 4 || readU16(record.payload, 0) !== 15) return unsupported('invalid-native-path-parameter');
    const parentObject = byIndex.get(o.parents[0] ?? -1);
    if (parentObject === undefined || readU16(record.payload, 2) !== parentObject.genera) return unsupported('native-path-genera-mismatch');
    if (first.kind === 'circle') {
      if (record.payload.length !== 20) return unsupported('native-circle-parameter-layout');
      const u = readF64(record.payload, 4), v = readF64(record.payload, 12);
      if (!Number.isFinite(u) || !Number.isFinite(v)) return absent('non-finite-circle-direction');
      if (Math.abs(Math.hypot(u, v) - 1) > 1e-10) return unsupported('non-unit-native-circle-direction');
      const { center, radius } = first.geometry;
      return point([center[0] + radius * u, center[1] - radius * v]);
    }
    if (first.kind === 'arc') {
      // Card 15/79: logical parameter is the arc-length fraction from start to end, stored as a 12-byte f64 like linear paths.
      if (record.payload.length !== 12) return unsupported('native-arc-parameter-layout');
      const t = readF64(record.payload, 4);
      if (!Number.isFinite(t)) return absent('non-finite-path-parameter');
      if (!inUnitRange(t)) return absent('path-parameter-outside-range');
      const { center, radius, startAngle, sweepAngle } = first.geometry;
      return point(pointAtAngle(center, radius, startAngle + t * sweepAngle));
    }
    if (first.kind === 'polygon') {
      // Card 15: 20 bytes; +4 f64 local edge fraction s, +12 u16 zero-based edge index, +14..19 preserved but unread.
      if (record.payload.length !== 20) return unsupported('native-polygon-parameter-layout');
      const s = readF64(record.payload, 4), edge = readU16(record.payload, 12), vertices = first.geometry.vertices;
      if (!Number.isFinite(s)) return absent('non-finite-path-parameter');
      if (edge >= vertices.length) return unsupported('native-polygon-edge-index-out-of-range');
      if (!inUnitRange(s)) return unsupported('native-polygon-parameter-out-of-range-unverified');
      const v0 = vertices[edge]!, v1 = vertices[(edge + 1) % vertices.length]!;
      return point(at(v0, sub(v1, v0), s));
    }
    if (!isLinear(first)) return unsupported('native-path-parameter-not-supported');
    if (!first.parameterizationKnown) return unsupported('path-direction-and-unit-unverified');
    if (record.payload.length !== 12) return unsupported('native-linear-parameter-layout');
    const t = readF64(record.payload, 4);
    if (!Number.isFinite(t)) return absent('non-finite-path-parameter');
    return inLinearRange(first, t) ? point(at(first.geometry.a, sub(first.geometry.b, first.geometry.a), t)) : absent('path-parameter-outside-range');
  }
  return unsupported(`constraint-${id}-not-supported`);
}

/** A page-local dependency graph. Updating a free point only invalidates its descendants. */
export class PageGeometryEvaluator {
  readonly page: ContainerModel;
  private readonly byIndex = new Map<number, ObjectInfo>();
  private readonly children = new Map<number, Set<number>>();
  private readonly cache = new Map<number, EvaluatedObject>();
  private readonly dirty = new Set<number>();
  /** Objects recomputed by the most recent evaluate() call, useful for diagnostics. */
  recomputedIndices: number[] = [];

  constructor(page: ContainerModel, dpi?: number) {
    // 9008 正常写在页容器里（格式 §7.6）；调用方若另外提供了文档级 DPI，只在页面自己缺失时补位。
    this.page = dpi === undefined || page.numericPreferences.dpi !== undefined
      ? page
      : { ...page, numericPreferences: { ...page.numericPreferences, dpi } };
    for (const o of page.objects) {
      this.byIndex.set(o.index, o);
      this.dirty.add(o.index);
      for (const parent of o.parents) {
        let children = this.children.get(parent);
        if (children === undefined) this.children.set(parent, children = new Set());
        children.add(o.index);
      }
    }
  }

  invalidate(objectIndex: number): void {
    const queue = [objectIndex];
    for (let i = 0; i < queue.length; i++) {
      const index = queue[i]!;
      if (this.dirty.has(index)) continue;
      this.dirty.add(index);
      queue.push(...this.children.get(index) ?? []);
    }
  }

  moveFreePoint(doc: GspDocument, objectIndex: number, x: number, y: number): PageGeometry {
    const o = this.byIndex.get(objectIndex);
    if (o === undefined || o.constraintId !== 0 || o.mainKind !== 1 || (this.page.type === 'tool' && o.genera !== 4)) {
      throw new RangeError(`object ${objectIndex} is not a draggable free point`);
    }
    setFreePointCoordinates(doc, this.page.node, objectIndex, x, y);
    o.freePoint = { x, y };
    this.invalidate(objectIndex);
    return this.evaluate();
  }

  evaluate(): PageGeometry {
    this.recomputedIndices = [];
    const pending = new Map<number, number>();
    const queue: number[] = [];
    for (const index of this.dirty) {
      const o = this.byIndex.get(index);
      if (o === undefined) continue;
      const count = new Set(o.parents.filter((p) => this.dirty.has(p) && this.byIndex.has(p))).size;
      pending.set(index, count);
      if (count === 0) queue.push(index);
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor]!;
      const o = this.byIndex.get(index)!;
      const parents: Geometry[] = [];
      let outcome: Outcome | undefined;
      // Geometry-only dynamic color evaluation depends solely on its source. Numeric parents remain in the graph/file.
      for (const parent of o.constraintId === 75 ? o.parents.slice(0, 1) : o.parents) {
        const result = this.cache.get(parent);
        if (!this.byIndex.has(parent) || result === undefined) { outcome = absent(`missing-parent:${parent}`); continue; }
        if (result.status !== 'ok') {
          if (result.status === 'not-existing' || outcome === undefined) outcome = { status: result.status, reason: `parent:${parent}:${result.status}` };
          continue;
        }
        parents.push(result);
      }
      outcome ??= construct(o, parents, this.page, this.byIndex);
      this.store(o, outcome);
      pending.delete(index);
      for (const child of this.children.get(index) ?? []) {
        const count = pending.get(child);
        if (count === undefined) continue;
        pending.set(child, count - 1);
        if (count === 1) queue.push(child);
      }
    }
    for (const index of pending.keys()) this.store(this.byIndex.get(index)!, absent('dependency-cycle'));
    this.dirty.clear();
    return { pageIndex: this.page.index + 1, objects: this.page.objects.map((o) => this.cache.get(o.index)!) };
  }

  private store(o: ObjectInfo, outcome: Outcome): void {
    const base = { objectIndex: o.index, constraintId: o.constraintId };
    let result: EvaluatedObject;
    if ('status' in outcome) {
      result = outcome.status === 'not-existing'
        ? { ...base, ...outcome, status: 'not-existing', exists: false }
        : { ...base, ...outcome, status: outcome.status, exists: null };
    } else if (!finiteGeometry(outcome)) {
      result = { ...base, status: 'not-existing', exists: false, reason: 'non-finite-geometry' };
    } else result = { ...base, ...outcome, status: 'ok', exists: true };
    this.cache.set(o.index, result);
    this.recomputedIndices.push(o.index);
  }
}

/**
 * 文档级 9008（如果有）：正常语料把 DPI 写在页容器里，这里只是给“写在文档节点上”的文件留的补位。
 * 页面自己的 9008 永远优先。
 */
function documentDpi(doc: GspDocument): number | undefined {
  let dpi: number | undefined;
  const inspect = (kind: number, payload: Uint8Array): void => {
    if (kind !== 9008 || payload.length < 4) return;
    const value = readU32(payload, 0);
    if (value > 0) dpi = value;
  };
  for (const item of doc.items) {
    if (isEnvelopeNode(item)) {
      for (const child of item.items) if (!isContainerNode(child)) inspect(child.kind, child.payload);
    } else {
      inspect(item.kind, item.payload);
    }
  }
  return dpi;
}

export function evaluatePageGeometry(page: ContainerModel, dpi?: number): PageGeometry {
  return new PageGeometryEvaluator(page, dpi).evaluate();
}
export function toGeometryJson(model: DocumentModel): GeometryDocument {
  const dpi = documentDpi(model.doc);
  return { schema: 'gsp-core-geometry-v1', pages: model.pages.map((p) => evaluatePageGeometry(p, dpi)) };
}






