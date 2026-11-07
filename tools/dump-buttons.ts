import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';
let cur: string[] = [];
for (const r of readRecords(new Uint8Array(readFileSync(process.argv[2]))).records) {
  const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  if (r.tag === 2000) cur = [`m${v.getUint16(0, true)}/c${v.getUint16(6, true)}/k${v.getUint16(8, true)}`];
  else if (r.tag === 2002) cur.push('p' + v.getUint32(0, true));
  else if (r.tag === 2003) cur.push('d2003=' + Buffer.from(r.data).toString('hex'));
  else if (r.tag === 2310) cur.push('2310=' + Buffer.from(r.data).toString('hex'));
  else if (r.tag === 2007 && cur[0].includes('c10')) console.log(cur.join(' '));
}
