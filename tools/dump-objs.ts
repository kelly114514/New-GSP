/** 逐对象列出方法/大类/类型、父对象和除标签外的数据记录（前 N 字节）。用法：dump-objs 文件 [字节数] */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';
let i = 0, line: string[] = [];
const flush = () => { if (line.length) console.log(line.join('\n    ')); line = []; };
for (const r of readRecords(new Uint8Array(readFileSync(process.argv[2]))).records) {
  const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  if (r.tag === 2000) { flush(); i++; line.push(`#${i} m${v.getUint16(0, true)}/c${v.getUint16(6, true)}/k${v.getUint16(8, true)} hdr=${Buffer.from(r.data).toString('hex')}`); }
  else if (r.tag === 2002) line.push('parents ' + Array.from({ length: v.getUint32(0, true) }, (_, k) => v.getUint32(4 + 4 * k, true)).join(','));
  else if (r.tag > 2002 && r.tag < 2400 && r.tag !== 2007) line.push(`${r.tag} ${r.data.length} ${Buffer.from(r.data.subarray(0, Number(process.argv[3] ?? 64))).toString('hex')}`);
}
flush();
