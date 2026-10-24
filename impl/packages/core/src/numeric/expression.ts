/**
 * 2311 表达式解码与求值（卡片 48、卡片 0 的数值自由对象，格式规格 §8.11）。
 *
 * 值一律在**页面显示单位**里求：长度用 10041 单位、角度用 10042 单位、面积用长度单位²、
 * 无量纲是纯数。量纲不参与运行时检查，只用于单位文字、三角函数换算与 genera 交叉核对。
 * 单位后缀 token（0x0100/0x0101/0x0201）把它前面的数字字面量换算进当前页面单位。
 */

import { angleUnitScale, distanceUnitScale } from './units.ts';
import type { Dimension, PageNumericPreferences } from './units.ts';

export interface NumericContext {
  /** 父槽 i → 父数值（显示单位值 + 量纲）。 */
  parents: readonly { value: number; dimension: Dimension }[];
  page: PageNumericPreferences;
}

export type ExpressionResult =
  | { ok: true; value: number; dimension: Dimension }
  | { ok: false; reason: string };

const ADD = 0x1000;
const SUB = 0x1001;
const MUL = 0x1002;
const DIV = 0x1003;
const POW = 0x1004;
const LPAREN = 11;
const RPAREN = 12;
const PI = 13;
const E = 14;
const DECIMAL_POINT = 10;
const FUNCTION_FIRST = 0x2000;
const FUNCTION_LAST = 0x200c;
const PARENT_FIRST = 0x6000;
const PARENT_LAST = 0x6fff;
const CALL_FIRST = 0x7000;
const CALL_LAST = 0x7fff;
const RADIAN_SUFFIX = 0x0100;
const DEGREE_SUFFIX = 0x0101;
const CENTIMETER_SUFFIX = 0x0201;
const SYMBOLIC_UNSUPPORTED_UNITS = new Set([0x0102, 0x0200, 0x0202]);
const UNIT_SUFFIXES = new Set([RADIAN_SUFFIX, DEGREE_SUFFIX, CENTIMETER_SUFFIX, ...SYMBOLIC_UNSUPPORTED_UNITS]);
const FUNCTION_ARGUMENT_PLACEHOLDER = 0x000f;

const FUNCTION_NAMES = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'abs',
  'sqrt', 'ln', 'log', 'sgn', 'round', 'trunc',
] as const;

class EvaluationFailure extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

const fail = (reason: string): never => { throw new EvaluationFailure(reason); };
const tokenText = (token: number): string => `0x${token.toString(16).padStart(4, '0')}`;
const unsupportedToken = (token: number): never => fail(`expression-unsupported:${tokenText(token)}`);
const undefinedValue = (what: string): never => fail(`value-undefined:${what}`);
const infiniteValue = (what: string): never => fail(`value-infinite:${what}`);

interface NumericValue {
  value: number;
  dimension: Dimension;
}

function addDimension(a: Dimension, b: Dimension): Dimension {
  // 不引入运行时量纲检查：数字是中性元，其余取左侧非数字量纲。
  if (a === 'number') return b;
  return a;
}

function multiplyDimension(a: Dimension, b: Dimension): Dimension {
  if (a === 'number') return b;
  if (b === 'number') return a;
  if (a === 'length' && b === 'length') return 'area';
  return a;
}

function divideDimension(a: Dimension, b: Dimension): Dimension {
  if (b === 'number') return a;
  if (a === b) return 'number';
  if (a === 'area' && b === 'length') return 'length';
  return a;
}

function powerDimension(base: Dimension, exponent: Dimension): Dimension {
  if (base === 'number') return 'number';
  if (base === 'length' && exponent === 'number') return 'area';
  return base;
}

function pageAngleToRadians(value: number, page: PageNumericPreferences): number {
  if (page.angleUnit === undefined) return undefinedValue('missing-10042');
  return value * angleUnitScale(page.angleUnit);
}

function radiansToPageAngle(value: number, page: PageNumericPreferences): number {
  if (page.angleUnit === undefined) return undefinedValue('missing-10042');
  return value / angleUnitScale(page.angleUnit);
}

/** 单位后缀只作用于紧邻的数字字面量；换算到页面显示单位。 */
function applyUnitSuffix(value: number, token: number, page: PageNumericPreferences): NumericValue {
  if (token === RADIAN_SUFFIX) {
    if (page.angleUnit === undefined) return undefinedValue('missing-10042');
    return { value: page.angleUnit === 0 ? value : (value * 180) / Math.PI, dimension: 'angle' };
  }
  if (token === DEGREE_SUFFIX) {
    if (page.angleUnit === undefined) return undefinedValue('missing-10042');
    return { value: page.angleUnit === 0 ? (value * Math.PI) / 180 : value, dimension: 'angle' };
  }
  // 0x0201：厘米。
  if (page.distanceUnit === undefined) return undefinedValue('missing-10041');
  if (page.distanceUnit === 1) return { value, dimension: 'length' };
  if (page.distanceUnit === 2) return { value: value / 2.54, dimension: 'length' };
  if (page.dpi === undefined) return undefinedValue('missing-9008');
  return { value: (value * distanceUnitScale(1, page.dpi)) / distanceUnitScale(0, page.dpi), dimension: 'length' };
}

