/** 统计样例里按钮（大类 10/类型 23）的 (A,B) 动作码、父对象个数、2003/2310 长度，找出还没支持的取值。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';
function* walk(d: string): Generator<string> { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) yield* walk(p); else if (n.endsWith('.gsp')) yield p; } }
const stat = new Map<string, { n: number; files: Set<string>; ex: string }>();
for (const f of walk(process.argv[2] ?? '../sketchpad5')) {
  try {
    const rd = readRecords(new Uint8Array(readFileSync(f)));
    let cur: { m: number; np: number; d2310?: Uint8Array; d2003?: Uint8Array } | undefined;
    for (const r of rd.records) {
      const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      if (r.tag === 2000) { cur = r.data.length >= 10 && v.getUint16(6, true) === 10 && v.getUint16(8, true) === 23 ? { m: v.getUint16(0, true), np: 0 } : undefined; }
      else if (cur && r.tag === 2002) cur.np = v.getUint32(0, true);
      else if (cur && r.tag === 2310) cur.d2310 = r.data;
      else if (cur && r.tag === 2003) cur.d2003 = r.data;
      else if (cur && r.tag === 2007) {
        const d = cur.d2310; if (d && d.length >= 16) {
          const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
          const k = `m${cur.m} A${dv.getUint16(12, true)} B${dv.getUint16(14, true)} len${d.length} np${Math.min(cur.np, 3)}${cur.d2003 ? ' d2003:' + cur.d2003.length : ''}`;
          const s = stat.get(k) ?? { n: 0, files: new Set(), ex: f }; s.n++; s.files.add(f); stat.set(k, s);
        }
        cur = undefined;
      }
    }
  } catch { /* ignore */ }
}
for (const [k, s] of [...stat.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(k.padEnd(40), s.n, s.files.size);
