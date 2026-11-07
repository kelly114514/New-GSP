/** 某类对象（大类/类型/方法）的父对象类型分布，且只统计新版还不理解的（decodeGsp 读成 unknown）。用法：survey-parents 大类 类型 方法 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';
import { decodeGsp } from '../src/gsp/codec';
function* walk(d: string): Generator<string> { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) yield* walk(p); else if (n.endsWith('.gsp')) yield p; } }
const [cat, kind, method] = process.argv.slice(2).map(Number);
const stat = new Map<string, number>();
for (const f of walk('../sketchpad5')) {
  try {
    const bytes = new Uint8Array(readFileSync(f));
    const rd = readRecords(bytes), objs: { m: number; cat: number; kind: number; parents: number[]; d3?: Uint8Array }[] = [];
    let cur: (typeof objs)[number] | undefined;
    for (const r of rd.records) {
      const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      if (r.tag === 2000) { cur = { m: v.getUint16(0, true), cat: v.getUint16(6, true), kind: v.getUint16(8, true), parents: [] }; objs.push(cur); }
      else if (cur && r.tag === 2002) cur.parents = Array.from({ length: v.getUint32(0, true) }, (_, k) => v.getUint32(4 + 4 * k, true));
      else if (cur && r.tag === 2003) cur.d3 = r.data;
      else if (r.tag === 1000) objs.length = 0;
    }
    for (const o of objs) {
      if (o.cat !== cat || o.kind !== kind || o.m !== method) continue;
      const pk = o.parents.map(p => { const q = objs[p - 1]; return q ? `m${q.m}/c${q.cat}/k${q.kind}` : '?'; }).join(' ');
      const d3 = o.d3 ? `d3:${o.d3.length}:${Buffer.from(o.d3.subarray(0, 4)).toString('hex')}` : '';
      const k = `${pk} ${d3}`; stat.set(k, (stat.get(k) ?? 0) + 1);
    }
  } catch { /* ignore */ }
}
void decodeGsp;
for (const [k, n] of [...stat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(n).padStart(6), k);
