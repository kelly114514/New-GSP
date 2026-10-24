/**
 * 写出器：无损树 → 字节。
 *
 * 只用树里的东西：每条记录的 kind、载荷字节和补齐字节原值。长度字段由载荷长度重算，
 * 奇数长度后补 1 个补齐字节（读入的记录写回原值，新建记录写 00）。
 * 不缓存、不重算任何派生字段（页数、对象数……）：改了结构要自己改对应的计数字段，见 validate.ts。
 */

import { writeU32 } from './bytes.ts';
import { MAGIC_LENGTH, RECORD_HEADER_LENGTH, recordByteLength } from './records.ts';
import { forEachRecord } from './tree.ts';
import type { GspDocument } from './tree.ts';

/** 写出后的文件字节数。 */
export function gspByteLength(doc: GspDocument): number {
  let total = MAGIC_LENGTH;
  forEachRecord(doc, (r) => {
    total += recordByteLength(r);
  });
  return total + doc.trailing.length;
}

/** 序列化文档。对未修改的文档，结果与读入的字节完全相同。 */
export function writeGsp(doc: GspDocument): Uint8Array {
  const out = new Uint8Array(gspByteLength(doc));
  out[0] = 0x47; // G
  out[1] = 0x53; // S
  out[2] = 0x50; // P
  out[3] = 0x34; // 4
  let pos = MAGIC_LENGTH;
  forEachRecord(doc, (r) => {
    const n = r.payload.length;
    writeU32(out, pos, n);
    writeU32(out, pos + 4, r.kind);
    out.set(r.payload, pos + RECORD_HEADER_LENGTH);
    if ((n & 1) === 1) out[pos + RECORD_HEADER_LENGTH + n] = r.pad & 0xff;
    pos += RECORD_HEADER_LENGTH + n + (n & 1);
  });
  out.set(doc.trailing, pos);
  return out;
}
