/**
 * M5 第三批实现测试：单变量函数与 48 的调用、94 的边界逻辑值子集。
 * 全部是实现方自造输入的单元测试，不是原版断言（原版读数由验收工具另行比对）。
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { PageGeometryEvaluator, evaluateMeasure, evaluatePageGeometry, parseGsp, readDocumentModel } from '../src/index';
import type { ContainerModel, EvaluatedObject, Geometry, ObjectInfo, PageNumericPreferences } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';

const base = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp')))).pages[0]!;

// token 常量（卡片 48 / 函数规格 §1）。
const X = 0x000f, ADD = 0x1000, SUB = 0x1001, MUL = 0x1002, DIV = 0x1003, POW = 0x1004;
const SIN = 0x2000, ASIN = 0x2003, SQRT = 0x2007;
const POINT = 10, LPAREN = 11, RPAREN = 12;
const DEG = 0x0101, CM = 0x0201;
const CALL0 = 0x7000, CALL1 = 0x7001, PARENT0 = 0x6000, PARENT1 = 0x6001, PARENT2 = 0x6002, PARENT3 = 0x6003;

type RecordData = { kind: number; payload: Uint8Array; pad: number };
const record = (kind: number, payload: Uint8Array): RecordData => ({ kind, payload, pad: 0 });

function expressionPayload(tokens: readonly number[], mode: number, digits = 2): Uint8Array {
  const bytes = new Uint8Array(92 + 2 * tokens.length), view = new DataView(bytes.buffer);
  view.setUint16(28, digits, true);
  view.setUint32(32, 2311, true);
  view.setUint32(36, bytes.length - 32, true);
  view.setUint32(40, 48, true);
  view.setUint16(44, tokens.length, true);
  view.setUint16(46, mode, true);
  bytes.fill(0xa5, 48, 92); // +48..91 不透明，函数读取时不能受它影响
  tokens.forEach((t, i) => view.setUint16(92 + 2 * i, t, true));
  return bytes;
}

function obj(index: number, id: number, parents: number[], mainKind: number, genera: number, records: RecordData[] = []): ObjectInfo {
  return { ...base.objects[0]!, index, constraintId: id, mainKind, genera, parents, freePoint: undefined, node: { ...base.objects[0]!.node, records } };
}
function pt(index: number, x: number, y: number): ObjectInfo {
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  view.setFloat64(0, x, true); view.setFloat64(8, y, true);
  return obj(index, 0, [], 1, 4, [record(2201, bytes)]);
}
/** 自由函数 (0,11,57)；mode 是 2311 +46。 */
const fn = (index: number, tokens: readonly number[], mode = 0): ObjectInfo => obj(index, 0, [], 11, 57, [record(2311, expressionPayload(tokens, mode))]);
/** 数值自由对象（模式 4）。 */
const num = (index: number, tokens: readonly number[], genera = 79): ObjectInfo => obj(index, 0, [], 11, genera, [record(2311, expressionPayload(tokens, 4))]);
const calc = (index: number, tokens: readonly number[], parents: number[], genera = 51): ObjectInfo =>
  obj(index, 48, parents, 11, genera, [record(2311, expressionPayload(tokens, 4))]);

function prefix(digits = 2): Uint8Array {
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  view.setUint16(16, 3, true); bytes.set([60, 48, 62], 18); view.setUint16(28, digits, true);
  return bytes;
}
const measure = (index: number, id: number, parents: number[], digits = 2): ObjectInfo => obj(index, id, parents, 7, 51, [record(2307, prefix(digits))]);
const length36 = (index: number, parents: number[]): ObjectInfo => obj(index, 36, parents, 7, 48, [record(2307, prefix())]);

const DEGREE_PAGE: PageNumericPreferences = { distanceUnit: 1, angleUnit: 1, dpi: 96 };
const RADIAN_PAGE: PageNumericPreferences = { distanceUnit: 1, angleUnit: 0, dpi: 96 };
const page = (objects: ObjectInfo[], prefs: PageNumericPreferences = DEGREE_PAGE): ContainerModel => ({ ...base, objects, numericPreferences: prefs });
const at = (objects: ObjectInfo[], index: number, prefs?: PageNumericPreferences): EvaluatedObject =>
  evaluatePageGeometry(page(objects, prefs)).objects.find((o) => o.objectIndex === index)!;
