/**
 * 度量与计算对象的求值（卡片 36–48，以及约束 0 / 主类 11 的数值自由对象）。
 *
 * 值在页面显示单位里：长度用 10041 单位、角度用 10042 单位、面积用长度单位²、47 无量纲。
 * `internal.magnitude` 用 `distanceUnitScale` / `angleUnitScale` 换回基准单位（px、弧度、px²）。
 * 显示舍入按 double 精确值 half away from zero；一律输出 `displayNumber`（半值边界也给出，
 * 语料证据见 0.6349999999999993 → `0.63`、5.715000000000001 → `5.72`）。
 * 舍入结果为 0 时不输出负号（`-0.004` 在 digits=2 得 `0.00`，但在 digits=5 仍是 `-0.00400`）。
 */

import { readU16, readU32 } from './bytes.ts';
import type { Geometry, PointGeometry } from './geometry.ts';
import type { XY } from './geometry.ts';
import { fontNameOf } from './model.ts';
import type { ContainerModel, ObjectInfo } from './model.ts';
import { evaluateExpression } from './numeric/expression.ts';
import { angleUnitScale, baseUnitScale, unitTextFor } from './numeric/units.ts';
import type { Dimension, PageNumericPreferences } from './numeric/units.ts';

/** 数值对象的输出协议 + 新增的未舍入调试字段。 */
export interface NumericReading {
  displayValue: number;
  /** 一律给出：半值边界也按 double 精确值 half-away-from-zero 输出。 */
  displayNumber: string;
  displayUnitText: string;
  /** 对象自己 2307/2311 共同前缀 +28；缺失或越界时为 2（见 spec/questions.md Q9）。 */
  digits: number;
  internal: {
    /** 本批严格量纲。 */
    dimension: Dimension;
    /** 未舍入、基准单位：长度 px、角度弧度、面积 px²、无量纲原值。 */
    magnitude: number;
    /** 同一值的显示单位未舍入读数（`magnitude` 除以单位换算系数）；子计算与边界判断都用它。 */
    displayRaw: number;
    /** 约束 48 的对象头 genera 对应的量纲；仅诊断用。 */
    generaDimension?: Dimension;
    /** genera 与表达式算出的量纲不一致；不得据此改值。 */
    dimensionMismatch?: boolean;
    /** 仅在不一致时给出表达式自己的量纲。 */
    expressionDimension?: Dimension;
  };
}

export interface MeasureGeometry {
  kind: 'measure';
  measurement: NumericReading;
}

export type MeasureOutcome =
  | { ok: true; measurement: NumericReading }
  | { ok: false; status: 'unsupported' | 'not-existing'; reason: string };

const MEASURE_PREFIX_BYTES = 32;
const EXPRESSION_PREFIX_BYTES = 32;
const EXPRESSION_HEADER_BYTES = 92;
const MEASURE_CONSTRAINTS = new Set([36, 37, 39, 40, 41, 43, 44, 46, 47, 48]);

const unsupported = (reason: string): MeasureOutcome => ({ ok: false, status: 'unsupported', reason });
const undefinedValue = (what: string): MeasureOutcome => unsupported(`value-undefined:${what}`);
const infiniteValue = (what: string): MeasureOutcome => unsupported(`value-infinite:${what}`);

const DEFAULT_DIGITS = 2;

/** 是不是本模块负责的对象。 */
export function isMeasureObject(o: ObjectInfo): boolean {
  if (o.constraintId === 0) return o.mainKind === 11;
  return MEASURE_CONSTRAINTS.has(o.constraintId);
}

function readingDigits(payload: Uint8Array): number {
  const digits = readU16(payload, 28);
  return digits >= 0 && digits <= 5 ? digits : DEFAULT_DIGITS;
}

function measureRecord(o: ObjectInfo): Uint8Array | undefined {
  return o.node.records.find((r) => r.kind === 2307)?.payload;
}

function expressionRecord(o: ObjectInfo): Uint8Array | undefined {
  return o.node.records.find((r) => r.kind === 2311)?.payload;
}

interface DecodedExpression {
  tokens: number[];
  digits: number;
}