class Parser {
  private readonly tokens: readonly number[];
  private readonly context: NumericContext;
  private position = 0;

  constructor(tokens: readonly number[], context: NumericContext) {
    this.tokens = tokens;
    this.context = context;
  }

  parse(): NumericValue {
    if (this.tokens.length === 0) fail('expression-unsupported:empty');
    const value = this.parseSum();
    if (this.position !== this.tokens.length) {
      const token = this.tokens[this.position]!;
      if (SYMBOLIC_UNSUPPORTED_UNITS.has(token) || UNIT_SUFFIXES.has(token)
        || token === FUNCTION_ARGUMENT_PLACEHOLDER
        || (token >= CALL_FIRST && token <= CALL_LAST)) unsupportedToken(token);
      fail(`expression-unsupported:syntax-${tokenText(token)}`);
    }
    return value;
  }

  private peek(): number | undefined { return this.tokens[this.position]; }

  private parseSum(): NumericValue {
    let left = this.parseProduct();
    for (;;) {
      const token = this.peek();
      if (token !== ADD && token !== SUB) return left;
      this.position++;
      const right = this.parseProduct();
      const value = token === ADD ? left.value + right.value : left.value - right.value;
      left = { value, dimension: addDimension(left.dimension, right.dimension) };
    }
  }

  private parseProduct(): NumericValue {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token !== MUL && token !== DIV) return left;
      this.position++;
      const right = this.parseUnary();
      if (token === MUL) {
        left = { value: left.value * right.value, dimension: multiplyDimension(left.dimension, right.dimension) };
      } else {
        if (right.value === 0) {
          if (left.value === 0) undefinedValue('zero-over-zero');
          infiniteValue('division-by-zero');
        }
        left = { value: left.value / right.value, dimension: divideDimension(left.dimension, right.dimension) };
      }
      if (Number.isNaN(left.value)) undefinedValue('arithmetic-domain');
      if (!Number.isFinite(left.value)) infiniteValue('arithmetic-overflow');
    }
  }

  private parseUnary(): NumericValue {
    if (this.peek() === SUB) {
      this.position++;
      const operand = this.parseUnary();
      return { value: -operand.value, dimension: operand.dimension };
    }
    // 操作数位置上的加号在原版语料里没有样本；明确未支持而不是当二元运算符吞掉。
    if (this.peek() === ADD) unsupportedToken(ADD);
    return this.parsePower();
  }

  /** 幂右结合，且比一元负号紧：-2^2=-4、2^-1=0.5。 */
  private parsePower(): NumericValue {
    const base = this.parseAtom();
    if (this.peek() !== POW) return base;
    this.position++;
    const exponent = this.parseUnary();
    const value = Math.pow(base.value, exponent.value);
    if (Number.isNaN(value)) undefinedValue('power-domain');
    if (!Number.isFinite(value)) infiniteValue('power-overflow');
    return { value, dimension: powerDimension(base.dimension, exponent.dimension) };
  }

  private parseAtom(): NumericValue {
    const token = this.peek();
    if (token === undefined) return fail('expression-unsupported:syntax-unexpected-end');
    if (token >= 0 && token <= 9) return this.parseNumber();
    if (token === DECIMAL_POINT) return this.parseNumber();
    if (token === LPAREN) {
      this.position++;
      const inner = this.parseSum();
      if (this.peek() !== RPAREN) fail('expression-unsupported:syntax-missing-rparen');
      this.position++;
      return inner;
    }
    if (token === PI) { this.position++; return this.finishLiteral(Math.PI, 'number'); }
    if (token === E) { this.position++; return this.finishLiteral(Math.E, 'number'); }
    if (token >= FUNCTION_FIRST && token <= FUNCTION_LAST) return this.parseFunction(token);
    if (token >= PARENT_FIRST && token <= PARENT_LAST) return this.parseParent(token);
    if (token >= CALL_FIRST && token <= CALL_LAST) unsupportedToken(token);
    if (SYMBOLIC_UNSUPPORTED_UNITS.has(token)) unsupportedToken(token);
    if (token === FUNCTION_ARGUMENT_PLACEHOLDER) unsupportedToken(token);
    return unsupportedToken(token);
  }

  private parseNumber(): NumericValue {
    let text = '';
    let digits = 0;
    while (this.position < this.tokens.length) {
      const token = this.tokens[this.position]!;
      if (token < 0 || token > 9) break;
      text += String(token);
      digits++;
      this.position++;
    }
    if (this.peek() === DECIMAL_POINT) {
      text += '.';
      this.position++;
      while (this.position < this.tokens.length) {
        const token = this.tokens[this.position]!;
        if (token < 0 || token > 9) break;
        text += String(token);
        digits++;
        this.position++;
      }
    }
    if (digits === 0) fail('expression-unsupported:syntax-bare-decimal-point');
    const value = Number(text);
    if (!Number.isFinite(value)) infiniteValue('literal-overflow');
    return this.finishLiteral(value, 'number');
  }

  /** 数字或 π/e 之后的单位后缀；不是字面量上的单位 token 一律显式未支持。 */
  private finishLiteral(value: number, dimension: Dimension): NumericValue {
    const suffix = this.peek();
    if (suffix === RADIAN_SUFFIX || suffix === DEGREE_SUFFIX || suffix === CENTIMETER_SUFFIX) {
      this.position++;
      return applyUnitSuffix(value, suffix, this.context.page);
    }
    if (suffix !== undefined && (SYMBOLIC_UNSUPPORTED_UNITS.has(suffix) || suffix === FUNCTION_ARGUMENT_PLACEHOLDER)) {
      unsupportedToken(suffix);
    }
    return { value, dimension };
  }

  private parseParent(token: number): NumericValue {
    this.position++;
    const slot = token - PARENT_FIRST;
    const parent = this.context.parents[slot];
    if (parent === undefined) return unsupportedToken(token);
    return { value: parent.value, dimension: parent.dimension };
  }

  private parseFunction(token: number): NumericValue {
    const name = FUNCTION_NAMES[token - FUNCTION_FIRST]!;
    this.position++;
    const argument = this.parseSum();
    if (this.peek() !== RPAREN) fail('expression-unsupported:syntax-missing-rparen');
    this.position++;
    return applyFunction(name, argument, this.context.page);
  }
}

