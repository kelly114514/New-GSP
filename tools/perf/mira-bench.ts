/** 单文件求值基准：测整页首次求值耗时，并给每个对象的结果算 sha1 指纹，用于优化前后逐位比对。
 * npx tsx tools/perf/mira-bench.ts [文件=../sketchpad5/Samples/分形艺术/Mira分形-三鹰翅.gsp] [--out 输出.json] [--page N] [--compare 基线.json]
 * 性能优化只有在 --compare 报告“全部对象一致”时才能保留。结果文件写到系统临时目录，不进项目。 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../../src/core/store';
import { decodeFile } from '../../src/gsp/codec';
import { iterFast } from '../../src/core/iterfast';

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const noFast = argv.includes('--no-fast'); if (noFast) argv.splice(argv.indexOf('--no-fast'), 1);
const out = opt('--out'), cmp = opt('--compare'), pageArg = opt('--page');
const file = argv[0] ?? '../sketchpad5/Samples/分形艺术/Mira分形-三鹰翅.gsp';

const hashOf = (v: unknown) => createHash('sha1')
  .update(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x)))
  .digest('hex').slice(0, 16);

const st = new Store(decodeFile(new Uint8Array(readFileSync(file)), file).doc);
st.protectedReason = undefined;
if (noFast) iterFast.enabled = false;
if (pageArg !== undefined) st.doc.current = Number(pageArg);
const t0 = performance.now();
st.recompute();
const ms = performance.now() - t0;

const per: Record<string, string> = {};
const total = createHash('sha1');
for (const o of st.page.objects) {
  const h = hashOf(st.results.get(o.id));
  per[o.id] = h;
  total.update(`${o.id}:${h}\n`);
}
const summary = { file, page: st.doc.current, objects: st.page.objects.length, ms: Math.round(ms), fingerprint: total.digest('hex').slice(0, 16) };
console.log(JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify({ summary, per }));
if (cmp) {
  const base = JSON.parse(readFileSync(cmp, 'utf8')) as { summary: typeof summary; per: Record<string, string> };
  const diff = Object.keys({ ...base.per, ...per }).filter(id => base.per[id] !== per[id]);
  console.log(diff.length ? `不一致对象 ${diff.length} 个：${diff.slice(0, 20).join(',')}` : `全部对象一致（${Object.keys(per).length} 个）；基线 ${base.summary.ms} ms → ${summary.ms} ms`);
  process.exitCode = diff.length ? 1 : 0;
}
