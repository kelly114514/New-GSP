import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { evaluatePageGeometry, PageGeometryEvaluator, parseGsp, readDocumentModel } from '../src/index';
import type { ContainerModel, EvaluatedObject, ObjectInfo, PageGeometry } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';

const base = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint.gsp')))).pages[0]!;
type RecordData = { kind: number; payload: Uint8Array; pad: number };
const record = (kind: number, payload: Uint8Array): RecordData => ({ kind, payload, pad: 0 });
function measurePrefix(digits = 2): Uint8Array {
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  view.setUint16(28, digits, true);
  return bytes;
}
function object(index: number, constraintId: number, mainKind: number, genera: number, parents: number[], records: RecordData[]): ObjectInfo {
  return { ...base.objects[0]!, index, constraintId, mainKind, genera, parents, freePoint: undefined,
    node: { ...base.objects[0]!.node, records } };
}
function expressionPayload(tokens: readonly number[], mode: number, digits = 2): Uint8Array {
  const payload = new Uint8Array(92 + 2 * tokens.length), view = new DataView(payload.buffer);
  view.setUint16(28, digits, true);
  view.setUint32(32, 2311, true);
  view.setUint32(36, payload.length - 32, true);
  view.setUint32(40, 48, true);
  view.setUint16(44, tokens.length, true);
  view.setUint16(46, mode, true);
  tokens.forEach((token, i) => view.setUint16(92 + 2 * i, token, true));
  return payload;
}
/** 0/11/57 单变量函数定义。 */
function fn(index: number, tokens: readonly number[], mode = 0, parents: number[] = []): ObjectInfo {
  return object(index, 0, 11, 57, parents, [record(2311, expressionPayload(tokens, mode))]);
}
/** 约束 48 计算对象；genera 51 无量纲、48 长度、49 角度。 */
function calc(index: number, tokens: readonly number[], parents: number[], genera = 51, mode = 4): ObjectInfo {
  return object(index, 48, 7, genera, parents, [record(2311, expressionPayload(tokens, mode))]);
}
/** 模式 4 的数值自由对象（不是函数）。 */
function numberValue(index: number, value: number, genera = 79): ObjectInfo {
  const digits = String(value).split('').map((c) => (c === '.' ? 10 : Number(c)));
  return object(index, 0, 11, genera, [], [record(2311, expressionPayload(digits, 4))]);
}
function page(objects: ObjectInfo[], angleUnit: 0 | 1 | 2 = 1): ContainerModel {
  return { ...base, objects, numericPreferences: { distanceUnit: 1, angleUnit, dpi: 96 } };
}
function result(evaluation: PageGeometry, index: number): EvaluatedObject {
  return evaluation.objects.find((o) => o.objectIndex === index)!;
}
function reading(evaluation: PageGeometry, index: number) {
  const r = result(evaluation, index);
  if (r.status !== 'ok' || r.kind !== 'measure') throw new Error(JSON.stringify(r));
  return r.measurement;
}

const CALL0 = 0x7000;
const PARENT0 = 0x6000;
const PARENT1 = 0x6001;
const PARENT2 = 0x6002;
const ADD = 0x1000;
const MUL = 0x1002;
const DIV = 0x1003;
const POW = 0x1004;
const SIN = 0x2000;
const RPAREN = 12;
const X = 0x000f;
const DEGREE = 0x0101;
const CENTIMETER = 0x0201;

