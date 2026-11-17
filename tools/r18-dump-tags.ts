/** 第十八轮调查：列出文件里除对象记录（2000–2999）以外的全部记录标签、长度和前若干字节，用来找“打开即执行”一类页级记录。
 *  用法：npx tsx tools/r18-dump-tags.ts 序号,序号… [最小标签] [最大标签] */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const lo = Number(process.argv[3] ?? 0), hi = Number(process.argv[4] ?? 99999);
for (const key of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  const path = '../' + rows[key].file.replace(/\\/g, '/');
  console.log(`== ${key} ${rows[key].file.split('\\').pop()}`);
  const recs = readRecords(new Uint8Array(readFileSync(path))).records;
  let objects = 0;
  const counts = new Map<number, number>();
  for (const r of recs) {
    if (r.tag === 2000) objects++;
    counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
    if (r.tag >= lo && r.tag <= hi && (r.tag < 2000 || r.tag >= 3000) && (counts.get(r.tag) ?? 0) <= 4)
      console.log(`  @obj${objects} ${r.tag} len=${r.data.length} ${Buffer.from(r.data.subarray(0, 64)).toString('hex')}`);
  }
  console.log('  标签计数', [...counts].sort((a, b) => a[0] - b[0]).map(([t, n]) => `${t}×${n}`).join(' '));
}
