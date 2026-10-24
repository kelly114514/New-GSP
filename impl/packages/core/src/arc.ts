import type { XY } from './geometry.ts';

/**
 * ARC ORIENTATION CONVENTION - the single place to correct it.
 *
 * Cards 79/80 take the arc from the start direction to the end direction in the
 * mathematical counter-clockwise sense (as it looks on the page, whose y axis points down).
 * That is static evidence only; the original has not confirmed it by dragging.
 * If it turns out to be clockwise, change this constant to -1: every arc built from
 * constraints 79 and 80 flips to its complementary arc and nothing else needs touching.
 * (Constraint 81 takes its direction from the middle point M, so it is unaffected.)
 *
 * Angles everywhere in the kernel are "math angles": `atan2(-dy, dx)` of the page-space
 * offset, a point is `center + r * (cos a, -sin a)`, and a positive sweep runs
 * counter-clockwise on screen. The renderer converts to canvas angles itself.
 */
export const ARC_ORIENTATION: 1 | -1 = 1;

/** Math angle of a page-space offset (page y points down). */
export function mathAngle(dx: number, dy: number): number { return Math.atan2(-dy, dx); }

export function pointAtAngle(center: XY, radius: number, angle: number): XY {
  return [center[0] + radius * Math.cos(angle), center[1] - radius * Math.sin(angle)];
}

const TAU = 2 * Math.PI;
const wrap = (a: number): number => { const r = a % TAU; return r < 0 ? r + TAU : r; };

/**
 * Signed sweep from `start` to `end` for constraints 79/80, in (-2pi, 2pi).
 * The caller rejects results that are numerically 0 or a full turn.
 */
export function directedSweep(start: number, end: number): number {
  return ARC_ORIENTATION * wrap(ARC_ORIENTATION * (end - start));
}

/** Angular tolerance (radians) for "same direction" and for arc range membership. */
export const ARC_ANGLE_TOLERANCE = 1e-9;
/** Relative tolerance for "this point lies on the circle" / "two radii are equal". */
export const ARC_RADIUS_TOLERANCE = 1e-6;
/** Card 81: a three-point arc whose radius or centre coordinate exceeds this many page units becomes a segment. */
export const ARC_SEGMENT_LIMIT = 30000;

/** True when the page point lies inside the directed arc range (end points included). */
export function inArcRange(arc: { center: XY; startAngle: number; sweepAngle: number }, p: XY): boolean {
  const phi = mathAngle(p[0] - arc.center[0], p[1] - arc.center[1]);
  const rel = wrap(arc.sweepAngle >= 0 ? phi - arc.startAngle : arc.startAngle - phi);
  return rel <= Math.abs(arc.sweepAngle) + ARC_ANGLE_TOLERANCE || rel >= TAU - ARC_ANGLE_TOLERANCE;
}

/** Circumcircle of three points, or undefined when they are (numerically) collinear. */
export function circumcircle(a: XY, m: XY, b: XY): { center: XY; radius: number } | undefined {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  const scale = Math.hypot(a[0] - m[0], a[1] - m[1]) * Math.hypot(b[0] - m[0], b[1] - m[1]);
  if (d === 0 || Math.abs(d) <= 32 * Number.EPSILON * 2 * scale) return undefined;
  const a2 = a[0] * a[0] + a[1] * a[1], m2 = m[0] * m[0] + m[1] * m[1], b2 = b[0] * b[0] + b[1] * b[1];
  const ux = (a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d;
  const uy = (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d;
  return { center: [ux, uy], radius: Math.hypot(a[0] - ux, a[1] - uy) };
}

/** Signed sweep of the arc A -> M -> B on a circle with the given centre (M lies on the arc). */
export function sweepThrough(center: XY, a: XY, m: XY, b: XY): { start: number; sweep: number } {
  const ta = mathAngle(a[0] - center[0], a[1] - center[1]);
  const tm = mathAngle(m[0] - center[0], m[1] - center[1]);
  const tb = mathAngle(b[0] - center[0], b[1] - center[1]);
  const positive = wrap(tb - ta);
  return wrap(tm - ta) <= positive ? { start: ta, sweep: positive } : { start: ta, sweep: -wrap(ta - tb) };
}
