/** Verified rectangular-coordinate subset: cards 52/54/58–61/69. */
import { readF64, readU16 } from './bytes.ts';
import type { CoordinateSystemGeometry, Geometry, LinearGeometry, PointGeometry, XY } from './geometry.ts';
import type { ObjectInfo } from './model.ts';

type Failure = { status: 'unsupported'; reason: string };
type Result = Geometry | Failure;
const unsupported = (reason: string): Failure => ({ status: 'unsupported', reason });
const pointXY = (g: PointGeometry): XY => [g.geometry.x, g.geometry.y];
const difference = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

export function coordinateOf(p: PointGeometry, k: CoordinateSystemGeometry): XY {
  const { origin, u, v } = k.geometry;
  const dx = p.geometry.x - origin[0], dy = p.geometry.y - origin[1];
  const determinant = u[0] * v[1] - u[1] * v[0];
  return [(dx * v[1] - dy * v[0]) / determinant, (u[0] * dy - u[1] * dx) / determinant];
}

function axis(origin: XY, size: number, direction: number): Result {
  if (!positive(size)) return unsupported('axis-unit-must-be-positive-finite');
  const unit: XY = direction === 1 ? [size, 0] : [0, -size];
  const b: XY = [origin[0] + unit[0], origin[1] + unit[1]];
  if (![...origin, ...b].every(Number.isFinite)) return unsupported('axis-non-finite-geometry');
  return { kind: 'line', geometry: { a: origin, b }, parameterizationKnown: true,
    axis: { direction: direction === 1 ? 'horizontal' : 'vertical', unit } };
}

export function constructCoordinate(o: ObjectInfo, p: readonly Geometry[], byIndex: ReadonlyMap<number, ObjectInfo>): Result | undefined {
  const id = o.constraintId;
  if (![52, 54, 58, 59, 60, 61, 69].includes(id)) return undefined;
  const expected = id === 52 || id === 54 ? [1, 40] : id === 61 ? [8, 39] : id === 69 ? [1, 56] : [9, 38];
  if (o.mainKind !== expected[0] || o.genera !== expected[1]) return unsupported(`coordinate-${id}-object-type-unverified`);
  const first = p[0], second = p[1];
  if (id === 52 || id === 54) {
    const payload = o.node.records.find((r) => r.kind === 2003)?.payload;
    if (payload === undefined || payload.length !== 12 || readU16(payload, 0) !== id || readU16(payload, 2) !== 0) {
      return unsupported(`unit-point-${id}-2003-layout-unverified`);
    }
    if (p.length !== 1 || first?.kind !== 'point') return unsupported(`unit-point-${id}-parent-must-be-point`);
    if (id === 52) {
      const size = readF64(payload, 4);
      if (!positive(size)) return unsupported('unit-point-52-length-must-be-positive-finite');
      const origin = pointXY(first), x = origin[0] + size;
      if (!Number.isFinite(x)) return unsupported('unit-point-52-non-finite-geometry');
      return { kind: 'point', geometry: { x, y: origin[1] }, unitPoint: { origin, length: size } };
    }
    // The saved 54 value is a cache. Only the evaluated native 52 supplies the current origin/length.
    if (byIndex.get(o.parents[0]!)?.constraintId !== 52 || first.unitPoint === undefined) return unsupported('unit-point-54-parent-must-be-52');
    const { origin, length: size } = first.unitPoint;
    if (!positive(size)) return unsupported('unit-point-54-length-must-be-positive-finite');
    const y = origin[1] - size;
    if (!Number.isFinite(y)) return unsupported('unit-point-54-non-finite-geometry');
    return { kind: 'point', geometry: { x: origin[0], y } };
  }
  if (id === 58 || id === 59 || id === 60) {
    const payload = o.node.records.find((r) => r.kind === 2309)?.payload;
    if (payload === undefined || (payload.length !== 2 && payload.length !== 4)) return unsupported('axis-2309-layout-unverified');
    const direction = readU16(payload, 0);
    if (direction !== 0 && direction !== 1) return unsupported('axis-direction-unverified');
    if (id === 60) {
      if (p.length !== 1 || first?.kind !== 'circle') return unsupported('axis-60-parent-must-be-circle');
      return axis(first.geometry.center, first.geometry.radius, direction);
    }
    if (p.length !== 2 || first?.kind !== 'point' || second === undefined) return unsupported(`axis-${id}-parent-types-unverified`);
    const origin = pointXY(first);
    if (id === 58) {
      if (second.kind !== 'point') return unsupported('axis-58-unit-parent-must-be-point');
      const unit = difference(pointXY(second), origin);
      if (direction === 1 ? unit[1] !== 0 || !positive(unit[0]) : unit[0] !== 0 || !positive(-unit[1])) {
        return unsupported('axis-58-slanted-reversed-or-zero-unit-unverified');
      }
      return axis(origin, direction === 1 ? unit[0] : -unit[1], direction);
    }
    if (second.kind === 'segment' && !second.degenerateArc) return axis(origin, Math.hypot(...difference(second.geometry.b, second.geometry.a)), direction);
    if (second.kind === 'measure' && second.measurement.internal.dimension === 'length') return axis(origin, second.measurement.internal.magnitude, direction);
    return unsupported('axis-59-length-provider-unverified');
  }
  if (id === 61) {
    const payload = o.node.records.find((r) => r.kind === 2308)?.payload;
    if (payload === undefined || (payload.length !== 2 && payload.length !== 8)) return unsupported('coordinate-system-2308-layout-unverified');
    const mode = readU16(payload, 0);
    if (mode !== 1 && mode !== 2) return unsupported('coordinate-system-mode-unverified');
    if (p.length !== 2 || first?.kind !== 'line' || second?.kind !== 'line' || first.axis?.direction !== 'horizontal' || second.axis?.direction !== 'vertical') {
      return unsupported('coordinate-system-ordered-axis-parents-required');
    }
    const x = first as LinearGeometry, y = second as LinearGeometry;
    if (x.geometry.a[0] !== y.geometry.a[0] || x.geometry.a[1] !== y.geometry.a[1]) return unsupported('coordinate-system-different-origins-unverified');
    const u = difference(x.geometry.b, x.geometry.a), v = difference(y.geometry.b, y.geometry.a);
    if (u[1] !== 0 || v[0] !== 0 || !positive(u[0]) || !positive(-v[1]) || !Number.isFinite(u[0] * v[1]) || u[0] * v[1] === 0) {
      return unsupported('coordinate-system-slanted-nonpositive-or-singular-basis-unverified');
    }
    return { kind: 'coordinate-system', geometry: { origin: x.geometry.a, u, v } };
  }
  const k = p[2];
  if (p.length !== 3 || first?.kind !== 'measure' || second?.kind !== 'measure' || k?.kind !== 'coordinate-system') return unsupported('plot-69-parent-types-unverified');
  if (first.measurement.internal.dimension !== 'number' || second.measurement.internal.dimension !== 'number') return unsupported('plot-69-coordinate-dimension-unverified');
  const x = first.measurement.internal.magnitude, y = second.measurement.internal.magnitude;
  const { origin, u, v } = k.geometry;
  const px = origin[0] + x * u[0] + y * v[0], py = origin[1] + x * u[1] + y * v[1];
  if (![px, py].every(Number.isFinite)) return unsupported('plot-69-non-finite-geometry');
  return { kind: 'point', geometry: { x: px, y: py } };
}
