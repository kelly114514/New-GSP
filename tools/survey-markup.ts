import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';
function* walk(d: string): Generator<string> { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) yield* walk(p); else if (n.endsWith('.gsp')) yield p; } }
const tags = new Map<string, { n: number; ex: string }>();
for (const f of walk('../sketchpad5')) {
  try {
    for (const r of readRecords(new Uint8Array(readFileSync(f))).records) {
      if (r.tag !== 2300 || r.data.length < 20) continue;
      const v = new DataView(r.data.buffer, r.data.byteOffset);
      const n = v.getUint16(16, true), m = new TextDecoder().decode(r.data.subarray(18, 18 + n));
      for (const t of m.matchAll(/<(\W?[A-Z!]*)(\d*)([^<>]{0,12})/g)) { const k = t[1]; const e = tags.get(k) ?? { n: 0, ex: m.slice(0, 120) }; e.n++; tags.set(k, e); }
    }
  } catch { /* ignore */ }
}
for (const [k, e] of [...tags.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) console.log(k.padEnd(8), e.n, e.ex.replace(/\n/g, ' '));
