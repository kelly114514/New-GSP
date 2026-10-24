/**
 * 文档头 900（规格 §4）：固定 28 字节 = 14 个 u16。
 * 字段含义里标〔未知〕〔推测〕的只给原始值；整头逐字节保留，setDocHeaderWord 只改指定的 2 个字节。
 */

import { readU16, writeU16 } from '../bytes.ts';
import type { GspDocument } from '../tree.ts';

export const DOC_HEADER_WORDS = 14;

export interface DocHeader {
  /** 14 个 u16 原值。 */
  words: number[];
  /** [0] 布局版本：5 或 4（对象头长度 28 / 16 字节）。 */
  layout: number;
  /** [1] 页数（= 1000 的个数）。 */
  pageCount: number;
  /** [2] 自定义工具区数（= 1002 的个数）。 */
  toolCount: number;
  /** [3] 类型 3 信封（1004/1005 块）个数，语料恒 0。 */
  type3Count: number;
  /** [4] 类型 4 成员数，语料恒 0。 */
  type4Count: number;
  /** [5] 保留，恒 0。 */
  reserved5: number;
  /** [6] 文档标志（含义未知）。 */
  flags: number;
  /** [7] 最低读取版本，恒 4。 */
  minReadVersion: number;
  /** [8] 活动页序号，0 起。 */
  activePage: number;
  /** [9] 窗口宽（推测）。 */
  windowWidth: number;
  /** [10] 窗口高（推测）。 */
  windowHeight: number;
  /** [11] 文本编码 ID：布局 5 为 9（UTF-8），布局 4 为 3（ANSI）。 */
  textEncodingId: number;
  /** [12] 信封总数（布局 5 = 902 的个数；布局 4 为 0）。 */
  envelopeCount: number;
  /** [13] 保留，恒 0。 */
  reserved13: number;
}

/** 解码 900 载荷；长度不是 28 字节返回 undefined。 */
export function decodeDocHeader(payload: Uint8Array): DocHeader | undefined {
  if (payload.length !== DOC_HEADER_WORDS * 2) return undefined;
  const w: number[] = [];
  for (let i = 0; i < DOC_HEADER_WORDS; i++) w.push(readU16(payload, i * 2));
  const at = (i: number): number => w[i] ?? 0;
  return {
    words: w,
    layout: at(0),
    pageCount: at(1),
    toolCount: at(2),
    type3Count: at(3),
    type4Count: at(4),
    reserved5: at(5),
    flags: at(6),
    minReadVersion: at(7),
    activePage: at(8),
    windowWidth: at(9),
    windowHeight: at(10),
    textEncodingId: at(11),
    envelopeCount: at(12),
    reserved13: at(13),
  };
}

/** 文档的布局版本（900 头第一个 u16）。 */
export function docLayout(doc: GspDocument): number {
  return readU16(doc.header.payload, 0);
}

/** 解码文档的 900 头。 */
export function docHeaderOf(doc: GspDocument): DocHeader {
  const h = decodeDocHeader(doc.header.payload);
  if (h === undefined) throw new Error('document header (900) is not 28 bytes');
  return h;
}

/** 改 900 头的第 index 个 u16（0..13）；整个载荷换成新数组，只有这 2 个字节变。 */
export function setDocHeaderWord(doc: GspDocument, index: number, value: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= DOC_HEADER_WORDS) {
    throw new RangeError(`document header word index ${index} is out of range 0..${DOC_HEADER_WORDS - 1}`);
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`document header word value ${value} is not a u16`);
  }
  const copy = new Uint8Array(doc.header.payload);
  writeU16(copy, index * 2, value);
  doc.header.payload = copy;
}
