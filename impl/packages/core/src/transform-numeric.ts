/**
 * 数值父驱动的变换（卡片 18/19/20/23/24/25/26/29/31/33）。
 *
 * 这里只把「源之外的父」换算成一个仿射矩阵，形状本身的变换仍由 `geometry.ts` 的
 * `transformGeometry` 统一完成。数值父一律取 `measurement.internal.magnitude`：
 * 它已经是基准单位（长度页面 px、角度弧度、无量纲原值），不能改用 `displayValue`
 *（那是页面显示单位，与 px 差着单位换算因子）。
 *
 * 卡片里的符号约定：页面 y 向下，但用户的「正方向」是向上，所以每个位移的
 * 垂直分量都要取负；旋转角、方向角以页面上看起来逆时针为正（同卡片 27/28）。
 */
import { readF64, readU32 } from './bytes.ts';
import type { Geometry, PointGeometry, XY } from './geometry.ts';
import type { Dimension } from './numeric/units.ts';

export interface NumericSimilarity {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
  tx: number;
  ty: number;
  /** 长度放大倍数（圆弧半径乘它）。 */
  scale: number;
  /** 行列式符号：1 保向、-1 反向（圆弧扫角乘它）。 */
  orientation: 1 | -1;
}

export type NumericTransformOutcome =
  | { ok: true; matrix: NumericSimilarity }
  | { ok: false; status: 'unsupported' | 'not-existing'; reason: string };

type Failure = Extract<NumericTransformOutcome, { ok: false }>;

const PARENT_COUNT: ReadonlyMap<number, number> = new Map([
  [18, 2], [19, 2], [20, 3], [23, 2], [24, 2], [25, 5], [26, 3], [29, 3], [31, 4], [33, 3],
]);
/** 这些约束带 kind 2003 载荷；20/25/26/29/31/33 没有。 */
const NATIVE_SIZE: ReadonlyMap<number, number> = new Map([[18, 28], [19, 28], [23, 28], [24, 36]]);

export function isNumericParameterTransform(id: number): boolean { return PARENT_COUNT.has(id); }

const unsupported = (reason: string): Failure => ({ ok: false, status: 'unsupported', reason });
const absent = (reason: string): Failure => ({ ok: false, status: 'not-existing', reason });
const ok = (matrix: NumericSimilarity): NumericTransformOutcome => ({ ok: true, matrix });

const translation = (dx: number, dy: number): NumericSimilarity =>
  ({ xx: 1, xy: 0, yx: 0, yy: 1, tx: dx, ty: dy, scale: 1, orientation: 1 });
/** 页面上看起来逆时针转 θ（卡片 27/29 的矩阵）。 */
const rotation = (center: XY, cos: number, sin: number): NumericSimilarity => ({
  xx: cos, xy: sin, yx: -sin, yy: cos,
  tx: center[0] - cos * center[0] - sin * center[1],
  ty: center[1] + sin * center[0] - cos * center[1],
  scale: 1, orientation: 1,
});
/** p' = C + k(p − C)；k 为负时等于转 180° 再缩放，行列式仍是 k² > 0。 */
const scaling = (center: XY, k: number): NumericSimilarity => ({
  xx: k, xy: 0, yx: 0, yy: k,
  tx: (1 - k) * center[0], ty: (1 - k) * center[1],
  scale: Math.abs(k), orientation: 1,
});

/** 数值父的基准单位值。父已由依赖图保证求值成功，这里只做类型与有限性判断。 */
function numberAt(parents: readonly Geometry[], slot: number, dimension: Dimension): number | Failure {
  const parent = parents[slot];
  if (parent === undefined || parent.kind !== 'measure') return unsupported(`numeric-parameter-parent:${slot}`);
  // 量纲必须符合卡片；无单位数当距离、角度量当距离等原版行为未核实（Q10.2）。
  if (parent.measurement.internal.dimension !== dimension) return unsupported('numeric-parameter-dimension-unverified');
  const value = parent.measurement.internal.magnitude;
  return Number.isFinite(value) ? value : absent('non-finite-numeric-parameter');
}

function pointAt(parents: readonly Geometry[], slot: number, reason: string): PointGeometry | Failure {
  const parent = parents[slot];
  return parent !== undefined && parent.kind === 'point' ? parent : unsupported(reason);
}

const pointXY = (p: PointGeometry): XY => [p.geometry.x, p.geometry.y];

