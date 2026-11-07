import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';
const rd = readRecords(new Uint8Array(readFileSync(process.argv[2])));
for (const r of rd.records) {
  if (r.tag >= 2400 && r.tag < 2420 || (r.tag >= 10000)) continue;
  console.log(r.tag, r.data.length, Buffer.from(r.data.subarray(0, Number(process.argv[3] ?? 48))).toString('hex'));
}