function decodeExpression(payload: Uint8Array): DecodedExpression | MeasureOutcome {
  if (payload.length < EXPRESSION_HEADER_BYTES) return unsupported('2311-layout:too-short');
  if (readU32(payload, 32) !== 2311) return unsupported('2311-layout:marker');
  if (readU32(payload, 36) !== payload.length - EXPRESSION_PREFIX_BYTES) return unsupported('2311-layout:length');
  if (readU32(payload, 40) !== 48) return unsupported('2311-layout:constraint');
  const count = readU16(payload, 44);
  if (payload.length !== EXPRESSION_HEADER_BYTES + 2 * count) return unsupported('2311-layout:token-count');
  const tokens: number[] = [];
  for (let i = 0; i < count; i++) tokens.push(readU16(payload, EXPRESSION_HEADER_BYTES + 2 * i));
  return { tokens, digits: readingDigits(payload) };
}

function isOutcome(value: DecodedExpression | MeasureOutcome): value is MeasureOutcome {
  return 'ok' in value;
}

const GENERA_DIMENSIONS = new Map<number, Dimension>([
  [51, 'number'],
  [48, 'length'],
  [49, 'angle'],
  [50, 'area'],
]);

function roundedText(value: number, digits: number): { value: number; text: string } {
  const magnitude = Math.abs(value);
  // toFixed 按 double 的精确值舍入（半值远离零）；落在半值边界的值（如 0.6349999999999993 → "0.63"、
  // 5.715000000000001 → "5.72"）同样照常给出读数字符串，不再省略。
  // |value| ≥ 1e21 时 toFixed 本身就返回指数形式，
  // 这里显式用 toExponential，避免手工拼十进制串（长度会溢出成 "1e+35"）。
  // 先对绝对值舍入，再决定符号：原版在舍入结果为 0 时不输出负号（-0.004 在 digits=2 显示 "0.00"）。
  const magnitudeText = magnitude < 1e21 ? magnitude.toFixed(digits) : magnitude.toExponential(digits);
  // Number("0.00") === 0；舍入结果为 0 时统一给正零，不保留 "-0.000…" / "-0" 的符号。
  const roundedMagnitude = Number(magnitudeText);
  const rounded = roundedMagnitude === 0 ? 0 : value < 0 ? -roundedMagnitude : roundedMagnitude;
  const text = rounded === 0 || value >= 0 ? magnitudeText : `-${magnitudeText}`;
  return { value: rounded, text };
}

/**
 * 数值 → 显示文字。调用方负责先把“偏好缺失”判成 unsupported；
 * 这里偏好缺失时单位文字返回空串（便于单独测试舍入）。
 */
export function formatReading(
  value: number,
  dimension: Dimension,
  digits: number,
  page: PageNumericPreferences,
  fontIsSymbol: boolean,
): { displayValue: number; displayNumber: string; displayUnitText: string } {
  const rounded = roundedText(value, digits);
  const unit = unitTextFor(dimension, page, fontIsSymbol);
  return {
    displayValue: rounded.value,
    displayNumber: rounded.text,
    displayUnitText: unit.ok ? unit.text : '',
  };
}

function makeReading(
  value: number,
  dimension: Dimension,
  digits: number,
  page: ContainerModel,
  o: ObjectInfo,
  diagnostics: { generaDimension?: Dimension } = {},
): MeasureOutcome {
  if (Number.isNaN(value)) return undefinedValue('not-a-number');
  if (!Number.isFinite(value)) return infiniteValue('non-finite-measure');
  const symbol = fontNameOf(page, o)?.toLowerCase().startsWith('symbol') === true;
  const prefs = page.numericPreferences;
  const unit = unitTextFor(dimension, prefs, symbol);
  if (!unit.ok) return unsupported(unit.reason);
  const scale = baseUnitScale(dimension, prefs);
  if (!scale.ok) return unsupported(scale.reason);
  const magnitude = value * scale.scale;
  if (!Number.isFinite(magnitude)) return infiniteValue('non-finite-magnitude');
  // 显示读数一律由基准值反算，保证 displayRaw 与 magnitude 是同一个数的两种单位。
  const displayRaw = magnitude / scale.scale;
  const rounded = roundedText(displayRaw, digits);
  if (!Number.isFinite(rounded.value)) return infiniteValue('rounded-overflow');
  const measurement: NumericReading = {
    displayValue: rounded.value,
    displayNumber: rounded.text,
    displayUnitText: unit.text,
    digits,
    internal: { dimension, magnitude, displayRaw, ...diagnostics },
  };
  return { ok: true, measurement };
}

