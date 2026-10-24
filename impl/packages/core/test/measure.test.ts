import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  evaluateExpression,
  evaluatePageGeometry,
  formatReading,
  parseGsp,
  readDocumentModel,
} from '../src/index';
import type { ContainerModel, NumericReading, ObjectInfo, PageNumericPreferences } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';

const SIN = 0x2000;
const COS = 0x2001;
const TAN = 0x2002;
const ASIN = 0x2003;
const ACOS = 0x2004;
const ATAN = 0x2005;
const ABS = 0x2006;
const SQRT = 0x2007;
const LN = 0x2008;
const LOG = 0x2009;
const SGN = 0x200a;
const ROUND = 0x200b;
const TRUNC = 0x200c;
const ADD = 0x1000;
const SUB = 0x1001;
const MUL = 0x1002;
const DIV = 0x1003;
const POW = 0x1004;
const LPAREN = 11;
const RPAREN = 12;
const PI = 13;
const E = 14;
const POINT = 10;
const RAD = 0x0100;
const DEG = 0x0101;
const CM = 0x0201;
const PARENT0 = 0x6000;

const BASE_PAGE = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp')))).pages[0]!;

function textStyle(fontIndex: number) {
  return { words: [fontIndex, 12, 1, 1, 1, 1, 1, 1, 1, 1], fontIndex, size: 12 };
}

function page(objects: ObjectInfo[], prefs: Partial<PageNumericPreferences> = {}): ContainerModel {
  return {
    ...BASE_PAGE,
    objects,
    fonts: [],
    fontNames: ['Arial', 'Symbol'],
    textStyles: [textStyle(0), textStyle(1)],
    numericPreferences: { distanceUnit: 1, angleUnit: 1, dpi: 96, ...prefs },
  };
}

interface ObjectOptions {
  mainKind?: number;
  genera?: number;
  parents?: number[];
  styleRef?: number;
  records?: { kind: number; payload: Uint8Array; pad: number }[];
}

function object(index: number, constraintId: number, options: ObjectOptions = {}): ObjectInfo {
  const base = BASE_PAGE.objects[0]!;
  return {
    ...base,
    index,
    constraintId,
    mainKind: options.mainKind ?? (constraintId === 0 ? 1 : 7),
    genera: options.genera ?? 48,
    parents: options.parents ?? [],
    styleRef: options.styleRef ?? 0,
    freePoint: undefined,
    node: { ...base.node, records: options.records ?? [] },
  };
}

function pointObject(index: number, x: number, y: number): ObjectInfo {
  const payload = new Uint8Array(16);
  const view = new DataView(payload.buffer);
  view.setFloat64(0, x, true);
  view.setFloat64(8, y, true);
  return object(index, 0, { mainKind: 1, genera: 4, records: [{ kind: 2201, payload, pad: 0 }] });
}

function digitsPayload(digits: number): Uint8Array {
  const payload = new Uint8Array(32);
  new DataView(payload.buffer).setUint16(28, digits, true);
  return payload;
}

function expressionPayload(tokens: readonly number[], digits = 2): Uint8Array {
  const payload = new Uint8Array(92 + 2 * tokens.length);
  const view = new DataView(payload.buffer);
  view.setUint16(28, digits, true);
  view.setUint32(32, 2311, true);
  view.setUint32(36, payload.length - 32, true);
  view.setUint32(40, 48, true);
  view.setUint16(44, tokens.length, true);
  view.setUint16(46, 4, true);
  tokens.forEach((token, i) => view.setUint16(92 + 2 * i, token, true));
  return payload;
}

function measureObject(
  index: number,
  constraintId: number,
  parents: number[],
  digits = 2,
  options: Omit<ObjectOptions, 'parents'> = {},
): ObjectInfo {
  return object(index, constraintId, {
    ...options,
    parents,
    records: [{ kind: 2307, payload: digitsPayload(digits), pad: 0 }],
  });
}

function calcObject(
  index: number,
  tokens: readonly number[],
  parents: number[],
  options: ObjectOptions & { digits?: number } = {},
): ObjectInfo {
  return object(index, 48, {
    ...options,
    parents,
    records: [{ kind: 2311, payload: expressionPayload(tokens, options.digits ?? 2), pad: 0 }],
  });
}

