/**
 * 文本解码（规格 §6）。
 *
 * - 布局 5：UTF-8；布局 4：Windows ANSI，语料里是 GBK（有一个文件是 Big5，所以允许改选）。
 * - 解码永远不抛异常：坏字节变成 U+FFFD；调用方应同时保留原始字节（本库的“视图”都这么做）。
 *
 * core 不引入 DOM 库，而 `TextDecoder` 在 Node 24（带完整 ICU）和 WebView2 里都有。
 * 为了让 core 在三种类型环境（纯 ES2023 / 带 DOM / 带 @types/node）下都能通过类型检查而不产生
 * 全局声明冲突，这里不声明全局 `TextDecoder`，而是用一个只描述所需成员的局部结构类型，
 * 通过 `globalThis` 取用。
 */

export type TextEncoding = 'utf-8' | 'gbk' | 'big5';

interface TextDecoderLike {
  decode(input: Uint8Array): string;
}
interface TextDecoderCtorLike {
  new (label: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoderLike;
}
interface TextEncoderLike {
  encode(input: string): Uint8Array;
}
interface TextEncoderCtorLike {
  new (): TextEncoderLike;
}

interface TextGlobals {
  TextDecoder?: TextDecoderCtorLike;
  TextEncoder?: TextEncoderCtorLike;
}

const decoders = new Map<TextEncoding, TextDecoderLike | null>();

function getDecoder(encoding: TextEncoding): TextDecoderLike | null {
  const cached = decoders.get(encoding);
  if (cached !== undefined) return cached;
  let made: TextDecoderLike | null = null;
  const Ctor = (globalThis as unknown as TextGlobals).TextDecoder;
  if (Ctor !== undefined) {
    try {
      // ignoreBOM: true 让开头的 EF BB BF 保留为 U+FEFF，而不是被悄悄吃掉。
      made = new Ctor(encoding, { fatal: false, ignoreBOM: true });
    } catch {
      made = null; // 运行环境不认识这个编码标签
    }
  }
  decoders.set(encoding, made);
  return made;
}

/** 当前运行环境能否解这种编码（Node 缺 ICU 时 gbk/big5 可能不行）。 */
export function isEncodingSupported(encoding: TextEncoding): boolean {
  return getDecoder(encoding) !== null;
}

/**
 * 把字节解成字符串。不抛异常：坏字节得到 U+FFFD；
 * 运行环境不支持该编码时退化为逐字节映射（Latin-1），保证总有结果。
 */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  const decoder = getDecoder(encoding);
  if (decoder !== null) return decoder.decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

/** 字符串转 UTF-8 字节。 */
export function encodeUtf8(text: string): Uint8Array {
  const Ctor = (globalThis as unknown as TextGlobals).TextEncoder;
  if (Ctor === undefined) throw new Error('TextEncoder is not available in this environment');
  return new Ctor().encode(text);
}

/**
 * 全文件的文本编码（§6.1）：布局 ≥5 一律 UTF-8；布局 4 默认 GBK，可改选 Big5。
 * @param layout 900 头第一个 u16
 * @param ansi 布局 4 文件使用的 ANSI 代码页
 */
export function textEncodingForLayout(layout: number, ansi: 'gbk' | 'big5' = 'gbk'): TextEncoding {
  return layout >= 5 ? 'utf-8' : ansi;
}

/** 原始字节加解码后的文本。 */
export interface DecodedText {
  /** 原始字节（不含 NUL 和残留）。 */
  raw: Uint8Array;
  text: string;
}

export function decodeTextWithRaw(raw: Uint8Array, encoding: TextEncoding): DecodedText {
  return { raw, text: decodeText(raw, encoding) };
}
