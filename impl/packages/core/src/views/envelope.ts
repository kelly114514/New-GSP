/**
 * 902 兼容信封的载荷（规格 §5.2、§5.5）。
 *
 * ```
 * u16 h[8]                 ; 16 字节头
 * string[3]                ; 三个提示串，紧接头部
 * string := u16 L | L 字节 | 00 | (若 2+L+1 为奇数) 1 个补齐字节
 * ```
 *
 * 串末补齐字节是原版写出时的残留，值不定，必须原样保留（`pad`）。
 * 提示串写错会让原版崩溃（§5.5），所以读取器在建树时就用 `parseEnvelopePayload` 拒绝不合规的信封。
 */

import { concatBytes, readU16, writeU16 } from '../bytes.ts';
import { decodeText, encodeUtf8 } from '../text.ts';
import type { TextEncoding } from '../text.ts';

export const ENVELOPE_HEADER_LENGTH = 16;
export const ENVELOPE_HEADER_WORDS = 8;
export const ENVELOPE_STRING_COUNT = 3;

/** 内容类型（h[0]）：1=页，2=工具区，5=附加信息组；其余见 §5.4/§5.8。 */
export const ENVELOPE_TYPE_PAGE = 1;
export const ENVELOPE_TYPE_TOOL = 2;
export const ENVELOPE_TYPE_GROUP = 5;

export interface EnvelopeString {
  /** NUL 之前的字节（长度即 u16 L）。是输入的视图。 */
  raw: Uint8Array;
  /** NUL 之后的补齐字节的原值；不需要补齐（2+L+1 为偶数）时为 null。 */
  pad: number | null;
}

export interface EnvelopeInfo {
  /** h[0..7]，8 个 u16。 */
  header: number[];
  /** 三个提示串：0=类型不认识，1=版本过新，2=部分可读（§5.3）。 */
  strings: EnvelopeString[];
}

export type EnvelopeParse =
  | { ok: true; info: EnvelopeInfo }
  | { ok: false; /** 出错位置，载荷内偏移 */ at: number; reason: string };

/**
 * 按 §5.2 严格解析信封载荷。要求：
 * 头 16 字节；恰好三个串；每个串的 L 与 NUL 位置一致且串内无 NUL；
 * 每个串占 (L+4)&~1 字节（补齐字节要给足）；三个串之后载荷恰好用完。
 * 这同时排除了 §5.5 的崩溃条件（后继串起点越过载荷末尾）。
 */
export function parseEnvelopePayload(payload: Uint8Array): EnvelopeParse {
  const total = payload.length;
  if (total < ENVELOPE_HEADER_LENGTH) {
    return {
      ok: false,
      at: 0,
      reason: `envelope payload is ${total} bytes, shorter than the ${ENVELOPE_HEADER_LENGTH}-byte header`,
    };
  }
  const header: number[] = [];
  for (let i = 0; i < ENVELOPE_HEADER_WORDS; i++) header.push(readU16(payload, i * 2));

  const strings: EnvelopeString[] = [];
  let pos = ENVELOPE_HEADER_LENGTH;
  for (let i = 0; i < ENVELOPE_STRING_COUNT; i++) {
    if (pos + 2 > total) {
      return {
        ok: false,
        at: pos,
        reason: `envelope string ${i} has no length prefix: payload ends at byte ${total} (next-string start ${pos} is not before the payload end)`,
      };
    }
    const length = readU16(payload, pos);
    const textStart = pos + 2;
    const textEnd = textStart + length;
    if (textEnd >= total) {
      return {
        ok: false,
        at: pos,
        reason: `envelope string ${i} declares ${length} bytes plus NUL but the payload ends at byte ${total}`,
      };
    }
    for (let j = textStart; j < textEnd; j++) {
      if (payload[j] === 0) {
        return {
          ok: false,
          at: j,
          reason: `envelope string ${i} declares length ${length} but contains a NUL after ${j - textStart} bytes`,
        };
      }
    }
    if (payload[textEnd] !== 0) {
      return {
        ok: false,
        at: textEnd,
        reason: `envelope string ${i} declares length ${length} but the byte after it is not NUL`,
      };
    }
    const needsPad = ((2 + length + 1) & 1) === 1;
    const next = textEnd + 1 + (needsPad ? 1 : 0);
    if (next > total) {
      return {
        ok: false,
        at: textEnd + 1,
        reason: `envelope string ${i} is missing its pad byte: the next string would start at byte ${next} beyond the payload end ${total}`,
      };
    }
    strings.push({
      raw: payload.subarray(textStart, textEnd),
      pad: needsPad ? (payload[textEnd + 1] ?? 0) : null,
    });
    pos = next;
  }
  if (pos !== total) {
    return {
      ok: false,
      at: pos,
      reason: `envelope payload has ${total - pos} unexpected bytes after the third string`,
    };
  }
  return { ok: true, info: { header, strings } };
}

/** 解码信封载荷；结构不合规返回 undefined。 */
export function decodeEnvelope(payload: Uint8Array): EnvelopeInfo | undefined {
  const parsed = parseEnvelopePayload(payload);
  return parsed.ok ? parsed.info : undefined;
}

/** 信封内容类型的名字（h[0]）。 */
export function envelopeContentName(type: number): string {
  switch (type) {
    case 0:
      return 'type0';
    case ENVELOPE_TYPE_PAGE:
      return 'page';
    case ENVELOPE_TYPE_TOOL:
      return 'tool';
    case 3:
      return 'blob';
    case 4:
      return 'type4';
    case ENVELOPE_TYPE_GROUP:
      return 'group';
    default:
      return `type${type}`;
  }
}

/** 三个提示串解码后的文本。 */
export function envelopeStringTexts(info: EnvelopeInfo, encoding: TextEncoding): string[] {
  return info.strings.map((s) => decodeText(s.raw, encoding));
}

/** 构造信封串的输入：字符串（按 UTF-8 编码、补齐字节 00）、原始字节，或原始字节加指定补齐字节。 */
export type EnvelopeStringInput = string | Uint8Array | { raw: Uint8Array; pad: number };

/**
 * 构造信封载荷（写新文件、写测试用）。每个串后补齐字节缺省 00。
 * 不检查串长是否超过 255 个 UTF-16 码元（见 validate.ts）。
 */
export function buildEnvelopePayload(
  header: readonly number[],
  strings: readonly EnvelopeStringInput[],
): Uint8Array {
  const head = new Uint8Array(ENVELOPE_HEADER_LENGTH);
  for (let i = 0; i < ENVELOPE_HEADER_WORDS; i++) writeU16(head, i * 2, header[i] ?? 0);
  const parts: Uint8Array[] = [head];
  for (const input of strings) {
    let raw: Uint8Array;
    let pad = 0;
    if (typeof input === 'string') {
      raw = encodeUtf8(input);
    } else if (input instanceof Uint8Array) {
      raw = input;
    } else {
      raw = input.raw;
      pad = input.pad;
    }
    const needsPad = ((2 + raw.length + 1) & 1) === 1;
    const part = new Uint8Array(2 + raw.length + 1 + (needsPad ? 1 : 0));
    writeU16(part, 0, raw.length);
    part.set(raw, 2);
    if (needsPad) part[part.length - 1] = pad & 0xff;
    parts.push(part);
  }
  return concatBytes(parts);
}