function applyFunction(name: (typeof FUNCTION_NAMES)[number], argument: NumericValue, page: PageNumericPreferences): NumericValue {
  const x = argument.value;
  switch (name) {
    case 'sin': return { value: Math.sin(pageAngleToRadians(x, page)), dimension: 'number' };
    case 'cos': return { value: Math.cos(pageAngleToRadians(x, page)), dimension: 'number' };
    case 'tan': return { value: Math.tan(pageAngleToRadians(x, page)), dimension: 'number' };
    case 'asin':
      if (x < -1 || x > 1) undefinedValue('asin-domain');
      return { value: radiansToPageAngle(Math.asin(x), page), dimension: 'angle' };
    case 'acos':
      if (x < -1 || x > 1) undefinedValue('acos-domain');
      return { value: radiansToPageAngle(Math.acos(x), page), dimension: 'angle' };
    case 'atan': return { value: radiansToPageAngle(Math.atan(x), page), dimension: 'angle' };
    case 'abs': return { value: Math.abs(x), dimension: argument.dimension };
    case 'sqrt':
      if (x < 0) undefinedValue('sqrt-domain');
      return { value: Math.sqrt(x), dimension: argument.dimension === 'area' ? 'length' : 'number' };
    case 'ln':
      if (x <= 0) undefinedValue('ln-domain');
      return { value: Math.log(x), dimension: 'number' };
    case 'log':
      if (x <= 0) undefinedValue('log-domain');
      return { value: Math.log10(x), dimension: 'number' };
    case 'sgn': return { value: Math.sign(x), dimension: 'number' };
    case 'round': return { value: Math.floor(x + 0.5), dimension: argument.dimension };
    case 'trunc': return { value: Math.trunc(x), dimension: argument.dimension };
  }
}

/** 解码后的 token 序列求值；reason 前缀为 value-infinite / value-undefined / expression-unsupported。 */
export function evaluateExpression(tokens: readonly number[], context: NumericContext): ExpressionResult {
  try {
    const result = new Parser(tokens, context).parse();
    if (Number.isNaN(result.value)) return { ok: false, reason: 'value-undefined:not-a-number' };
    if (!Number.isFinite(result.value)) return { ok: false, reason: 'value-infinite:non-finite-result' };
    return { ok: true, value: result.value, dimension: result.dimension };
  } catch (error) {
    if (error instanceof EvaluationFailure) return { ok: false, reason: error.reason };
    throw error;
  }
}