describe('single-variable function definitions (0/11/57)', () => {
  it('identifies a mode-0 container without executing the body at open time', () => {
    const evaluation = evaluatePageGeometry(page([fn(1, [1, DIV, X])]));
    expect(result(evaluation, 1)).toMatchObject({ status: 'ok', exists: true, kind: 'function', function: { mode: 0, bodyHasUnitSuffix: false } });
  });

  it('keeps a constant function as a function container, not a numeric reading', () => {
    const objects = [fn(1, [5]), calc(2, [CALL0, 5, RPAREN], [1])];
    const evaluation = evaluatePageGeometry(page(objects));
    expect(result(evaluation, 1)).toMatchObject({ status: 'ok', kind: 'function' });
    expect(reading(evaluation, 2).internal.displayRaw).toBe(5);
  });

  it('binds 0x000F to the argument instead of reading the literal number 15', () => {
    const objects = [fn(1, [X, ADD, 1]), calc(2, [CALL0, 4, RPAREN], [1])];
    expect(reading(evaluatePageGeometry(page(objects)), 2).internal.displayRaw).toBe(5);
  });

  it('refuses 0x000F outside a function body (mode-4 numeric objects stay numeric)', () => {
    const evaluation = evaluatePageGeometry(page([numberValue(1, 3), calc(2, [X], [1])]));
    expect(result(evaluation, 2)).toMatchObject({ status: 'unsupported', reason: 'expression-unsupported:0x000f' });
  });
});

describe('function calls in constraint 48', () => {
  it('uses the full ordered parent table, so F(A*B) is not F(A)*B', () => {
    const objects = [fn(1, [X, POW, 2]), numberValue(2, 3), numberValue(3, 4), calc(4, [CALL0, PARENT1, MUL, PARENT2, RPAREN], [1, 2, 3])];
    // 父表 [F,A,B]：F(3*4)=144；若把 0x6001 当 F 的实参再乘 B 会得到 36。
    expect(reading(evaluatePageGeometry(page(objects)), 4).internal.displayRaw).toBe(144);
  });

  it('gives every call its own local x environment', () => {
    const objects = [fn(1, [X, ADD, 1]), numberValue(2, 2), numberValue(3, 3),
      calc(4, [CALL0, PARENT1, RPAREN], [1, 2]), calc(5, [CALL0, PARENT1, RPAREN], [1, 3])];
    const evaluation = evaluatePageGeometry(page(objects));
    expect(reading(evaluation, 4).internal.displayRaw).toBe(3);
    expect(reading(evaluation, 5).internal.displayRaw).toBe(4);
  });

  it('recomputes a call when its numeric argument changes', () => {
    const argument = numberValue(2, 5);
    const objects = [fn(1, [X, MUL, 2]), argument,
      object(4, 37, 7, 48, [2, 2], [record(2307, measurePrefix(2))]),
      calc(5, [CALL0, PARENT1, RPAREN], [1, 2])];
    const evaluator = new PageGeometryEvaluator(page(objects));
    expect(reading(evaluator.evaluate(), 5).internal.displayRaw).toBe(10);
    // 父数值从 5 改成 7：函数定义不变，调用跟着重算。
    new DataView(argument.node.records[0]!.payload.buffer).setUint16(92, 7, true);
    evaluator.invalidate(2);
    expect(reading(evaluator.evaluate(), 5).internal.displayRaw).toBe(14);
  });

  it('reports a non-callable slot, a function slot read as a number and a missing right parenthesis', () => {
    const objects = [fn(1, [X]), numberValue(2, 7), calc(3, [CALL0, PARENT0, RPAREN], [2]),
      calc(4, [PARENT0], [1]), calc(5, [CALL0, 1], [1])];
    const evaluation = evaluatePageGeometry(page(objects));
    expect(result(evaluation, 3)).toMatchObject({ status: 'unsupported', reason: 'function-parent-not-callable' });
    expect(result(evaluation, 4)).toMatchObject({ status: 'unsupported', reason: 'expression-unsupported:function-parent-as-number' });
    expect(result(evaluation, 5)).toMatchObject({ status: 'unsupported', reason: 'expression-unsupported:syntax-missing-rparen' });
  });

  it('refuses mode 1/2/3 definitions and function bodies with a parent slot', () => {
    const objects = [fn(1, [X], 1), fn(2, [PARENT0]), calc(3, [CALL0, 2, RPAREN], [1]), calc(4, [CALL0, 2, RPAREN], [2])];
    const evaluation = evaluatePageGeometry(page(objects));
    expect(result(evaluation, 1)).toMatchObject({ status: 'unsupported', reason: 'function-mode-unverified' });
    expect(result(evaluation, 3)).toMatchObject({ status: 'unsupported', reason: 'parent:1:unsupported' });
    expect(result(evaluation, 4)).toMatchObject({ status: 'unsupported', reason: 'expression-unsupported:0x6000' });
  });
});

