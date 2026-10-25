/**
 * 单变量函数定义（约束 0 / 主类 11 / genera 57，2311 模式 0；规格 features/m5-functions.md）。
 *
 * 函数定义是“可调用”的结果种类，不是数值：没有 `measurement`，打开时不带实参执行正文。
 * 正文 token 里的 0x000F 是本次调用的唯一自变量；正文不能引用父槽（自由函数无 2002）。
 * 调用时每次都在独立的局部环境里绑定 x，定义本身（token 数组）从不被修改。
 */

import { readU16, readU32 } from '../bytes.ts';
import type { PageNumericPreferences } from './units.ts';

/** 函数 2311 的固定头长度；token 从 +92 起。 */
export const FUNCTION_HEADER_BYTES = 92;
/** 正文里的自变量 token（0x000F，不是数字 15）。 */
export const FUNCTION_ARGUMENT_TOKEN = 0x000f;
/** 函数调用 token 区间：0x7000+i 调用 48 父表第 i 槽。 */
export const CALL_TOKEN_FIRST = 0x7000;
export const CALL_TOKEN_LAST = 0x7fff;

/** 可调用的函数定义；纯数据，可以随页面求值结果缓存与 JSON 序列化。 */
export interface FunctionDefinition {
  /** 页内对象序号，仅作身份；解析从不按名称或序号以外的东西找函数。 */
  objectIndex: number;
  /** 2311 +46 的模式字；本批只有 0 可调用。 */
  mode: 0;
  /** +92 起的中缀 token。 */
  tokens: readonly number[];
  /** 正文是否含自变量；常数函数为 false，但仍是函数。 */
  usesArgument: boolean;
  /** 页面数值环境（10041/10042/9008），调用时在这个环境里求正文。 */
  page: PageNumericPreferences;
}

export type FunctionDecode =
  | { ok: true; mode: number; tokens: number[] }
  | { ok: false; reason: string };

/**
 * 函数 2311 布局：+32 为 2311、+36 为载荷长−32、+44 为 token 数 N、总长严格 92+2N。
 * +40 观测为 48 但不是此对象的约束 ID，不检查；+48..91 不透明，原样保留不读。
 */
export function decodeFunctionRecord(payload: Uint8Array): FunctionDecode {
  if (payload.length < FUNCTION_HEADER_BYTES) return { ok: false, reason: '2311-layout:too-short' };
  if (readU32(payload, 32) !== 2311) return { ok: false, reason: '2311-layout:marker' };
  if (readU32(payload, 36) !== payload.length - 32) return { ok: false, reason: '2311-layout:length' };
  const count = readU16(payload, 44);
  if (payload.length !== FUNCTION_HEADER_BYTES + 2 * count) return { ok: false, reason: '2311-layout:token-count' };
  const tokens: number[] = [];
  for (let i = 0; i < count; i++) tokens.push(readU16(payload, FUNCTION_HEADER_BYTES + 2 * i));
  return { ok: true, mode: readU16(payload, 46), tokens };
}

/** 函数体里的显式单位后缀 token（0x0100/0x0101/0x0102/0x0200/0x0201/0x0202）。 */
export function bodyHasUnitSuffix(tokens: readonly number[]): boolean {
  return tokens.some((t) => t === 0x0100 || t === 0x0101 || t === 0x0102 || t === 0x0200 || t === 0x0201 || t === 0x0202);
}

/** 本批唯一放开角度实参的正文：严格 `sin(x)`。 */
export function bodyIsSinOfArgument(tokens: readonly number[]): boolean {
  return tokens.length === 3 && tokens[0] === 0x2000 && tokens[1] === FUNCTION_ARGUMENT_TOKEN && tokens[2] === 12;
}