/** 页面 px → 页面长度显示单位；DPI 相关规则集中在 `baseUnitScale`。 */
function pageLengthInDisplayUnits(px: number, page: ContainerModel): number | MeasureOutcome {
  const scale = baseUnitScale('length', page.numericPreferences);
  if (!scale.ok) return unsupported(scale.reason);
  return px / scale.scale;
}

function isReading(value: number | MeasureOutcome): value is MeasureOutcome {
  return typeof value !== 'number';
}

function pointOf(g: Geometry): PointGeometry | undefined {
  return g.kind === 'point' ? g : undefined;
}

function distance(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function measureDigits(o: ObjectInfo): number | MeasureOutcome {
  const payload = measureRecord(o);
  if (payload === undefined) return unsupported('missing-2307');
  if (payload.length !== MEASURE_PREFIX_BYTES) return unsupported(`2307-layout:${payload.length}`);
  return readingDigits(payload);
}

function parentOf(parents: readonly Geometry[], index: number): Geometry | MeasureOutcome {
  const g = parents[index];
  if (g === undefined) return unsupported(`parent:${index}:missing-result`);
  return g;
}

function lengthReading(px: number, o: ObjectInfo, page: ContainerModel, digits: number): MeasureOutcome {
  const value = pageLengthInDisplayUnits(px, page);
  if (isReading(value)) return value;
  return makeReading(value, 'length', digits, page, o);
}

function angleReading(radians: number, o: ObjectInfo, page: ContainerModel, digits: number): MeasureOutcome {
  const prefs = page.numericPreferences;
  if (prefs.angleUnit === undefined) return undefinedValue('missing-10042');
  return makeReading(radians / angleUnitScale(prefs.angleUnit), 'angle', digits, page, o);
}

/** 约束 48：父槽的值取未舍入的显示单位值。 */
function numericParents(o: ObjectInfo, parents: readonly Geometry[]): { value: number; dimension: Dimension }[] | MeasureOutcome {
  const values: { value: number; dimension: Dimension }[] = [];
  for (let i = 0; i < o.parents.length; i++) {
    const g = parentOf(parents, i);
    if ('ok' in g) return g;
    if (g.kind !== 'measure') return unsupported(`parent:${o.parents[i]}:numeric-value-required`);
    values.push({ value: g.measurement.internal.displayRaw, dimension: g.measurement.internal.dimension });
  }
  return values;
}

function evaluateCalc(o: ObjectInfo, parents: readonly Geometry[], page: ContainerModel): MeasureOutcome {
  const payload = expressionRecord(o);
  if (payload === undefined) return unsupported('missing-2311');
  const decoded = decodeExpression(payload);
  if (isOutcome(decoded)) return decoded;
  const values = numericParents(o, parents);
  if (!Array.isArray(values)) return values;
  const result = evaluateExpression(decoded.tokens, { parents: values, page: page.numericPreferences });
  if (!result.ok) return unsupported(result.reason);
  // 卡片 48：量纲由对象头 genera 定；表达式只决定值。不一致只记录诊断。
  const generaDimension = GENERA_DIMENSIONS.get(o.genera);
  const dimensionMismatch = generaDimension !== undefined && generaDimension !== result.dimension;
  return makeReading(result.value, generaDimension ?? result.dimension, decoded.digits, page, o, {
    ...(generaDimension === undefined ? {} : { generaDimension }),
    ...(dimensionMismatch ? { dimensionMismatch: true, expressionDimension: result.dimension } : {}),
  });
}

function evaluateNumericFreeObject(o: ObjectInfo, page: ContainerModel): MeasureOutcome {
  if (o.genera === 57) return unsupported('function-object-unverified');
  const payload = expressionRecord(o);
  if (payload === undefined) return unsupported('missing-2311');
  const decoded = decodeExpression(payload);
  if (isOutcome(decoded)) return decoded;
  const result = evaluateExpression(decoded.tokens, { parents: [], page: page.numericPreferences });
  if (!result.ok) return unsupported(result.reason);
  return makeReading(result.value, result.dimension, decoded.digits, page, o);
}

function measureLength(o: ObjectInfo, parents: readonly Geometry[], page: ContainerModel): MeasureOutcome {
  const digits = measureDigits(o);
  if (typeof digits !== 'number') return digits;
  const first = parentOf(parents, 0);
  if ('ok' in first) return first;
  const id = o.constraintId;

  if (id === 36) {
    // 36 只接受真正的线段；退化 81 弧虽然也写作 segment，但不是本卡片父类型。
    if (first.kind !== 'segment' || first.degenerateArc === true) return unsupported('36-parent-must-be-segment');
    return lengthReading(distance(first.geometry.a, first.geometry.b), o, page, digits);
  }
  if (id === 40) {
    if (first.kind !== 'circle' && first.kind !== 'disk') return unsupported('40-parent-must-be-circle');
    return lengthReading(2 * Math.PI * first.geometry.radius, o, page, digits);
  }
  if (id === 39) {
    if (first.kind === 'polygon') {
      const vertices = first.geometry.vertices;
      if (vertices.length < 2) return undefinedValue('39-degenerate-polygon');
      let total = 0;
      for (let i = 0; i < vertices.length; i++) total += distance(vertices[i]!, vertices[(i + 1) % vertices.length]!);
      return lengthReading(total, o, page, digits);
    }
    if (first.kind === 'sector' || first.kind === 'circular-segment') {
      const { radius, sweepAngle, start, end } = first.geometry;
      if (sweepAngle === undefined || start === undefined || end === undefined) return unsupported('39-region-without-arc-parameters');
      const arc = radius * Math.abs(sweepAngle);
      const total = first.kind === 'sector' ? arc + 2 * radius : arc + distance(start, end);
      return lengthReading(total, o, page, digits);
    }
    return unsupported(`39-parent-type:${first.kind}`);
  }
  if (id === 43) {
    if (first.kind !== 'arc') return unsupported('43-parent-must-be-arc');
    return angleReading(Math.abs(first.geometry.sweepAngle), o, page, digits);
  }
  if (id === 44) {
    if (o.parents.length !== 1) return unsupported('44-three-parent-unverified');
    if (first.kind !== 'arc') return unsupported('44-parent-must-be-arc');
    return lengthReading(first.geometry.radius * Math.abs(first.geometry.sweepAngle), o, page, digits);
  }
  if (id === 46) {
    if (first.kind === 'circle' || first.kind === 'disk' || first.kind === 'arc' || first.kind === 'sector' || first.kind === 'circular-segment') {
      return lengthReading(first.geometry.radius, o, page, digits);
    }
    return unsupported(`46-parent-type:${first.kind}`);
  }
  return unsupported(`constraint-${id}-not-supported`);
}

function measureAngle(o: ObjectInfo, parents: readonly Geometry[], page: ContainerModel): MeasureOutcome {
  const digits = measureDigits(o);
  if (typeof digits !== 'number') return digits;
  if (o.parents.length !== 3) return unsupported('41-parent-count');
  const a = parentOf(parents, 0), b = parentOf(parents, 1), c = parentOf(parents, 2);
  if ('ok' in a) return a;
  if ('ok' in b) return b;
  if ('ok' in c) return c;
  const pa = pointOf(a), pb = pointOf(b), pc = pointOf(c);
  if (pa === undefined || pb === undefined || pc === undefined) return unsupported('41-parents-must-be-points');
  const B = [pb.geometry.x, pb.geometry.y] as XY;
  const u: XY = [pa.geometry.x - B[0], pa.geometry.y - B[1]];
  const v: XY = [pc.geometry.x - B[0], pc.geometry.y - B[1]];
  const ul = Math.hypot(...u), vl = Math.hypot(...v);
  if (ul === 0 || vl === 0) return undefinedValue('zero-angle-arm');
  const theta = Math.atan2(u[1] * v[0] - u[0] * v[1], u[0] * v[0] + u[1] * v[1]);
  const prefs = page.numericPreferences;
  if (prefs.angleUnit === undefined) return undefinedValue('missing-10042');
  const signed = prefs.angleUnit === 1 ? Math.abs(theta) : theta;
  return makeReading(signed / angleUnitScale(prefs.angleUnit), 'angle', digits, page, o);
}

function measureRatio(o: ObjectInfo, parents: readonly Geometry[], page: ContainerModel): MeasureOutcome {
  const digits = measureDigits(o);
  if (typeof digits !== 'number') return digits;
  if (o.parents.length === 2) {
    const s = parentOf(parents, 0), t = parentOf(parents, 1);
    if ('ok' in s) return s;
    if ('ok' in t) return t;
    if (s.kind !== 'segment' || t.kind !== 'segment') return unsupported('47-segment-parents-required');
    const denominator = distance(t.geometry.a, t.geometry.b);
    if (denominator === 0) return undefinedValue('zero-ratio-denominator');
    return makeReading(distance(s.geometry.a, s.geometry.b) / denominator, 'number', digits, page, o);
  }
  if (o.parents.length === 3) {
    const ga = parentOf(parents, 0), gb = parentOf(parents, 1), gc = parentOf(parents, 2);
    if ('ok' in ga) return ga;
    if ('ok' in gb) return gb;
    if ('ok' in gc) return gc;
    const a = pointOf(ga), b = pointOf(gb), c = pointOf(gc);
    if (a === undefined || b === undefined || c === undefined) return unsupported('47-parents-must-be-points');
    const A: XY = [a.geometry.x, a.geometry.y];
    const v: XY = [b.geometry.x - A[0], b.geometry.y - A[1]];
    const w: XY = [c.geometry.x - A[0], c.geometry.y - A[1]];
    const vl = Math.hypot(...v), wl = Math.hypot(...w);
    if (vl === 0) return undefinedValue('zero-ratio-denominator');
    const cross = v[0] * w[1] - v[1] * w[0];
    // 存档坐标与父图计算都可能留下 1e-13 量级的残差；真实非共线样本的相对叉积在 1e-3 以上。
    if (Math.abs(cross) > 1e-9 * vl * wl) return unsupported('47-noncollinear');
    const dot = v[0] * w[0] + v[1] * w[1];
    return makeReading((dot < 0 ? -1 : 1) * (wl / vl), 'number', digits, page, o);
  }
  return unsupported('47-parent-count');
}

/**
 * 所有度量对象的统一入口。`parents` 与 `o.parents` 在成功求值时一一对应
 *（上游失败的情形由 geometry 的依赖传播先截断）。
 */
export function evaluateMeasure(o: ObjectInfo, parents: readonly Geometry[], page: ContainerModel): MeasureOutcome {
  if (o.constraintId === 0) {
    if (o.mainKind !== 11) return unsupported('free-object-main-kind');
    return evaluateNumericFreeObject(o, page);
  }
  if (o.constraintId === 48) return evaluateCalc(o, parents, page);
  if (o.constraintId === 41) return measureAngle(o, parents, page);
  if (o.constraintId === 47) return measureRatio(o, parents, page);
  if (o.constraintId === 36 || o.constraintId === 37 || o.constraintId === 39 || o.constraintId === 40
    || o.constraintId === 43 || o.constraintId === 44 || o.constraintId === 46) {
    if (o.constraintId === 37) {
      const digits = measureDigits(o);
      if (typeof digits !== 'number') return digits;
      const a = parentOf(parents, 0), b = parentOf(parents, 1);
      if ('ok' in a) return a;
      if ('ok' in b) return b;
      const pa = pointOf(a), pb = pointOf(b);
      if (pa === undefined || pb === undefined) return unsupported('37-parents-must-be-points');
      return lengthReading(distance([pa.geometry.x, pa.geometry.y], [pb.geometry.x, pb.geometry.y]), o, page, digits);
    }
    return measureLength(o, parents, page);
  }
  return unsupported(`constraint-${o.constraintId}-not-measure`);
}
