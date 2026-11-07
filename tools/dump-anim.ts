import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';
let cur: string[] = [];
for (const r of readRecords(new Uint8Array(readFileSync(process.argv[2]))).records) {
  const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  if (r.tag === 2000) cur = [`m${v.getUint16(0, true)}/c${v.getUint16(6, true)}/k${v.getUint16(8, true)} hdr=${Buffer.from(r.data).toString('hex')}`];
  else if (r.tag >= 2001 && r.tag < 2400 && r.tag !== 2007 && cur.length) cur.push(`${r.tag}=${Buffer.from(r.data).toString('hex')}`);
  else if (r.tag === 2007 && cur[0].includes('c10')) console.log(cur.join('\n  ') + '\n');
}
