/**
 * 对象及其子记录的视图（规格 §8）：对象头 2000、父表 2002、自由点 2201、标签 2005、
 * 样式引用 2008、图片序号 8004。全部是只读视图；形状不对返回 undefined。
 */

import { readF64, readU16, readU32 } from '../bytes.ts';
import type { TextEncoding } from '../text.ts';
import { decodeText } from '../text.ts';

/** 对象头排序值“未指定”（§8.1）。 */
export const SORT_VALUE_UNSET = 0xfff0bdc1;

export const OBJECT_HEADER_LAYOUT5_BYTES = 28;
export const OBJECT_HEADER_LAYOUT4_BYTES = 16;

export interface ObjectHeader {
  /** +0 约束外部 ID；0 = 自由对象。 */
  constraintId: number;
  /** +2 状态码（0..4；含义未知）。 */
  status: number;
  /** +4 field04（0/1；含义未知）。 */
  field04: number;
  /** +6 主类外部 ID（0..19）。 */
  mainKind: number;
  /** +8 genera 外部 ID。 */
  genera: number;
  /** +10 样式字原值。 */
  styleWord: number;
  /**
   * [w0, w1, w2]。布局 5：样式字的三个 4 位字段（位 0..3、4..7、8..11，原值，不夹取）；
   * 布局 4：枚举 0→(1,1,1)、1→(1,2,1)、2→(2,2,1)（≥3 按 1 处理，§8.1）。
   */
  style: [number, number, number];
  /** +12..+14 的 R、G、B 合成的 COLORREF（0x00BBGGRR）。 */
  colorRef: number;
  /** +15 保留字节（布局 5 恒 0；布局 4 是残留）。 */
  reserved15: number;
  /** +16 比例原值（u16）；布局 4 取 0xFFFF。 */
  ratioRaw: number;
  /** 比例 = ratioRaw/65535（0 保持 0）。 */
  ratio: number;
  /** +18 残留 u16（仅布局 5）。 */
  residual18: number;
  /** +20 排序值 u32；布局 4 取 0xFFF0BDC1。 */
  sortValue: number;
  /** +24 保留 u32（0 或 1）；布局 4 取 0。 */
  reserved24: number;
  /** 载荷长度：28 为布局 5，16 为布局 4。 */
  byteLength: number;
}

const LAYOUT4_STYLE: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 1],
  [1, 2, 1],
  [2, 2, 1],
];

/**
 * 解码 2000 对象头。
 * @param layout 文档布局版本（900 头第一个 u16）：≥5 按“三个 4 位字段”解样式字，否则按布局 4 枚举。
 * @returns 载荷短于 12 字节（原版：格式错误）时返回 undefined。缺失的字节按规格的缺省值（§8.1）处理。
 */
export function decodeObjectHeader(payload: Uint8Array, layout: number): ObjectHeader | undefined {
  const n = payload.length;
  if (n < 12) return undefined;
  const has = (end: number): boolean => n >= end;
  const styleWord = readU16(payload, 10);
  let style: [number, number, number];
  if (layout >= 5) {
    style = [styleWord & 15, (styleWord >> 4) & 15, (styleWord >> 8) & 15];
  } else {
    const mapped = LAYOUT4_STYLE[styleWord] ?? LAYOUT4_STYLE[1] ?? [1, 2, 1];
    style = [mapped[0], mapped[1], mapped[2]];
  }
  const r = payload[12] ?? 0;
  const g = payload[13] ?? 0;
  const b = payload[14] ?? 0;
  const ratioRaw = has(18) ? readU16(payload, 16) : 0xffff;
  return {
    constraintId: readU16(payload, 0),
    status: readU16(payload, 2),
    field04: readU16(payload, 4),
    mainKind: readU16(payload, 6),
    genera: readU16(payload, 8),
    styleWord,
    style,
    colorRef: (r | (g << 8) | (b << 16)) >>> 0,
    reserved15: payload[15] ?? 0,
    ratioRaw,
    ratio: ratioRaw === 0 ? 0 : ratioRaw / 65535,
    residual18: has(20) ? readU16(payload, 18) : 0,
    sortValue: has(24) ? readU32(payload, 20) : SORT_VALUE_UNSET,
    reserved24: has(28) ? readU32(payload, 24) : 0,
    byteLength: n,
  };
}

/** 父对象表 2002：u32 count + u32[count]，元素是同容器内的对象序号（1 起）。 */
export function decodeParents(payload: Uint8Array): number[] | undefined {
  if (payload.length < 4) return undefined;
  const count = readU32(payload, 0);
  if (payload.length !== 4 + 4 * count) return undefined;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(readU32(payload, 4 + 4 * i));
  return out;
}

/** 自由点坐标 2201（§8.6）：两个小端 double，x 在前、y 在后。 */
export interface FreePoint {
  x: number;
  y: number;
}

export const FREE_POINT_BYTES = 16;

export function decodeFreePoint(payload: Uint8Array): FreePoint | undefined {
  if (payload.length !== FREE_POINT_BYTES) return undefined;
  return { x: readF64(payload, 0), y: readF64(payload, 8) };
}

/** 标签 2005（§8.4）。 */
export interface ObjectLabel {
  /** f[0..6]，7 个 u16（f[3]、f[4] 是有符号数，这里给原始无符号值）。 */
  words: number[];
  /** +14..+21 的 8 个字节（含义未知，整体保留）。 */
  unknown8: Uint8Array;
  /** 标签文字的原始字节（不含 NUL）。 */
  raw: Uint8Array;
  /** 解码后的标签文字。 */
  text: string;
  /** 文字之后的字节（NUL + 0..1 个补齐字节）。 */
  tail: Uint8Array;
}

export function decodeLabel(payload: Uint8Array, encoding: TextEncoding): ObjectLabel | undefined {
  if (payload.length < 24) return undefined;
  const n = readU16(payload, 22);
  if (24 + n > payload.length) return undefined;
  const words: number[] = [];
  for (let i = 0; i < 7; i++) words.push(readU16(payload, i * 2));
  const raw = payload.subarray(24, 24 + n);
  return {
    words,
    unknown8: payload.subarray(14, 22),
    raw,
    text: decodeText(raw, encoding),
    tail: payload.subarray(24 + n),
  };
}

/** 样式引用 2008：本容器内 1203 的序号（0 起）。 */
export function decodeStyleRef(payload: Uint8Array): number | undefined {
  return payload.length === 2 ? readU16(payload, 0) : undefined;
}

/** 图片序号 8004：本文档 1006 组里 1300 图片的序号（0 起）。 */
export function decodeImageIndex(payload: Uint8Array): number | undefined {
  return payload.length === 2 ? readU16(payload, 0) : undefined;
}
