/**
 * NUL 结尾字符串（规格 §6.2）：1100 页名/工具名、9004 构建串、9007 工具说明，以及 1201 字体名。
 * 字节 + `00` + 0..n 个残留字节（值不定，必须保留）。
 */

import { decodeText } from '../text.ts';
import type { TextEncoding } from '../text.ts';

export interface NulString {
  /** 第一个 NUL 之前的字节（没有 NUL 时是 offset 起的全部字节）。 */
  raw: Uint8Array;
  /** 从第一个 NUL 起到载荷末尾的字节（NUL 本身 + 残留）。没有 NUL 时为空。 */
  tail: Uint8Array;
  /** 是否找到 NUL。 */
  terminated: boolean;
}

/** 在 payload 的 offset 处读一个 NUL 结尾串。永不抛异常。 */
export function readNulString(payload: Uint8Array, offset = 0): NulString {
  let end = offset;
  while (end < payload.length && payload[end] !== 0) end++;
  const terminated = end < payload.length;
  return {
    raw: payload.subarray(offset, end),
    tail: terminated ? payload.subarray(end) : payload.subarray(payload.length),
    terminated,
  };
}

export interface DecodedNulString extends NulString {
  text: string;
}

export function decodeNulString(
  payload: Uint8Array,
  encoding: TextEncoding,
  offset = 0,
): DecodedNulString {
  const s = readNulString(payload, offset);
  return { ...s, text: decodeText(s.raw, encoding) };
}