function value(objects: ObjectInfo[], index: number, prefs?: PageNumericPreferences): number {
  const r = at(objects, index, prefs);
  if (r.status !== 'ok' || r.kind !== 'measure') throw new Error(JSON.stringify(r));
  return r.measurement.internal.displayRaw;
}
function reason(objects: ObjectInfo[], index: number, prefs?: PageNumericPreferences): string {
  const r = at(objects, index, prefs);
  if (r.status === 'ok') throw new Error(`object ${index} unexpectedly ok: ${JSON.stringify(r)}`);
  return r.reason;
}
const call = (...argument: number[]): number[] => [CALL0, ...argument, RPAREN];

describe('batch 3 functions: definition container', () => {
  it('evaluates a (0,11,57) mode-0 definition to a callable container without a measurement or default value', () => {
    const r = at([fn(1, [0, POINT, 5, MUL, X, ADD, 1])], 1);
    expect(r).toMatchObject({ status: 'ok', exists: true, kind: 'function', callable: true, definition: { objectIndex: 1, mode: 0, usesArgument: true } });
    expect(r).not.toHaveProperty('measurement');
    if (r.status !== 'ok' || r.kind !== 'function') throw new Error('expected function');
    expect(r.definition.tokens).toEqual([0, POINT, 5, MUL, X, ADD, 1]);
    // 容器是纯数据，可以直接进 JSON 交换格式。
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({ kind: 'function', callable: true, definition: { tokens: [0, POINT, 5, MUL, X, ADD, 1] } });
  });

  it('keeps a constant function a function, and does not run 1/x or 0.5*x at x=0 on open', () => {
    expect(at([fn(1, [5])], 1)).toMatchObject({ status: 'ok', kind: 'function', definition: { usesArgument: false } });
    expect(at([fn(1, [1, DIV, X])], 1)).toMatchObject({ status: 'ok', kind: 'function', callable: true });
  });

  it('identifies by (constraint, main kind, genera), not by main kind alone', () => {
    // 主类 11 / genera 79 是数值参数：照旧给 measurement，不是函数。
    expect(at([num(1, [7])], 1)).toMatchObject({ status: 'ok', kind: 'measure' });
    // genera 57 但 2311 +46=4（数值表达式形式）：不是本批可调用的模式 0。
    expect(reason([fn(1, [X], 4)], 1)).toBe('function-mode-unverified');
  });

  it.each([1, 2, 3])('reports mode %i as function-mode-unverified on the container and on a call', (mode) => {
    const objects = [fn(1, [X, ADD, 1], mode), num(2, [4]), calc(3, call(PARENT1), [1, 2])];
    expect(reason(objects, 1)).toBe('function-mode-unverified');
    expect(reason(objects, 3)).toBe('function-mode-unverified');
  });

  it('reports 2311 layout errors on the container itself', () => {
    const bad = fn(1, [X, ADD, 1]);
    const payload = bad.node.records[0]!.payload.slice(0, 97);
    expect(reason([{ ...bad, node: { ...bad.node, records: [record(2311, payload)] } }], 1)).toBe('2311-layout:length');
    const wrongCount = expressionPayload([X, ADD, 1], 0);
    new DataView(wrongCount.buffer).setUint16(44, 5, true);
    expect(reason([{ ...bad, node: { ...bad.node, records: [record(2311, wrongCount)] } }], 1)).toBe('2311-layout:token-count');
    expect(reason([{ ...bad, node: { ...bad.node, records: [] } }], 1)).toBe('missing-2311');
  });

  it('ignores the +40 word and the opaque +48..91 bytes', () => {
    const f = fn(1, [X, MUL, 2]);
    const payload = f.node.records[0]!.payload.slice();
    new DataView(payload.buffer).setUint32(40, 0, true);
    const r = at([{ ...f, node: { ...f.node, records: [record(2311, payload)] } }, num(2, [4]), calc(3, call(PARENT1), [1, 2])], 3);
    expect(r).toMatchObject({ status: 'ok', kind: 'measure' });
  });
});

