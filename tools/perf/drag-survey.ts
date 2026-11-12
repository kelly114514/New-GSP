/** 整库拖动调查：对每个样例的每一页，模拟拖动依赖最多的自由点，记录重算耗时和结果指纹。
 * 用途一：找最慢的课件。用途二：优化前后比对指纹，证明求值结果逐位不变。
 * npx tsx tools/perf/drag-survey.ts <输出.json> [目录=../sketchpad5] [--limit N] [--shard i/n] */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Store } from '../../src/core/store';
import { descendants } from '../../src/core/model';
import { decodeFile } from '../../src/gsp/codec';

const argv = process.argv.slice(2);
const li = argv.indexOf('--limit'); const limit = li >= 0 ? Number(argv.splice(li, 2)[1]) : Infinity;
const si = argv.indexOf('--shard'); const [shard, shards] = si >= 0 ? argv.splice(si, 2)[1].split('/').map(Number) : [0, 1];
const out = argv[0], root = argv[1] ?? '../sketchpad5';
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) yield* walk(f); else if (/\.gsp$/i.test(n)) yield f; }
}
const fingerprint = (st: Store) => {
  const h = createHash('sha1');
  for (const o of st.page.objects) h.update(`${o.id}:${JSON.stringify(st.results.get(o.id) ?? null, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v))}\n`);
  return h.digest('hex').slice(0, 16);
};
const rows: unknown[] = []; let n = 0;
for (const f of walk(root)) {
  if (n++ >= limit) break;
  if ((n - 1) % shards !== shard) continue;
  try {
    const st = new Store(decodeFile(new Uint8Array(readFileSync(f)), f).doc);
    st.protectedReason = undefined;
    st.doc.pages.forEach((p, i) => {
      if (!p.objects.length) return;
      const t0 = performance.now(); st.doc.current = i; st.recompute(); const full = performance.now() - t0;
      const before = fingerprint(st);
      let best: number | undefined, most = -1;
      const frees = p.objects.filter(o => o.def.k === 'free');
      // 只查前 60 个自由点，避免调查本身变成 O(n²)
      for (const o of frees.slice(0, 60)) { const c = descendants(p, [o.id]).size; if (c > most) { most = c; best = o.id; } }
      const row: Record<string, unknown> = { file: relative(root, f), page: i, objects: p.objects.length, full: +full.toFixed(2), before };
      if (best !== undefined) {
        const o = p.objects.find(x => x.id === best)!; if (o.def.k !== 'free') return;
        const { x, y } = o.def, times: number[] = [];
        for (let k = 1; k <= 3; k++) { const t = performance.now(); st.moveFree(best, x + 7 * k, y + 5 * k, false); st.recompute([best]); times.push(performance.now() - t); }
        Object.assign(row, { dragged: best, descendants: most, drag: +Math.min(...times).toFixed(2), after: fingerprint(st) });
        st.moveFree(best, x, y);
      }
      rows.push(row);
    });
  } catch (e) { rows.push({ file: relative(root, f), error: String((e as Error).message).slice(0, 120) }); }
  if (n % 100 === 0) { console.error(n, f); writeFileSync(out, JSON.stringify(rows)); }
  else if (rows.length % 20 === 0) writeFileSync(out, JSON.stringify(rows));
}
writeFileSync(out, JSON.stringify(rows));
const dragged = rows.filter((r: any) => r.drag !== undefined) as any[];
dragged.sort((a, b) => b.drag - a.drag);
console.log(`页 ${rows.length}，可拖 ${dragged.length}；>6ms ${dragged.filter(r => r.drag > 6).length}，>16ms ${dragged.filter(r => r.drag > 16).length}，>33ms ${dragged.filter(r => r.drag > 33).length}，>100ms ${dragged.filter(r => r.drag > 100).length}`);
for (const r of dragged.slice(0, 15)) console.log(r.drag, r.objects, r.descendants, r.file, `#${r.page}`);