describe('function argument dimensions and page angle units', () => {
  it('passes an angle argument to a body that is exactly sin(x)', () => {
    const objects = [fn(1, [SIN, X, RPAREN]), calc(2, [3, 0, DEGREE], [], 49), calc(3, [CALL0, PARENT1, RPAREN], [1, 2])];
    const degrees = evaluatePageGeometry(page(objects, 1));
    const radians = evaluatePageGeometry(page(objects, 0));
    // 同一个 30 度角：在度页面读数是 30，在弧度页面读数是 pi/6；两者都按页面角度模式解释。
    expect(reading(degrees, 2).internal.displayRaw).toBeCloseTo(30, 9);
    expect(reading(radians, 2).internal.displayRaw).toBeCloseTo(Math.PI / 6, 12);
    expect(reading(degrees, 3).internal.displayRaw).toBeCloseTo(0.5, 12);
    expect(reading(radians, 3).internal.displayRaw).toBeCloseTo(0.5, 12);
  });

  it('leaves other angle bodies unverified instead of guessing a substitution rule', () => {
    const objects = [fn(1, [X]), calc(2, [3, 0, DEGREE], [], 49), calc(3, [CALL0, PARENT1, RPAREN], [1, 2])];
    expect(result(evaluatePageGeometry(page(objects)), 3))
      .toMatchObject({ status: 'unsupported', reason: 'function-argument-dimension-unverified' });
  });

  it('keeps a unit suffix in the body unverified at call time', () => {
    const objects = [fn(1, [2, CENTIMETER]), calc(2, [CALL0, 1, RPAREN], [1])];
    const evaluation = evaluatePageGeometry(page(objects));
    expect(result(evaluation, 1)).toMatchObject({ status: 'ok', kind: 'function', function: { bodyHasUnitSuffix: true } });
    expect(result(evaluation, 2)).toMatchObject({ status: 'unsupported', reason: 'function-body-unit-unverified' });
  });

  it('keeps the genera dimension check for the call result', () => {
    const objects = [fn(1, [X, ADD, 1]), calc(2, [CALL0, 1, RPAREN], [1], 48)];
    expect(result(evaluatePageGeometry(page(objects)), 2))
      .toMatchObject({ status: 'unsupported', reason: 'dimension-mismatch-unverified' });
  });

  it('propagates a non-finite call result as unsupported, not as a finite guess', () => {
    const objects = [fn(1, [1, DIV, X]), calc(2, [CALL0, 0, RPAREN], [1])];
    expect(result(evaluatePageGeometry(page(objects)), 2))
      .toMatchObject({ status: 'unsupported', reason: 'value-infinite:division-by-zero' });
  });
});

describe('function containers in the dependency graph', () => {
  it('does not change the definition when it is called with different arguments', () => {
    const objects = [fn(1, [X, MUL, 2]), numberValue(2, 5), numberValue(3, 6),
      calc(4, [CALL0, PARENT1, RPAREN], [1, 2]), calc(5, [CALL0, PARENT1, RPAREN], [1, 3])];
    const evaluator = new PageGeometryEvaluator(page(objects));
    const first = evaluator.evaluate();
    expect(reading(first, 4).internal.displayRaw).toBe(10);
    expect(reading(first, 5).internal.displayRaw).toBe(12);
    const second = evaluator.evaluate();
    expect(result(second, 1)).toMatchObject({ status: 'ok', kind: 'function' });
    expect(reading(second, 4).internal.displayRaw).toBe(10);
  });
});