function freeNumber(
  index: number,
  tokens: readonly number[],
  genera: number,
  options: ObjectOptions & { digits?: number } = {},
): ObjectInfo {
  return object(index, 0, {
    ...options,
    mainKind: 11,
    genera,
    records: [{ kind: 2311, payload: expressionPayload(tokens, options.digits ?? 2), pad: 0 }],
  });
}

function evaluated(objects: ObjectInfo[], prefs: Partial<PageNumericPreferences> = {}) {
  return evaluatePageGeometry(page(objects, prefs)).objects;
}

function measureAt(objects: ObjectInfo[], index: number, prefs: Partial<PageNumericPreferences> = {}): NumericReading {
  const result = evaluated(objects, prefs).find((o) => o.objectIndex === index);
  if (result === undefined || result.status !== 'ok' || result.kind !== 'measure') {
    throw new Error(`object ${index} is not a measure: ${JSON.stringify(result)}`);
  }
  return result.measurement;
}

function failureAt(objects: ObjectInfo[], index: number, prefs: Partial<PageNumericPreferences> = {}): { status: string; reason: string } {
  const result = evaluated(objects, prefs).find((o) => o.objectIndex === index);
  if (result === undefined || result.status === 'ok') throw new Error(`object ${index} did not fail: ${JSON.stringify(result)}`);
  return { status: result.status, reason: result.reason };
}

const CM_PAGE = { distanceUnit: 1, angleUnit: 1, dpi: 96 } as const;

function evalTokens(tokens: readonly number[], prefs: PageNumericPreferences = CM_PAGE, parents: { value: number; dimension: 'number' | 'length' | 'angle' | 'area' }[] = []) {
  return evaluateExpression(tokens, { parents, page: prefs });
}

