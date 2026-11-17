/** 第十八轮调查：全库当前页保存时选中的对象（页末 9000 记录）、按钮类型及截图对照得分。
 *  用法：npx tsx tools/r18-startup-survey.ts [输出.json] */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string; score: number }>;
const out: Record<string, unknown>[] = [];
const kinds = new Map<string, number>();
for (const [key, row] of Object.entries(rows)) {
  let doc;
  try { doc = decodeGsp(new Uint8Array(readFileSync('../' + row.file.replace(/\\/g, '/')))).doc; } catch { continue; }
  const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
  const ids = pg.savedSelection ?? [];
  if (!ids.length) continue;
  const acts = ids.map(id => {
    const o = pg.objects.find(x => x.id === id);
    if (!o) return 'missing';
    if (o.def.k !== 'button') return 'non-button:' + o.def.k;
    return o.def.action.type;
  });
  for (const a of acts) kinds.set(a, (kinds.get(a) ?? 0) + 1);
  out.push({ key, score: +row.score.toFixed(3), acts, file: row.file.split('\\').pop() });
}
out.sort((a, b) => (a.score as number) - (b.score as number));
console.log('含 9000 的课件', out.length, '按钮类型', JSON.stringify([...kinds]));
const moving = out.filter(r => (r.acts as string[]).some(a => a !== 'link'));
console.log('含非链接按钮', moving.length, '平均分', (moving.reduce((s, r) => s + (r.score as number), 0) / moving.length).toFixed(4));
for (const r of moving) console.log(r.key, r.score, (r.acts as string[]).join(','), r.file);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out));