export function numericParameterTransform(
  id: number,
  parents: readonly Geometry[],
  native: Uint8Array | undefined,
): NumericTransformOutcome {
  const count = PARENT_COUNT.get(id);
  if (count === undefined) return unsupported(`constraint-${id}-not-a-numeric-parameter-transform`);
  if (parents.length !== count) return unsupported('transform-parent-count');
  const size = NATIVE_SIZE.get(id);
  if (size !== undefined && (native === undefined || native.length !== size || readU32(native, 0) !== id)) {
    return unsupported('invalid-native-transform-parameter');
  }

  if (id === 18) {
    // 水平位移固定（+4，正向右），垂直位移取父 1（长度量，px，正向上）。
    const dx = readF64(native!, 4);
    const dy = numberAt(parents, 1, 'length');
    if (typeof dy !== 'number') return dy;
    if (!Number.isFinite(dx)) return absent('non-finite-transform-parameter');
    return ok(translation(dx, -dy));
  }
  if (id === 19) {
    // 垂直位移固定（+4，正向上），水平位移取父 1（px，正向右）。
    const dx = numberAt(parents, 1, 'length');
    if (typeof dx !== 'number') return dx;
    const dy = readF64(native!, 4);
    if (!Number.isFinite(dy)) return absent('non-finite-transform-parameter');
    return ok(translation(dx, -dy));
  }
  if (id === 20) {
    // 父 1 水平、父 2 垂直（手册：先选定的距离是水平）。
    const dx = numberAt(parents, 1, 'length');
    if (typeof dx !== 'number') return dx;
    const dy = numberAt(parents, 2, 'length');
    if (typeof dy !== 'number') return dy;
    return ok(translation(dx, -dy));
  }
  if (id === 23) {
    // 固定距离（+4 px）+ 父 1 的方向角（弧度）。
    const distance = readF64(native!, 4);
    const angle = numberAt(parents, 1, 'angle');
    if (typeof angle !== 'number') return angle;
    if (!Number.isFinite(distance)) return absent('non-finite-transform-parameter');
    return ok(translation(distance * Math.cos(angle), -distance * Math.sin(angle)));
  }
  if (id === 24) {
    // 固定角度（+4 = −sin θ、+12 = cos θ，同 21）+ 父 1 的距离。
    const a = readF64(native!, 4), b = readF64(native!, 12);
    const distance = numberAt(parents, 1, 'length');
    if (typeof distance !== 'number') return distance;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return absent('non-finite-transform-parameter');
    if (Math.abs(Math.hypot(a, b) - 1) > 1e-8) return unsupported('invalid-native-transform-direction');
    // 位移 = D·(cos θ, −sin θ) = (D·b, D·a)，与卡片 21 相同。
    return ok(translation(distance * b, distance * a));
  }
  if (id === 25) {
    // 父 1..3 是 ∠cde（顶点 d）+ 父 4 的距离（px）。
    const c = pointAt(parents, 1, 'angle-arms-must-be-points'),
      d = pointAt(parents, 2, 'angle-arms-must-be-points'),
      e = pointAt(parents, 3, 'angle-arms-must-be-points');
    if ('ok' in c) return c;
    if ('ok' in d) return d;
    if ('ok' in e) return e;
    const distance = numberAt(parents, 4, 'length');
    if (typeof distance !== 'number') return distance;
    const ux = c.geometry.x - d.geometry.x, uy = c.geometry.y - d.geometry.y;
    const vx = e.geometry.x - d.geometry.x, vy = e.geometry.y - d.geometry.y;
    const ul = Math.hypot(ux, uy), vl = Math.hypot(vx, vy);
    if (ul === 0 || vl === 0) return absent('zero-angle-arm');
    // 卡片 28 的角：从 d→c 转到 d→e，页面上逆时针为正。
    const cos = (ux * vx + uy * vy) / (ul * vl);
    const sin = (uy * vx - ux * vy) / (ul * vl);
    return ok(translation(distance * cos, -distance * sin));
  }
  if (id === 26) {
    // 父 1 方向角（弧度）、父 2 距离（px）。
    const angle = numberAt(parents, 1, 'angle');
    if (typeof angle !== 'number') return angle;
    const distance = numberAt(parents, 2, 'length');
    if (typeof distance !== 'number') return distance;
    return ok(translation(distance * Math.cos(angle), -distance * Math.sin(angle)));
  }
  if (id === 29) {
    // 父 1 中心、父 2 角度（弧度），旋转方向同 27。
    const center = pointAt(parents, 1, 'transform-center-must-be-point');
    if ('ok' in center) return center;
    const angle = numberAt(parents, 2, 'angle');
    if (typeof angle !== 'number') return angle;
    return ok(rotation(pointXY(center), Math.cos(angle), Math.sin(angle)));
  }
  if (id === 31) {
    // 父 1 中心、父 2/3 两条线段，k = |d|/|e|。
    const center = pointAt(parents, 1, 'transform-center-must-be-point');
    if ('ok' in center) return center;
    const numerator = parents[2], denominator = parents[3];
    if (numerator?.kind !== 'segment' || denominator?.kind !== 'segment') return unsupported('segment-ratio-needs-two-segments');
    const ratio = Math.hypot(numerator.geometry.b[0] - numerator.geometry.a[0], numerator.geometry.b[1] - numerator.geometry.a[1])
      / Math.hypot(denominator.geometry.b[0] - denominator.geometry.a[0], denominator.geometry.b[1] - denominator.geometry.a[1]);
    if (!Number.isFinite(ratio)) return absent('zero-ratio-denominator');
    if (ratio === 0) return unsupported('zero-scale-existence-unverified');
    return ok(scaling(pointXY(center), ratio));
  }
  if (id === 33) {
    // 父 1 中心、父 2 比值（无量纲，可为负）。
    const center = pointAt(parents, 1, 'transform-center-must-be-point');
    if ('ok' in center) return center;
    const ratio = numberAt(parents, 2, 'number');
    if (typeof ratio !== 'number') return ratio;
    if (ratio === 0) return unsupported('zero-scale-existence-unverified');
    return ok(scaling(pointXY(center), ratio));
  }
  return unsupported(`constraint-${id}-not-a-numeric-parameter-transform`);
}
