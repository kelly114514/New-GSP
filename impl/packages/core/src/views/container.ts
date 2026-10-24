/**
 * 页 / 工具区里的记录视图（规格 §7）：页头、字体 1201、文本样式 1203、标签计数器、
 * 以及几种简单的整数记录。全部是只读视图，解码不了的形状返回 undefined。
 */

import { readI16, readU16, readU32 } from '../bytes.ts';
import { readNulString } from './strings.ts';
import type { NulString } from './strings.ts';

export const CONTAINER_HEADER_BYTES = 36;

export interface ContainerHeader {
  /** 18 个 u16 原值。 */
  words: number[];
  /** +4 i16：视图水平偏移（推测，仅页）。 */
  viewX: number;
  /** +6 i16：视图垂直偏移（推测，仅页）。 */
  viewY: number;
  /** +8 u16：页标识（仅页；文件内互不相同）。 */
  pageId: number;
  /** +10 u16：未知。 */
  word10: number;
  /** +16 u16：未知。 */
  word16: number;
  /** +18 u16：未知。 */
  word18: number;
  /** +24 u32：本容器内 2000 的个数。 */
  objectCount: number;
}

/** 解码 1000 / 1002 的 36 字节头（§7.1）；长度不对返回 undefined。 */
export function decodeContainerHeader(payload: Uint8Array): ContainerHeader | undefined {
  if (payload.length !== CONTAINER_HEADER_BYTES) return undefined;
  const words: number[] = [];
  for (let i = 0; i < CONTAINER_HEADER_BYTES / 2; i++) words.push(readU16(payload, i * 2));
  return {
    words,
    viewX: readI16(payload, 4),
    viewY: readI16(payload, 6),
    pageId: readU16(payload, 8),
    word10: readU16(payload, 10),
    word16: readU16(payload, 16),
    word18: readU16(payload, 18),
    objectCount: readU32(payload, 24),
  };
}

/** 字体条目 1201（§7.4）：u16 属性字 + NUL 结尾字体名 + 残留。 */
export interface FontEntry {
  attributes: number;
  name: NulString;
}

export function decodeFontEntry(payload: Uint8Array): FontEntry | undefined {
  if (payload.length < 2) return undefined;
  return { attributes: readU16(payload, 0), name: readNulString(payload, 2) };
}

/** 文本样式条目 1203（§7.4）：10 个 u16。 */
export interface TextStyleEntry {
  words: number[];
  /** [0] 字体序号：本容器内 1201 的序号（0 起）。 */
  fontIndex: number;
  /** [1] 字号（点，推测）。 */
  size: number;
}

export function decodeTextStyleEntry(payload: Uint8Array): TextStyleEntry | undefined {
  if (payload.length !== 20) return undefined;
  const words: number[] = [];
  for (let i = 0; i < 10; i++) words.push(readU16(payload, i * 2));
  return { words, fontIndex: words[0] ?? 0, size: words[1] ?? 0 };
}

/** 标签计数器 2399–2419（§7.5）：u16 a | u16 b | u16 0。 */
export interface LabelCounter {
  a: number;
  b: number;
  third: number;
}

export function decodeLabelCounter(payload: Uint8Array): LabelCounter | undefined {
  if (payload.length !== 6) return undefined;
  return { a: readU16(payload, 0), b: readU16(payload, 2), third: readU16(payload, 4) };
}

/** 单个 u16 的记录（10002–10008、10021–10023、10041、10042、2008、8004 …）。 */
export function decodeU16Value(payload: Uint8Array): number | undefined {
  return payload.length === 2 ? readU16(payload, 0) : undefined;
}

/** 单个 u32 的记录（9005、9008）。 */
export function decodeU32Value(payload: Uint8Array): number | undefined {
  return payload.length === 4 ? readU32(payload, 0) : undefined;
}

/** u32 数组记录（9000）；长度不是 4 的倍数返回 undefined。 */
export function decodeU32Array(payload: Uint8Array): number[] | undefined {
  if (payload.length % 4 !== 0) return undefined;
  const out: number[] = [];
  for (let i = 0; i < payload.length; i += 4) out.push(readU32(payload, i));
  return out;
}

/** 工具已知对象表 1204（§7.9）：u32 个数 + u32[个数]。 */
export function decodeToolGivenObjects(payload: Uint8Array): number[] | undefined {
  if (payload.length < 4) return undefined;
  const n = readU32(payload, 0);
  if (payload.length !== 4 + 4 * n) return undefined;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(readU32(payload, 4 + 4 * i));
  return out;
}

/** 调色板条目 10020（§7.7）：u16 序号 + R,G,B + 残留。 */
export interface PaletteEntry {
  index: number;
  r: number;
  g: number;
  b: number;
}

export function decodePaletteEntry(payload: Uint8Array): PaletteEntry | undefined {
  if (payload.length < 5) return undefined;
  return {
    index: readU16(payload, 0),
    r: payload[2] ?? 0,
    g: payload[3] ?? 0,
    b: payload[4] ?? 0,
  };
}