function valueOf(result: ReturnType<typeof evaluateExpression>): number {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function fn(token: number, ...argument: number[]): number[] {
  return [token, ...argument, RPAREN];
}

describe('2311 expression evaluation: functions', () => {
  it('evaluates the thirteen functions with degree pages', () => {
    expect(valueOf(evalTokens(fn(SIN, 3, 0)))).toBeCloseTo(0.5, 12);
    expect(valueOf(evalTokens(fn(COS, 6, 0)))).toBeCloseTo(0.5, 12);
    expect(valueOf(evalTokens(fn(TAN, 4, 5)))).toBeCloseTo(1, 12);
    expect(valueOf(evalTokens(fn(ASIN, 0, POINT, 5)))).toBeCloseTo(30, 12);
    expect(valueOf(evalTokens(fn(ACOS, 0x1001, 1)))).toBeCloseTo(180, 12);
    expect(valueOf(evalTokens(fn(ATAN, 1)))).toBeCloseTo(45, 12);
    expect(valueOf(evalTokens(fn(ABS, 0x1001, 3)))).toBe(3);
    expect(valueOf(evalTokens(fn(SQRT, 1, 6)))).toBe(4);
    expect(valueOf(evalTokens(fn(LN, E)))).toBeCloseTo(1, 12);
    expect(valueOf(evalTokens(fn(LOG, 1, 0, 0)))).toBeCloseTo(2, 12);
    expect(valueOf(evalTokens(fn(SGN, 0x1001, 5)))).toBe(-1);
    expect(valueOf(evalTokens(fn(SGN, 0)))).toBe(0);
  });

  it('round truncates as floor(x+0.5) and trunc toward zero', () => {
    expect(valueOf(evalTokens(fn(ROUND, 0x1001, 1, POINT, 5)))).toBe(-1);
    expect(valueOf(evalTokens(fn(ROUND, 2, POINT, 5)))).toBe(3);
    expect(valueOf(evalTokens(fn(TRUNC, 0x1001, 1, POINT, 3)))).toBe(-1);
    expect(valueOf(evalTokens(fn(TRUNC, 1, POINT, 9)))).toBe(1);
    expect(valueOf(evalTokens(fn(TRUNC, 0x1001, 1, POINT, 9)))).toBe(-1);
  });

  it('uses the page angle unit for trigonometry', () => {
    const radians: PageNumericPreferences = { distanceUnit: 1, angleUnit: 0, dpi: 96 };
    expect(valueOf(evalTokens(fn(SIN, PI, DIV, 2), radians))).toBeCloseTo(1, 12);
    expect(valueOf(evalTokens(fn(ASIN, 1), radians))).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('2311 expression evaluation: literals, units, syntax', () => {
  it('converts explicit radian / degree / centimetre suffixes into page units', () => {
    expect(valueOf(evalTokens([9, 0, DEG]))).toBe(90);
    const radians: PageNumericPreferences = { distanceUnit: 1, angleUnit: 0, dpi: 96 };
    expect(valueOf(evalTokens([9, 0, DEG], radians))).toBeCloseTo(Math.PI / 2, 12);
    expect(valueOf(evalTokens([1, RAD]))).toBeCloseTo(180 / Math.PI, 12);
    expect(valueOf(evalTokens([2, 4, CM]))).toBe(24);
    expect(valueOf(evalTokens([2, 4, CM], { distanceUnit: 2, angleUnit: 1, dpi: 96 }))).toBeCloseTo(24 / 2.54, 12);
    expect(valueOf(evalTokens([2, 4, CM], { distanceUnit: 0, angleUnit: 1, dpi: 96 }))).toBeCloseTo((24 * 96) / 2.54, 12);
  });

  it('allows a unit suffix after pi and keeps function parentheses intact', () => {
    expect(valueOf(evalTokens(fn(SIN, PARENT0, MUL, PI, RAD), CM_PAGE, [{ value: 0.5, dimension: 'number' }]))).toBeCloseTo(1, 12);
  });

  it('honours precedence, parentheses and unary minus', () => {
    expect(valueOf(evalTokens([LPAREN, 1, ADD, 2, RPAREN, MUL, 3, SUB, 1]))).toBe(8);
    expect(valueOf(evalTokens([SUB, 2, POW, 2]))).toBe(-4);
    expect(valueOf(evalTokens([2, POW, 3, POW, 2]))).toBe(512);
    expect(valueOf(evalTokens([2, POW, SUB, 1]))).toBe(0.5);
    expect(valueOf(evalTokens([3, POINT, 5, MUL, PARENT0], CM_PAGE, [{ value: 2, dimension: 'number' }]))).toBe(7);
    expect(valueOf(evalTokens([1, 5]))).toBe(15);
  });

  it('reports divergence, undefined values and unsupported tokens separately', () => {
    expect(evalTokens([1, DIV, 0])).toMatchObject({ ok: false, reason: expect.stringMatching(/^value-infinite/) });
    expect(evalTokens([0, DIV, 0])).toMatchObject({ ok: false, reason: expect.stringMatching(/^value-undefined/) });
    expect(evalTokens(fn(SQRT, 0x1001, 1))).toMatchObject({ ok: false, reason: expect.stringMatching(/^value-undefined/) });
    expect(evalTokens(fn(LN, 0))).toMatchObject({ ok: false, reason: expect.stringMatching(/^value-undefined/) });
    expect(evalTokens(fn(LOG, 0x1001, 5))).toMatchObject({ ok: false, reason: expect.stringMatching(/^value-undefined/) });
    expect(evalTokens(fn(ASIN, 2))).toMatchObject({ ok: false, reason: expect.stringMatching(/^value-undefined/) });
    expect(evalTokens([0x7000, 1, RPAREN])).toMatchObject({ ok: false, reason: 'expression-unsupported:0x7000' });
    expect(evalTokens([1, 0x0102])).toMatchObject({ ok: false, reason: 'expression-unsupported:0x0102' });
    expect(evalTokens([0x000f])).toMatchObject({ ok: false, reason: 'expression-unsupported:0x000f' });
    expect(evalTokens([PARENT0], CM_PAGE, [])).toMatchObject({ ok: false, reason: 'expression-unsupported:0x6000' });
  });
});

describe('display formatting', () => {
  it('keeps trailing zeros, uses no decimal point at digits=0, and stays self-consistent', () => {
    expect(formatReading(3.5, 'number', 2, CM_PAGE, false)).toEqual({ displayValue: 3.5, displayNumber: '3.50', displayUnitText: '' });
    expect(formatReading(7.6, 'number', 0, CM_PAGE, false)).toEqual({ displayValue: 8, displayNumber: '8', displayUnitText: '' });
    const text = formatReading(2.5146, 'length', 2, CM_PAGE, false);
    expect(text.displayNumber).toBe('2.51');
    expect(Number(text.displayNumber)).toBe(text.displayValue);
    expect(text.displayUnitText).toBe('厘米');
  });

  it('rounds exact halves away from zero and still reports displayNumber', () => {
    expect(formatReading(2.5, 'number', 0, CM_PAGE, false)).toMatchObject({ displayValue: 3, displayNumber: '3' });
    expect(formatReading(-2.5, 'number', 0, CM_PAGE, false)).toMatchObject({ displayValue: -3, displayNumber: '-3' });
    expect(formatReading(0.125, 'number', 2, CM_PAGE, false)).toMatchObject({ displayValue: 0.13, displayNumber: '0.13' });
    // 半值边界不再省略：语料里这 3 条正好是"按 double 精确值 half-away-from-zero"的证据。
    expect(formatReading(0.6349999999999993, 'number', 2, CM_PAGE, false).displayNumber).toBe('0.63');
    expect(formatReading(5.715000000000001, 'number', 2, CM_PAGE, false).displayNumber).toBe('5.72');
    // 负零：原版在舍入结果为 0 时不输出负号（IFS-摇曳的蕨叶 页1 对象67）。
    expect(formatReading(-0.004, 'number', 2, CM_PAGE, false).displayNumber).toBe('0.00');
    expect(formatReading(-0.004, 'number', 2, CM_PAGE, false).displayValue).toBe(0);
  });

  it('drops the minus sign only when the rounded reading is zero', () => {
    const at2 = formatReading(-0.004001, 'number', 2, CM_PAGE, false);
    expect(at2.displayNumber).toBe('0.00');
    expect(at2.displayValue).toBe(0);
    // 舍入后非零则保留符号位，不是"丢弃负号"。
    expect(formatReading(-0.004001, 'number', 5, CM_PAGE, false).displayNumber).toBe('-0.00400');
    expect(formatReading(-0.5, 'number', 0, CM_PAGE, false)).toMatchObject({ displayValue: -1, displayNumber: '-1' });
  });

  it('keeps very large readings finite instead of building a broken decimal string', () => {
    // 语料里 1e25 / 1e100 这类值来自表达式（J-L-Perspective 122、J37.2 9）。
    expect(formatReading(1e25, 'number', 5, CM_PAGE, false)).toEqual({
      displayValue: 1e25,
      displayNumber: '1.00000e+25',
      displayUnitText: '',
    });
    expect(formatReading(1e100, 'number', 0, CM_PAGE, false).displayNumber).toBe('1e+100');
  });

  it('chooses the angle glyph from the font chain', () => {
    expect(formatReading(90, 'angle', 2, CM_PAGE, false).displayUnitText).toBe('\u00B0');
    expect(formatReading(90, 'angle', 2, CM_PAGE, true).displayUnitText).toBe('\uF0B0');
    expect(formatReading(90, 'angle', 2, { ...CM_PAGE, angleUnit: 0 }, true).displayUnitText).toBe('弧度');
    expect(formatReading(90, 'angle', 2, { ...CM_PAGE, angleUnit: 2 }, false).displayUnitText).toBe('\u00B0');
  });
});

describe('measures 36-47', () => {
  it('36 segment length is reported in the page display unit with px magnitude', () => {
    // 95 px = 2.5135... cm; the acceptance example uses 2.51.
    const reading = measureAt([pointObject(1, 0, 0), pointObject(2, 95, 0), object(3, 2, { parents: [1, 2] }), measureObject(4, 36, [3])], 4);
    expect(reading.displayNumber).toBe('2.51');
    expect(reading.displayUnitText).toBe('厘米');
    expect(reading.internal.dimension).toBe('length');
    expect(reading.internal.magnitude).toBeCloseTo(95, 9);
    expect(reading.internal.displayRaw).toBeCloseTo(95 / (96 / 2.54), 9);
    expect(reading.displayValue).toBe(Number(reading.displayNumber));
    // displayRaw 必须是未舍入值，否则无法判断一条读数是否落在半值边界。
    expect(reading.internal.displayRaw).not.toBe(reading.displayValue);
  });

  it('37 two-point distance and 40 circle circumference', () => {
    const distance = measureAt([pointObject(1, 0, 0), pointObject(2, 3, 4), measureObject(3, 37, [1, 2])], 3);
    expect(distance.displayValue).toBe(0.13);
    const circumference = measureAt([pointObject(1, 0, 0), pointObject(2, 10, 0), object(3, 3, { parents: [1, 2] }), measureObject(4, 40, [3])], 4);
    expect(circumference.displayValue).toBe(1.66);
    expect(circumference.internal.magnitude).toBeCloseTo(20 * Math.PI, 9);
  });

  it('39 perimeter of polygon, sector and circular segment', () => {
    const square = [
      pointObject(1, 0, 0), pointObject(2, 10, 0), pointObject(3, 10, 10), pointObject(4, 0, 10),
      object(5, 8, { parents: [1, 2, 3, 4] }), measureObject(6, 39, [5]),
    ];
    expect(measureAt(square, 6).displayValue).toBe(1.06);
    const sector = [
      pointObject(1, 0, 0), pointObject(2, 10, 0), pointObject(3, 0, -10),
      object(4, 80, { parents: [1, 2, 3] }), object(5, 82, { parents: [4] }), measureObject(6, 39, [5]),
    ];
    const sectorReading = measureAt(sector, 6);
    expect(sectorReading.internal.magnitude).toBeCloseTo(10 * (Math.PI / 2) + 20, 9);
    const segment = [
      pointObject(1, 0, 0), pointObject(2, 10, 0), pointObject(3, 0, -10),
      object(4, 80, { parents: [1, 2, 3] }), object(5, 83, { parents: [4] }), measureObject(6, 39, [5]),
    ];
    const segmentReading = measureAt(segment, 6);
    expect(segmentReading.internal.magnitude).toBeCloseTo(10 * (Math.PI / 2) + Math.hypot(10, 10), 9);
  });

  it('43 arc angle, 44 arc length, 46 radius', () => {
    const objects = [
      pointObject(1, 0, 0), pointObject(2, 10, 0), pointObject(3, 0, -10),
      object(4, 80, { parents: [1, 2, 3] }),
      measureObject(5, 43, [4], 2, { genera: 49 }), measureObject(6, 44, [4]), measureObject(7, 46, [4]),
    ];
    const angle = measureAt(objects, 5);
    expect(angle.displayValue).toBe(90);
    expect(angle.displayUnitText).toBe('\u00B0');
    expect(angle.internal.magnitude).toBeCloseTo(Math.PI / 2, 9);
    const arcLength = measureAt(objects, 6);
    expect(arcLength.internal.magnitude).toBeCloseTo(5 * Math.PI, 9);
    const radius = measureAt(objects, 7);
    expect(radius.internal.magnitude).toBe(10);
  });

  it('41 three-point angle keeps the directed sign unless 10042=1', () => {
    const objects = [
      pointObject(1, 1, 0), pointObject(2, 0, 0), pointObject(3, 0, 1),
      measureObject(4, 41, [1, 2, 3], 2, { genera: 49 }),
    ];
    const directed = measureAt(objects, 4, { angleUnit: 2 });
    expect(directed.displayValue).toBe(-90);
    expect(directed.displayNumber).toBe('-90.00');
    expect(directed.internal.magnitude).toBeCloseTo(-Math.PI / 2, 9);
    expect(measureAt(objects, 4, { angleUnit: 1 }).displayValue).toBe(90);
    expect(failureAt([pointObject(1, 0, 0), pointObject(2, 0, 0), pointObject(3, 0, 1), pointObject(4, 1, 0), measureObject(5, 41, [1, 2, 3])], 5).reason).toMatch(/^value-undefined/);
  });

  it('47 two-segment and collinear three-point ratios', () => {
    const segments = [
      pointObject(1, 0, 0), pointObject(2, 3, 4), pointObject(3, 0, 0), pointObject(4, 4, 0),
      object(5, 2, { parents: [1, 2] }), object(6, 2, { parents: [3, 4] }),
      measureObject(7, 47, [5, 6]),
    ];
    expect(measureAt(segments, 7).displayValue).toBe(1.25);
    const points = [
      pointObject(1, 0, 0), pointObject(2, 4, 0), pointObject(3, -2, 0),
      measureObject(4, 47, [1, 2, 3]),
    ];
    expect(measureAt(points, 4).displayNumber).toBe('-0.50');
    const noncollinear = [pointObject(1, 0, 0), pointObject(2, 4, 0), pointObject(3, 1, 1), measureObject(4, 47, [1, 2, 3])];
    expect(failureAt(noncollinear, 4).reason).toBe('47-noncollinear');
    const zero = [pointObject(1, 0, 0), pointObject(2, 0, 0), pointObject(3, 1, 0), measureObject(4, 47, [1, 2, 3])];
    expect(failureAt(zero, 4).reason).toMatch(/^value-undefined/);
  });

  it('rejects unsupported parents explicitly', () => {
    const disk = [pointObject(1, 0, 0), pointObject(2, 10, 0), object(3, 3, { parents: [1, 2] }), object(4, 10, { parents: [3] }), measureObject(5, 39, [4])];
    expect(failureAt(disk, 5).reason).toBe('39-parent-type:disk');
    const threeParentArc = [
      pointObject(1, 0, 0), pointObject(2, 1, 0), pointObject(3, 0, 1),
      measureObject(4, 44, [1, 2, 3]),
    ];
    expect(failureAt(threeParentArc, 4).reason).toBe('44-three-parent-unverified');
  });

  it('reports missing page preferences instead of assuming defaults', () => {
    const objects = [pointObject(1, 0, 0), pointObject(2, 95, 0), object(3, 2, { parents: [1, 2] }), measureObject(4, 36, [3]), measureObject(5, 36, [3])];
    const all = evaluated(objects, { distanceUnit: undefined });
    expect(all[3]).toMatchObject({ status: 'unsupported', exists: null });
    if (all[3]!.status !== 'ok') expect(all[3]!.reason).toMatch(/^value-undefined:missing-10041/);
    const angle = [pointObject(1, 0, 0), pointObject(2, 10, 0), pointObject(3, 0, -10), object(4, 80, { parents: [1, 2, 3] }), measureObject(5, 43, [4])];
    const withoutAngle = evaluated(angle, { angleUnit: undefined });
    expect(withoutAngle[4]).toMatchObject({ status: 'unsupported', exists: null });
    if (withoutAngle[4]!.status !== 'ok') expect(withoutAngle[4]!.reason).toMatch(/^value-undefined:missing-10042/);
  });

  it('needs a usable DPI only for centimetre / inch pages', () => {
    const objects = [pointObject(1, 0, 0), pointObject(2, 95, 0), object(3, 2, { parents: [1, 2] }), measureObject(4, 36, [3])];
    expect(failureAt(objects, 4, { dpi: undefined })).toEqual({ status: 'unsupported', reason: 'page-dpi-missing' });
    // 静态换算只在 96 下成立；72 DPI 页面按“值算不出来”处理，不假设 96。
    expect(failureAt(objects, 4, { dpi: 72 })).toEqual({ status: 'unsupported', reason: 'page-dpi-non-96:72' });
    // 纯像素页面不需要 DPI。
    expect(measureAt(objects, 4, { distanceUnit: 0, dpi: undefined }).displayNumber).toBe('95.00');
  });

  it('takes a document-level DPI only when the page itself has none', () => {
    const objects = [pointObject(1, 0, 0), pointObject(2, 95, 0), object(3, 2, { parents: [1, 2] }), measureObject(4, 36, [3])];
    const withoutDpi = page(objects, { dpi: undefined });
    const withFallback = evaluatePageGeometry(withoutDpi, 96).objects[3]!;
    expect(withFallback).toMatchObject({ status: 'ok', kind: 'measure' });
    if (withFallback.status === 'ok' && withFallback.kind === 'measure') expect(withFallback.measurement.displayNumber).toBe('2.51');
    // 页面自己的 9008 优先于调用方给的文档级值。
    const withPageDpi = evaluatePageGeometry(page(objects), 72).objects[3]!;
    if (withPageDpi.status === 'ok' && withPageDpi.kind === 'measure') expect(withPageDpi.measurement.displayNumber).toBe('2.51');
  });
});

describe('48 calculations and numeric free objects', () => {
  it('evaluates the documented 90 deg/(P0+1) example in degrees', () => {
    const objects = [
      freeNumber(1, [1], 33),
      calcObject(2, [9, 0, DEG, DIV, LPAREN, PARENT0, ADD, 1, RPAREN], [1], { genera: 49 }),
    ];
    const reading = measureAt(objects, 2);
    expect(reading.displayNumber).toBe('45.00');
    expect(reading.displayUnitText).toBe('\u00B0');
    expect(reading.internal.dimension).toBe('angle');
    expect(reading.internal.magnitude).toBeCloseTo(Math.PI / 4, 12);
  });

  it('uses the unrounded parent value and the genera dimension', () => {
    const objects = [
      pointObject(1, 0, 0), pointObject(2, 95, 0),
      object(3, 2, { parents: [1, 2] }), measureObject(4, 36, [3]),
      calcObject(5, [PARENT0, MUL, 1, 0, 0], [4], { genera: 48 }),
    ];
    const reading = measureAt(objects, 5);
    expect(reading.displayNumber).toBe('251.35');
    expect(reading.displayUnitText).toBe('厘米');
    expect(reading.internal.dimension).toBe('length');
    expect(reading.internal.displayRaw).toBeCloseTo((95 / (96 / 2.54)) * 100, 9);
  });

  it('reports a calculation whose genera disagrees with the expression dimension as unsupported', () => {
    // 24 厘米的表达式是 length，genera 51 是 number：不输出读数，也不改单位。
    expect(failureAt([calcObject(1, [2, 4, CM], [], { genera: 51 })], 1)).toEqual({ status: 'unsupported', reason: 'dimension-mismatch-unverified' });
    // 反方向：纯数字表达式 + genera 48。
    expect(failureAt([calcObject(1, [2, 4], [], { genera: 48 })], 1).reason).toBe('dimension-mismatch-unverified');
    // 一致时照常出读数，并记录 genera 量纲。
    const reading = measureAt([calcObject(1, [2, 4, CM], [], { genera: 48 })], 1);
    expect(reading.displayValue).toBe(24);
    expect(reading.displayUnitText).toBe('厘米');
    expect(reading.internal.dimension).toBe('length');
    expect(reading.internal.generaDimension).toBe('length');
  });

  it('reports a calculation whose genera is outside 48–51 as unsupported', () => {
    for (const genera of [4, 47, 52, 57]) {
      expect(failureAt([calcObject(1, [2, 4], [], { genera })], 1).reason).toBe('dimension-mismatch-unverified');
    }
  });

  it('round keeps its operand dimension like trunc and abs', () => {
    const cm = (name: number) => calcObject(1, [name, 2, 4, 0x000a, 6, CM, RPAREN], [], { genera: 48 });
    for (const fn of [0x2006, 0x200b, 0x200c]) { // abs / round / trunc
      const reading = measureAt([cm(fn)], 1);
      expect(reading.internal.dimension).toBe('length');
      expect(reading.displayUnitText).toBe('厘米');
    }
    // round 的结果是 length，genera 51 就和它冲突。
    expect(failureAt([calcObject(1, [0x200b, 2, 4, 0x000a, 6, CM, RPAREN], [], { genera: 51 })], 1).reason).toBe('dimension-mismatch-unverified');
  });

  it('evaluates numeric free objects (constraint 0, main kind 11) in page units', () => {
    const objects = [freeNumber(1, [9, 0, DEG], 81)];
    const radians: Partial<PageNumericPreferences> = { distanceUnit: 2, angleUnit: 0, dpi: 96 };
    const reading = measureAt(objects, 1, radians);
    expect(reading.displayValue).toBeCloseTo(1.57, 12);
    expect(reading.displayUnitText).toBe('弧度');
    expect(reading.internal.dimension).toBe('angle');
    expect(reading.internal.magnitude).toBeCloseTo(Math.PI / 2, 12);
  });

  it('converts centimetres into inches and keeps internal pixels', () => {
    const objects = [freeNumber(1, [2, 4, CM], 80)];
    const reading = measureAt(objects, 1, { distanceUnit: 2, angleUnit: 1, dpi: 96 });
    expect(reading.displayNumber).toBe('9.45');
    expect(reading.displayUnitText).toBe('英寸');
    expect(reading.internal.magnitude).toBeCloseTo((24 / 2.54) * 96, 9);
  });

  it('refuses function definitions, parent slots in free objects and unknown arithmetic', () => {
    expect(failureAt([freeNumber(1, [0x000f], 57)], 1).reason).toBe('function-object-unverified');
    expect(failureAt([freeNumber(1, [PARENT0], 79)], 1).reason).toBe('expression-unsupported:0x6000');
    expect(failureAt([freeNumber(1, [1, DIV, 0], 79)], 1).reason).toMatch(/^value-infinite/);
  });

  it('blocks a calculation whose numeric parent is unsupported', () => {
    const objects = [freeNumber(1, [0x000f], 57), calcObject(2, [PARENT0], [1])];
    const result = evaluated(objects).find((o) => o.objectIndex === 2)!;
    expect(result).toMatchObject({ status: 'unsupported', exists: null, reason: 'parent:1:unsupported' });
  });

  it('does not treat a missing display prefix as a number', () => {
    const objects = [object(1, 0, { mainKind: 11, genera: 79, records: [] })];
    expect(failureAt(objects, 1).reason).toBe('missing-2311');
  });
});
