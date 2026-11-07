/** 找出某 (大类,类型,方法) 的对象样例：父对象类型、记录标签与前 N 字节。用法：survey-kind 大类 类型 [方法] [个数] */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';
function* walk(d: string): Generator<string> { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) yield* walk(p); else if (n.endsWith('.gsp')) yield p; } }
const [cat, kind] = [Number(process.argv[2]), Number(process.argv[3])], method = process.argv[4] ? Number(process.argv[4]) : undefined, want = Number(process.argv[5] ?? 6);
let shown = 0; const tagCounts = new Map<string, number>();
outer: for (const f of walk('../sketchpad5')) {
  try {
    const rd = readRecords(new Uint8Array(readFileSync(f)));
    const objs: { m: number; cat: number; kind: number; recs: { tag: number; data: Uint8Array }[] }[] = [];
    let cur: (typeof objs)[number] | undefined;
    for (const r of rd.records) {
      const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      if (r.tag === 2000) { cur = { m: v.getUint16(0, true), cat: v.getUint16(6, true), kind: v.getUint16(8, true), recs: [] }; objs.push(cur); }
      else if (cur && r.tag > 2000 && r.tag < 2400 && r.tag !== 2007) cur.recs.push(r);
    }
    objs.forEach((o, i) => {
      if (o.cat !== cat || o.kind !== kind || (method !== undefined && o.m !== method)) return;
      const key = o.recs.map(r => r.tag).join(','); tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      if (shown >= want) return;
      shown++;
      const par = o.recs.find(r => r.tag === 2002); const pv = par ? new DataView(par.data.buffer, par.data.byteOffset, par.data.byteLength) : undefined;
      const ps = pv ? Array.from({ length: pv.getUint32(0, true) }, (_, k) => pv.getUint32(4 + 4 * k, true)) : [];
      console.log(`${f.split('sketchpad5')[1].slice(-40)} #${i + 1} m${o.m} parents=${ps.map(p => `${p}:${objs[p - 1] ? `m${objs[p - 1].m}/c${objs[p - 1].cat}/k${objs[p - 1].kind}` : '?'}`).join(' ')}`);
      for (const r of o.recs) if (r.tag !== 2002) console.log('    ', r.tag, r.data.length, Buffer.from(r.data.subarray(0, 64)).toString('hex'));
    });
  } catch { /* ignore */ }
  if (shown >= want && tagCounts.size > 12) break outer;
}
console.log([...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
