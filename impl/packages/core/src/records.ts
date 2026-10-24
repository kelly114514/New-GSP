/**
 * 记录层（规格 §2）：
 *
 * ```
 * file   := "GSP4" record*
 * record := u32 length | u32 kind | payload[length] | pad
 * pad    := 若 length 为奇数，则 1 个字节；原版写 00
 * ```
 *
 * 记录是 (kind, 载荷字节, 补齐字节原值)。载荷是原始字节，不解码、不规范化。
 */

import { EMPTY_BYTES, readU32 } from './bytes.ts';
import { GspFormatError } from './errors.ts';

/** 文件魔数 `GSP4`。 */
export const MAGIC = 'GSP4';
export const MAGIC_LENGTH = 4;
/** 记录头（length + kind）的字节数。 */
export const RECORD_HEADER_LENGTH = 8;

/** 一条记录。载荷可以是输入缓冲区的视图，改载荷请整体替换而不要原地写。 */
export interface GspRecord {
  kind: number;
  payload: Uint8Array;
  /**
   * 载荷长度为奇数时紧随其后的补齐字节的原值（语料恒为 0，但读到非 0 也原样保留）。
   * 长度为偶数时没有补齐字节，该字段无意义（读入时为 0，写出时忽略）。
   */
  pad: number;
}

/** 新建记录；补齐字节缺省 00。 */
export function newRecord(kind: number, payload: Uint8Array = EMPTY_BYTES, pad = 0): GspRecord {
  return { kind, payload, pad };
}

/** 记录在文件里占的字节数：8 + 载荷 + 补齐。 */
export function recordByteLength(record: GspRecord): number {
  const n = record.payload.length;
  return RECORD_HEADER_LENGTH + n + (n & 1);
}

/** 文件是否以魔数 `GSP4` 开头。 */
export function hasMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= MAGIC_LENGTH &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x53 &&
    bytes[2] === 0x50 &&
    bytes[3] === 0x34
  );
}

/**
 * 读出 pos 处的一条记录。载荷是 bytes 的视图（不复制）。
 * 下一条记录的位置 = pos + recordByteLength(返回值)。
 *
 * @throws GspFormatError 记录头不完整、长度越界、补齐字节缺失
 */
export function readRecordAt(bytes: Uint8Array, pos: number): GspRecord {
  const total = bytes.length;
  if (pos + RECORD_HEADER_LENGTH > total) {
    throw new GspFormatError(
      'truncated',
      pos,
      `record header needs ${RECORD_HEADER_LENGTH} bytes but only ${total - pos} remain`,
    );
  }
  const length = readU32(bytes, pos);
  const kind = readU32(bytes, pos + 4);
  const payloadStart = pos + RECORD_HEADER_LENGTH;
  const payloadEnd = payloadStart + length;
  if (payloadEnd > total) {
    throw new GspFormatError(
      'length-out-of-bounds',
      pos,
      `record kind ${kind} declares a payload of ${length} bytes but only ${total - payloadStart} remain (file truncated or length field corrupt)`,
    );
  }
  let pad = 0;
  if ((length & 1) === 1) {
    if (payloadEnd >= total) {
      throw new GspFormatError(
        'truncated',
        payloadEnd,
        `record kind ${kind} (odd payload length ${length}) is missing its pad byte`,
      );
    }
    pad = bytes[payloadEnd] ?? 0;
  }
  return { kind, payload: bytes.subarray(payloadStart, payloadEnd), pad };
}

/** `splitRecords` 的结果。 */
export interface SplitRecords {
  records: GspRecord[];
  /** 与 records 一一对应的文件偏移。 */
  offsets: number[];
}

/**
 * 记录层切分：魔数之后到文件末尾，切成记录序列。不检查嵌套，不认识的 kind 照收。
 * 载荷是输入缓冲区的视图。
 *
 * @throws GspFormatError 魔数不对、截断、长度越界
 */
export function splitRecords(bytes: Uint8Array): SplitRecords {
  if (!hasMagic(bytes)) {
    throw new GspFormatError('bad-magic', 0, 'file does not start with the "GSP4" magic');
  }
  const records: GspRecord[] = [];
  const offsets: number[] = [];
  let pos = MAGIC_LENGTH;
  while (pos < bytes.length) {
    const record = readRecordAt(bytes, pos);
    records.push(record);
    offsets.push(pos);
    pos += recordByteLength(record);
  }
  return { records, offsets };
}
