/** 第十八轮调查：统计全库函数图像记录 2306 在样本数之后的字节（偏移 20 起），找“显示箭头/端点”“连续/离散”一类标志。
 *  用法：npx tsx tools/r18-plot-flags.ts */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string; score: number }>;
const seen = new Map<string, { n: number; keys: string[] }>();
const lens = new Map<number, number>();
for (const [key, row] of Object.entries(rows)) {
  let recs;
  try { recs = readRecords(new Uint8Array(readFileSync('../' + row.file.replace(/\\/g, '/')))).records; } catch { continue; }
  for (const r of recs) {
    if (r.tag !== 2306) continue;
    lens.set(r.data.length, (lens.get(r.data.length) ?? 0) + 1);
    if (r.data.length < 28) continue;
    const sig = Buffer.from(r.data.subarray(20, 28)).toString('hex');
    const e = seen.get(sig) ?? { n: 0, keys: [] };
    e.n++; if (e.keys.length < 8 && !e.keys.includes(key)) e.keys.push(key);
    seen.set(sig, e);
  }
}
console.log('长度分布', JSON.stringify([...lens]));
for (const [sig, e] of [...seen].sort((a, b) => b[1].n - a[1].n)) console.log(sig, e.n, e.keys.join(','));