describe('batch 3 functions: 48 calls', () => {
  it('calls f(x)=0.5*x+1 with a numeric parent', () => {
    const objects = [fn(1, [0, POINT, 5, MUL, X, ADD, 1]), num(2, [4]), calc(3, call(PARENT1), [1, 2])];
    expect(value(objects, 3)).toBe(3);
    expect(at(objects, 3)).toMatchObject({ status: 'ok', kind: 'measure', measurement: { displayNumber: '3.00', displayUnitText: '' } });
  });

  it('numbers slots over the whole ordered parent table (functions are not filtered out)', () => {
    // F(x)=x+1；父表 [F, A, B] 中 A=2、B=3。F(A*B)=7，F(A)*B=9，二者只在结构上不同。
    const parents = [fn(1, [X, ADD, 1]), num(2, [2]), num(3, [3])];
    expect(value([...parents, calc(4, call(PARENT1, MUL, PARENT2), [1, 2, 3])], 4)).toBe(7);
    expect(value([...parents, calc(4, [...call(PARENT1), MUL, PARENT2], [1, 2, 3])], 4)).toBe(9);
    // 函数不在第 0 槽：父表 [A, F, B]，调用槽 1、实参取槽 2：F(B)=4。
    expect(value([num(1, [2]), fn(2, [X, ADD, 1]), num(3, [3]), calc(4, [CALL1, PARENT2, RPAREN], [1, 2, 3])], 4)).toBe(4);
  });

  it('evaluates 4/x non-commutatively', () => {
    const objects = [fn(1, [4, DIV, X]), num(2, [2]), calc(3, call(PARENT1), [1, 2]), fn(4, [X, DIV, 4]), calc(5, call(PARENT1), [4, 2])];
    expect(value(objects, 3)).toBe(2);
    expect(value(objects, 5)).toBe(0.5);
  });

  it('keeps one local x per call: f(a), f(b), f(g(a)) and f(f(a)) never share state and the records are untouched', () => {
    const f = fn(1, [X, ADD, 1]), g = fn(2, [2, MUL, X]);
    const before = f.node.records[0]!.payload.slice();
    const objects = [f, g, num(3, [3]), num(4, [1, 0]),
      calc(5, [...call(PARENT2), ADD, ...call(PARENT3)], [1, 2, 3, 4]), // f(a)+f(b)
      calc(6, [CALL0, CALL1, PARENT2, RPAREN, RPAREN], [1, 2, 3]), // f(g(a)) = 2*3+1
      calc(7, [CALL0, CALL0, PARENT2, RPAREN, RPAREN], [1, 2, 3]), // f(f(a)) = 3+1+1
      calc(8, [...call(PARENT2), MUL, ...call(PARENT2)], [1, 2, 3])];
    expect(value(objects, 5)).toBe(4 + 11);
    expect(value(objects, 6)).toBe(7);
    expect(value(objects, 7)).toBe(5);
    expect(value(objects, 8)).toBe(16);
    expect(Array.from(f.node.records[0]!.payload)).toEqual(Array.from(before));
  });

  it('recomputes the call after a parameter changes', () => {
    const objects = [fn(1, [X, MUL, X]), num(2, [3]), calc(3, call(PARENT1), [1, 2])];
    const evaluator = new PageGeometryEvaluator(page(objects));
    const read = (): number => { const r = evaluator.evaluate().objects.find((o) => o.objectIndex === 3)!; if (r.status !== 'ok' || r.kind !== 'measure') throw new Error(JSON.stringify(r)); return r.measurement.internal.displayRaw; };
    expect(read()).toBe(9);
    objects[1]!.node.records[0]!.payload.set(expressionPayload([5], 4));
    evaluator.invalidate(2);
    expect(read()).toBe(25);
    expect(evaluator.recomputedIndices).toEqual([2, 3]);
  });

  it('applies the function result through the genera dimension guard', () => {
    // asin(x) 是 angle：genera 49 通过，genera 51 报 mismatch；度页面里 asin(0.5)=30。
    const objects = [fn(1, [ASIN, X, RPAREN]), num(2, [0, POINT, 5]), calc(3, call(PARENT1), [1, 2], 49), calc(4, call(PARENT1), [1, 2], 51)];
    expect(value(objects, 3)).toBeCloseTo(30, 12);
    expect(at(objects, 3)).toMatchObject({ measurement: { internal: { dimension: 'angle' } } });
    expect(value(objects, 3, RADIAN_PAGE)).toBeCloseTo(Math.PI / 6, 12);
    expect(reason(objects, 4)).toBe('dimension-mismatch-unverified');
    // sin(2*x) 是 number：度页面 x=15 → sin(30°)=0.5。
    expect(value([fn(1, [SIN, 2, MUL, X, RPAREN]), num(2, [1, 5]), calc(3, call(PARENT1), [1, 2])], 3)).toBeCloseTo(0.5, 12);
    // f(x)=x 结果是 number，genera 48 就是 mismatch。
    expect(reason([fn(1, [X]), num(2, [1]), calc(3, call(PARENT1), [1, 2], 48)], 3)).toBe('dimension-mismatch-unverified');
  });

  it('passes an angle argument only to a body that is exactly sin(x), using the unrounded page reading', () => {
    // 30° 的 48（genera 49）作实参：度页面 x=30，弧度页面 x=π/6，sin 都是 0.5，结果是 number。
    const angle = calc(2, [3, 0, DEG], [], 49);
    const sinBody = [fn(1, [SIN, X, RPAREN]), angle, calc(3, call(PARENT1), [1, 2])];
    expect(value(sinBody, 3)).toBeCloseTo(0.5, 12);
    expect(value(sinBody, 3, RADIAN_PAGE)).toBeCloseTo(0.5, 12);
    expect(at(sinBody, 3)).toMatchObject({ measurement: { internal: { dimension: 'number' } } });
    // 未舍入：1/3 度显示 0.33 但传入的是完整值。
    const third = calc(2, [1, 0, 0, DEG, DIV, 3], [], 49); // 100°/3，显示 33.33
    expect(at([calc(1, [1, 0, 0, DEG, DIV, 3], [], 49)], 1)).toMatchObject({ measurement: { displayNumber: '33.33' } });
    expect(value([fn(1, [SIN, X, RPAREN]), third, calc(3, call(PARENT1), [1, 2])], 3)).toBeCloseTo(Math.sin(((100 / 3) * Math.PI) / 180), 12);
    // 其它角度正文一律未核证。
    for (const body of [[X], [2, MUL, SIN, X, RPAREN], [SIN, X, RPAREN, ADD, 0], [SIN, LPAREN, X, RPAREN, RPAREN], [ASIN, X, RPAREN]]) {
      expect(reason([fn(1, body), angle, calc(3, call(PARENT1), [1, 2])], 3)).toBe('function-argument-dimension-unverified');
    }
  });

  it('refuses length and area arguments', () => {
    const objects = [fn(1, [X, MUL, 2]), pt(2, 0, 0), pt(3, 96, 0), obj(4, 2, [2, 3], 2, 14), length36(5, [4]),
      calc(6, call(PARENT1), [1, 5]), calc(7, [1, 0, CM], [], 48), calc(8, call(PARENT1), [1, 7]),
      calc(9, [1, 0, CM, MUL, 1, 0, CM], [], 50), calc(10, call(PARENT1), [1, 9]), calc(11, call(2, CM), [1])];
    for (const index of [6, 8, 10, 11]) expect(reason(objects, index)).toBe('function-argument-dimension-unverified');
  });

  it('reports a unit suffix in the body as function-body-unit-unverified', () => {
    for (const unit of [[9, 0, DEG], [2, 4, CM], [1, 0x0100], [1, 0x0102], [1, 0x0200], [1, 0x0202]]) {
      const objects = [fn(1, [X, ADD, ...unit]), num(2, [4]), calc(3, call(PARENT1), [1, 2])];
      expect(reason(objects, 3)).toBe('function-body-unit-unverified');
    }
    // 定义本身仍可调用，未调用不报错。
    expect(at([fn(1, [X, ADD, 9, 0, DEG])], 1)).toMatchObject({ status: 'ok', kind: 'function' });
  });

  it('keeps unsupported tokens in a body explicit: no parent slots, no calls, unknown tokens', () => {
    const run = (body: number[]) => reason([fn(1, body), num(2, [4]), calc(3, call(PARENT1), [1, 2])], 3);
    expect(run([PARENT0, ADD, X])).toBe('expression-unsupported:0x6000');
    expect(run([...call(X), ADD, 1])).toBe('expression-unsupported:0x7000');
    expect(run([X, ADD, 0x3000])).toBe('expression-unsupported:0x3000');
    expect(run([])).toBe('expression-unsupported:empty');
    expect(run([X, ADD])).toBe('expression-unsupported:syntax-unexpected-end');
  });

  it('separates mathematical failures from container failures', () => {
    const inverse = fn(1, [1, DIV, X]);
    expect(reason([inverse, num(2, [0]), calc(3, call(PARENT1), [1, 2])], 3)).toBe('value-infinite:division-by-zero');
    expect(reason([fn(1, [SQRT, X, RPAREN]), num(2, [1]), calc(3, call(PARENT1, SUB, 2, SUB, 2), [1, 2])], 3)).toBe('value-undefined:sqrt-domain');
    expect(reason([fn(1, [0, DIV, X]), num(2, [0]), calc(3, call(PARENT1), [1, 2])], 3)).toBe('value-undefined:zero-over-zero');
    expect(reason([fn(1, [X, POW, X]), num(2, [SUB, 0, POINT, 5]), calc(3, call(PARENT1), [1, 2])], 3)).toBe('value-undefined:power-domain');
    // 祖先未支持：沿用祖先阻塞，不能吞成数学错误。
    const blocked = [fn(1, [X]), obj(2, 99, [], 7, 51), calc(3, call(PARENT1), [1, 2])];
    expect(at(blocked, 3)).toMatchObject({ status: 'unsupported', reason: 'parent:2:unsupported' });
  });

  it('keeps an argument-ancestor failure instead of swallowing it', () => {
    const objects = [fn(1, [X]), num(2, [1, DIV, 0]), calc(3, call(PARENT1), [1, 2])];
    expect(at(objects, 2)).toMatchObject({ status: 'unsupported', reason: 'value-infinite:division-by-zero' });
    expect(at(objects, 3)).toMatchObject({ status: 'unsupported', reason: 'parent:2:unsupported' });
  });

  it('classifies bad callees without borrowing the free-function rule', () => {
    const f = fn(1, [X]);
    // 数值度量被当函数调用。
    expect(reason([num(1, [4]), calc(2, call(2), [1])], 2)).toBe('function-parent-not-callable');
    // 父表 [F, A]：槽 1（数值）被当函数调用。
    expect(reason([f, num(2, [4]), calc(3, call(PARENT1), [1, 2]), calc(4, [CALL1, 3, RPAREN], [1, 2])], 4)).toBe('function-parent-not-callable');
    // 点、线等几何父在进入函数规则前就按父类型报 numeric-value-required。
    expect(reason([pt(1, 0, 0), calc(2, call(2), [1])], 2)).toBe('parent:1:numeric-value-required');
    expect(reason([pt(1, 0, 0), pt(2, 5, 0), obj(3, 2, [1, 2], 2, 14), fn(4, [X]), calc(5, call(2), [3, 4])], 5)).toBe('parent:3:numeric-value-required');
    // 62 按钮、71 与 70 等其它函数族。
    expect(reason([obj(1, 62, [2], 10, 23), pt(2, 0, 0), calc(3, call(2), [1])], 3)).toBe('function-parent-not-callable');
    expect(reason([obj(1, 71, [], 11, 54), calc(2, call(2), [1])], 2)).toBe('function-callee-unverified');
    expect(reason([obj(1, 70, [], 1, 56), calc(2, call(2), [1])], 2)).toBe('function-callee-unverified');
    expect(reason([obj(1, 99, [], 11, 57), calc(2, call(2), [1])], 2)).toBe('function-callee-unverified');
    // 没有被调用的 62/71 父仍是普通祖先阻塞。
    expect(reason([obj(1, 71, [], 11, 54), num(2, [4]), calc(3, [PARENT1], [1, 2])], 3)).toBe('parent:1:unsupported');
  });

  it('never reads a function container as a number', () => {
    const objects = [fn(1, [X]), num(2, [4]), calc(3, [PARENT0, ADD, PARENT1], [1, 2])];
    expect(reason(objects, 3)).toBe('parent:1:numeric-value-required');
  });

  it('reports out-of-range slots, missing right parentheses and missing arguments explicitly', () => {
    const base3 = [fn(1, [X]), num(2, [4])];
    expect(reason([...base3, calc(3, [0x7005, 1, RPAREN], [1, 2])], 3)).toBe('expression-unsupported:0x7005');
    expect(reason([...base3, calc(3, [CALL0, 1], [1, 2])], 3)).toBe('expression-unsupported:syntax-missing-rparen');
    expect(reason([...base3, calc(3, [CALL0, RPAREN], [1, 2])], 3)).toBe('expression-unsupported:syntax-call-missing-argument');
    expect(reason([...base3, calc(3, [CALL0], [1, 2])], 3)).toBe('expression-unsupported:syntax-call-missing-argument');
    expect(reason([...base3, calc(3, [PARENT2], [1, 2])], 3)).toBe('expression-unsupported:0x6002');
  });

  it('keeps 0x000F out of numeric objects and out of 48 expressions', () => {
    expect(reason([num(1, [X])], 1)).toBe('expression-unsupported:0x000f');
    expect(reason([fn(1, [X]), calc(2, [X], [1])], 2)).toBe('expression-unsupported:0x000f');
    expect(value([num(1, [1, 5])], 1)).toBe(15);
  });

  it('works for the page without any display preference only when no unit conversion is needed', () => {
    const objects = [fn(1, [X, MUL, 2]), num(2, [4]), calc(3, call(PARENT1), [1, 2])];
    expect(value(objects, 3, { distanceUnit: undefined, angleUnit: undefined, dpi: undefined })).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------
// 94：多边形与普通 80 弧的边界逻辑值
// ---------------------------------------------------------------------------------------------

function polygonPage(vertices: [number, number][], p: [number, number], polygonId = 8): ObjectInfo[] {
  const n = vertices.length;
  const points = vertices.map((v, i) => pt(i + 1, v[0], v[1]));
  const polygon = obj(n + 1, 8, vertices.map((_, i) => i + 1), 8, 52);
  const shape = polygonId === 8 ? [polygon] : [polygon, obj(n + 2, polygonId, [n + 1], 8, 52)];
  const target = n + 1 + shape.length;
  return [...points, ...shape, pt(target, p[0], p[1]), measure(target + 1, 94, [target, n + shape.length], 5)];
}
function polygonValue(vertices: [number, number][], p: [number, number], polygonId = 8): number {
  const objects = polygonPage(vertices, p, polygonId);
  return value(objects, objects.length);
}
function polygonReason(vertices: [number, number][], p: [number, number], polygonId = 8): string {
  const objects = polygonPage(vertices, p, polygonId);
  return reason(objects, objects.length);
}
const SQUARE: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe('batch 3 card 94: native polygon boundary', () => {
  it('uses cumulative edge length over the perimeter on edge interiors', () => {
    expect(polygonValue(SQUARE, [50, 0])).toBeCloseTo(0.125, 12);
    expect(polygonValue(SQUARE, [100, 40])).toBeCloseTo(0.35, 12);
    expect(polygonValue(SQUARE, [30, 100])).toBeCloseTo(0.675, 12);
    expect(polygonValue(SQUARE, [0, 60])).toBeCloseTo(0.85, 12);
  });

  it('is not (i+s)/n when the edges differ in length', () => {
    const rectangle: [number, number][] = [[0, 0], [200, 0], [200, 100], [0, 100]];
    expect(polygonValue(rectangle, [200, 50])).toBeCloseTo(250 / 600, 12);
    expect(250 / 600).not.toBeCloseTo((1 + 0.5) / 4, 3);
  });

  it('merges a non-seam vertex reached from both neighbouring edges', () => {
    expect(polygonValue(SQUARE, [100, 0])).toBeCloseTo(0.25, 12);
    expect(polygonValue(SQUARE, [100, 100])).toBeCloseTo(0.5, 12);
    expect(polygonValue(SQUARE, [0, 100])).toBeCloseTo(0.75, 12);
  });

  it('does not merge the closing seam V0: 0 and 1 stay ambiguous', () => {
    expect(polygonReason(SQUARE, [0, 0])).toBe('point-value-94-nearest-logical-value-ambiguous');
    // 接缝附近 1e-7 px 内的点同样并列，不任取一边。
    expect(polygonReason(SQUARE, [0, 5e-8])).toBe('point-value-94-nearest-logical-value-ambiguous');
  });

  it('keeps retraced edges (different logical values at the same page point) unsupported', () => {
    // 第三条边 (100,100)->(100,50) 回头重走第二条边的一段。
    const retraced: [number, number][] = [[0, 0], [100, 0], [100, 100], [100, 50]];
    const perimeter = 100 + 100 + 50 + Math.hypot(100, 50);
    expect(polygonReason(retraced, [100, 75])).toBe('point-value-94-nearest-logical-value-ambiguous');
    // 只落在一条边上的点仍然可算。
    expect(polygonValue(retraced, [50, 0])).toBeCloseTo(50 / perimeter, 12);
  });

  it('uses 1e-7 px as the on-boundary tolerance', () => {
    expect(polygonValue(SQUARE, [50, 5e-8])).toBeCloseTo(0.125, 12);
    expect(polygonReason(SQUARE, [50, 2e-7])).toBe('point-value-94-point-off-boundary-unverified');
    expect(polygonReason(SQUARE, [50, 10])).toBe('point-value-94-point-off-boundary-unverified');
    expect(polygonReason(SQUARE, [500, 500])).toBe('point-value-94-point-off-boundary-unverified');
  });

  it('rejects a degenerate edge and non-native polygon parents', () => {
    expect(polygonReason([[0, 0], [100, 0], [100, 0], [0, 100]], [50, 0])).toBe('point-value-94-polygon-degenerate-edge');
    expect(polygonReason([[0, 0], [100, 0], [100, 1e-11], [0, 100]], [50, 0])).toBe('point-value-94-polygon-degenerate-edge');
    // 75 恒等像虽然仍是多边形，但不是原生 8。
    expect(polygonReason(SQUARE, [50, 0], 75)).toBe('point-value-94-polygon-parent-must-be-native-8');
  });

  it('is unitless and independent of the page display preferences', () => {
    const objects = polygonPage(SQUARE, [100, 40]);
    const reading = at(objects, objects.length, RADIAN_PAGE);
    expect(reading).toMatchObject({ status: 'ok', kind: 'measure', measurement: { displayUnitText: '', internal: { dimension: 'number' } } });
  });
});

function arcPage(center: [number, number], a: [number, number], b: [number, number], p: [number, number], arcId = 80): ObjectInfo[] {
  const arc = arcId === 80 ? obj(4, 80, [1, 2, 3], 5, 67) : obj(4, 81, [1, 2, 3], 5, 67);
  return [pt(1, ...center), pt(2, ...a), pt(3, ...b), arc, pt(5, ...p), measure(6, 94, [5, 4], 5)];
}
const onCircle = (center: [number, number], radius: number, mathDegrees: number): [number, number] =>
  [center[0] + radius * Math.cos(mathDegrees * Math.PI / 180), center[1] - radius * Math.sin(mathDegrees * Math.PI / 180)];
const O: [number, number] = [100, 100];

describe('batch 3 card 94: native 80 arc boundary', () => {
  const quarter = (p: [number, number]) => arcPage(O, onCircle(O, 100, 0), onCircle(O, 100, 90), p);

  it('gives the sweep fraction from the first end point, with B end = 1', () => {
    expect(value(quarter(onCircle(O, 100, 45)), 6)).toBeCloseTo(0.5, 9);
    expect(value(quarter(onCircle(O, 100, 22.5)), 6)).toBeCloseTo(0.25, 9);
    expect(value(quarter(onCircle(O, 100, 0)), 6)).toBe(0);
    expect(value(quarter(onCircle(O, 100, 90)), 6)).toBe(1);
  });

  it('recognises numerical end points within 1e-7 px', () => {
    expect(value(quarter([200 + 5e-8, 100]), 6)).toBe(0);
    const end = onCircle(O, 100, 90);
    expect(value(quarter([end[0] + 5e-8, end[1]]), 6)).toBe(1);
  });

  it('handles a 270 degree sweep and a start angle across the 2π seam', () => {
    const big = arcPage(O, onCircle(O, 100, 0), onCircle(O, 100, 270), onCircle(O, 100, 0.85 * 270 - 0));
    expect(value(big, 6)).toBeCloseTo(0.85, 9);
    // 起点 350°（= −10°），终向 30°：扫角 40°，10° 处是 0.5。
    const across = arcPage(O, onCircle(O, 100, -10), onCircle(O, 100, 30), onCircle(O, 100, 10));
    expect(value(across, 6)).toBeCloseTo(0.5, 9);
    const acrossEnd = arcPage(O, onCircle(O, 100, -10), onCircle(O, 100, 30), onCircle(O, 100, 30));
    expect(value(acrossEnd, 6)).toBe(1);
  });

  it('keeps off-circle, off-arc, centre and non-80 cases unsupported', () => {
    expect(reason(quarter([120, 100]), 6)).toBe('point-value-94-point-off-arc-unverified');
    expect(reason(quarter(onCircle(O, 100, 180)), 6)).toBe('point-value-94-point-off-arc-unverified');
    expect(reason(quarter(onCircle(O, 100, 300)), 6)).toBe('point-value-94-point-off-arc-unverified');
    expect(reason(quarter(O), 6)).toBe('point-value-94-point-off-arc-unverified');
    // 三点弧 81 同样不是原生 80。
    expect(reason(arcPage(O, onCircle(O, 100, 0), onCircle(O, 100, 90), onCircle(O, 100, 45), 81), 6)).toBe('point-value-94-arc-parent-must-be-native-80');
  });

  it('rejects zero-sweep, full-turn and zero-radius arcs handed to the evaluator directly', () => {
    const p: Geometry = { kind: 'point', geometry: { x: 200, y: 100 } };
    const arc = (sweepAngle: number, radius = 100): Geometry => ({ kind: 'arc', geometry: { center: [100, 100], radius, startAngle: 0, sweepAngle, start: [200, 100], end: [200, 100] } });
    const byIndex = new Map([[2, obj(2, 80, [], 5, 67)]]);
    for (const g of [arc(0), arc(2 * Math.PI - 1e-12), arc(1, 0)]) {
      expect(evaluateMeasure(measure(3, 94, [1, 2], 5), [p, g], page([]), byIndex)).toMatchObject({ ok: false, reason: 'point-value-94-degenerate-arc' });
    }
    expect(evaluateMeasure(measure(3, 94, [1, 2], 5), [p, arc(1)], page([]), byIndex)).toMatchObject({ ok: true });
    // 没有 byIndex（不能确认父是原生 80）一律未支持。
    expect(evaluateMeasure(measure(3, 94, [1, 2], 5), [p, arc(1)], page([]))).toMatchObject({ ok: false, reason: 'point-value-94-arc-parent-must-be-native-80' });
  });
});
