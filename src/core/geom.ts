/** 纯几何运算。坐标沿用页面坐标：x 向右，y 向下（与原版文件一致）。 */
export interface Pt { x: number; y: number }
export type Extent = 'segment' | 'ray' | 'line';
export interface Straight { a: Pt; b: Pt; ext: Extent }
export interface Circ { c: Pt; r: number }

export const EPS = 1e-9;
export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);
export const unit = (a: Pt): Pt | undefined => { const l = len(a); return l < EPS ? undefined : { x: a.x / l, y: a.y / l }; };

/** 参数 t 是否落在直线型对象允许的范围内。 */
export function paramOk(ext: Extent, t: number, tol = 1e-9): boolean {
  return ext === 'line' || (ext === 'ray' ? t >= -tol : t >= -tol && t <= 1 + tol);
}

export function clampParam(ext: Extent, t: number): number {
  return ext === 'line' ? t : ext === 'ray' ? Math.max(0, t) : Math.min(1, Math.max(0, t));
}

/** 点到直线型对象的投影参数（a 处为 0，b 处为 1）。 */
export function projectParam(s: Straight, p: Pt): number | undefined {
  const d = sub(s.b, s.a), l2 = dot(d, d);
  if (l2 < EPS) return undefined;
  return dot(sub(p, s.a), d) / l2;
}

export function pointAt(s: Straight, t: number): Pt { return add(s.a, mul(sub(s.b, s.a), t)); }

export function distToStraight(s: Straight, p: Pt): number {
  const t = projectParam(s, p);
  if (t === undefined) return dist(p, s.a);
  return dist(p, pointAt(s, clampParam(s.ext, t)));
}

export function intersectStraights(a: Straight, b: Straight): Pt | undefined {
  const d = sub(a.b, a.a), e = sub(b.b, b.a), den = cross(d, e);
  if (Math.abs(den) < EPS * Math.max(1, len(d) * len(e))) return undefined;
  const v = sub(b.a, a.a), t = cross(v, e) / den, u = cross(v, d) / den;
  if (!paramOk(a.ext, t) || !paramOk(b.ext, u)) return undefined;
  return pointAt(a, t);
}

/** 直线型对象与圆的交点，按参数 t 从小到大排序（线段方向为 a→b）。 */
/** 直线（整条）与圆的交点，按参数 t 从小到大排序，不按射线/线段范围过滤。 */
export function intersectLineCircleRaw(s: Straight, c: Circ): { t: number; p: Pt }[] {
  const d = sub(s.b, s.a), f = sub(s.a, c.c), A = dot(d, d);
  if (A < EPS) return [];
  const B = 2 * dot(f, d), C = dot(f, f) - c.r * c.r, disc = B * B - 4 * A * C;
  const tol = 1e-9 * Math.max(1, B * B);
  if (disc < -tol) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const ts = disc <= tol ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map(t => ({ t, p: pointAt(s, t) }));
}

export function intersectStraightCircle(s: Straight, c: Circ): Pt[] {
  return intersectLineCircleRaw(s, c).filter(x => paramOk(s.ext, x.t)).map(x => x.p);
}

/** 两圆交点：两点沿 c1→c2 方向左侧（屏幕上方向）为 0 号分支。 */
export function intersectCircles(c1: Circ, c2: Circ): Pt[] {
  const d = dist(c1.c, c2.c);
  if (d < EPS) return [];
  if (d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d), h2 = c1.r * c1.r - a * a;
  const h = Math.sqrt(Math.max(0, h2)), ux = (c2.c.x - c1.c.x) / d, uy = (c2.c.y - c1.c.y) / d;
  const base = { x: c1.c.x + a * ux, y: c1.c.y + a * uy };
  if (h < 1e-9) return [base];
  return [{ x: base.x + h * uy, y: base.y - h * ux }, { x: base.x - h * uy, y: base.y + h * ux }];
}

export function circleThrough3(a: Pt, b: Pt, c: Pt): Circ | undefined {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return undefined;
  const aa = a.x * a.x + a.y * a.y, bb = b.x * b.x + b.y * b.y, cc = c.x * c.x + c.y * c.y;
  const center = { x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d, y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d };
  return { c: center, r: dist(a, center) };
}

/** 屏幕坐标（y 向下）下，逆时针（视觉上）的数学角，范围 (-π, π]。 */
export const angleOf = (from: Pt, to: Pt) => Math.atan2(-(to.y - from.y), to.x - from.x);
export const TAU = Math.PI * 2;
export const normAngle = (a: number) => { a %= TAU; return a < 0 ? a + TAU : a; };

/** 逆时针从 a0 转到 a1 的弧度，范围 [0, 2π)。 */
export const sweep = (a0: number, a1: number) => normAngle(a1 - a0);

export function rotatePt(p: Pt, center: Pt, ang: number): Pt {
  // 视觉逆时针 ang（y 向下，所以角度符号取反）
  const c = Math.cos(ang), s = Math.sin(ang), d = sub(p, center);
  return { x: center.x + d.x * c + d.y * s, y: center.y - d.x * s + d.y * c };
}

export function dilatePt(p: Pt, center: Pt, k: number): Pt { return add(center, mul(sub(p, center), k)); }

export function reflectPt(p: Pt, m: Straight): Pt | undefined {
  const t = projectParam({ ...m, ext: 'line' }, p);
  if (t === undefined) return undefined;
  const f = pointAt(m, t);
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
}

/** 点在多边形内（偶奇规则）。 */
export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return Math.abs(s) / 2;
}

export function polygonPerimeter(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

/** 线段 a-b 是否与轴对齐矩形相交（含完全在内）。 */
export function segmentHitsRect(a: Pt, b: Pt, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const inside = (p: Pt) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
  if (inside(a) || inside(b)) return true;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]] as const) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** 圆周是否与矩形相交。 */
export function circleHitsRect(c: Circ, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const nx = Math.min(Math.max(c.c.x, r.x0), r.x1), ny = Math.min(Math.max(c.c.y, r.y0), r.y1);
  const near = Math.hypot(c.c.x - nx, c.c.y - ny);
  const far = Math.max(...[[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => Math.hypot(c.c.x - x, c.c.y - y)));
  return near <= c.r && far >= c.r;
}
