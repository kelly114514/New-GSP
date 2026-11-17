/** 第十九轮调查：全库字体表记录 1201 的原始字节统计——字体名用什么编码存、首个 u16 标志取哪些值。
 *  用来核对“原版不能保留宋体”这一保存保护的依据（原版自己的课件里就有宋体）。
 *  用法：npx tsx tools/r19-font-table.ts [样例数=3] */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
// 给出文件路径时只列这些文件的字体表（用于看原版另存之后的结果）
const paths = process.argv.slice(2).filter(a => /\.gsp$/i.test(a));
if (paths.length) {
  for (const p of paths) {
    console.log('==', p);
    for (const r of readRecords(new Uint8Array(readFileSync(p))).records) if (r.tag === 1201) {
      let end = 2; while (end < r.data.length && r.data[end] !== 0) end++;
      const raw = r.data.subarray(2, end);
      let name: string; try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { name = 'GBK:' + new TextDecoder('gbk').decode(raw); }
      console.log('  ', name, '标志', r.data[0] | (r.data[1] << 8), Buffer.from(r.data).toString('hex'));
    }
  }
  process.exit(0);
}
const show = Number(process.argv[2] ?? 3);
const seen = new Map<string, { n: number; files: number; keys: string[]; hex: string }>();
for (const [key, row] of Object.entries(rows)) {
  let recs;
  try { recs = readRecords(new Uint8Array(readFileSync('../' + row.file.replace(/\\/g, '/')))).records; } catch { continue; }
  const inFile = new Set<string>();
  for (const r of recs) {
    if (r.tag !== 1201) continue;
    const flag = r.data[0] | (r.data[1] << 8);
    let end = 2; while (end < r.data.length && r.data[end] !== 0) end++;
    const raw = r.data.subarray(2, end);
    const ascii = raw.every(b => b < 0x80);
    let utf8ok = true, name = '';
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { utf8ok = false; name = new TextDecoder('gbk').decode(raw); }
    const sig = `${name} | 标志 ${flag} | ${ascii ? 'ASCII' : utf8ok ? 'UTF-8' : 'GBK'} | 尾部 ${r.data.length - end - 1} 字节`;
    const e = seen.get(sig) ?? { n: 0, files: 0, keys: [], hex: Buffer.from(r.data).toString('hex') };
    e.n++; if (!inFile.has(sig)) { inFile.add(sig); e.files++; if (e.keys.length < show) e.keys.push(key); }
    seen.set(sig, e);
  }
}
for (const [sig, e] of [...seen].sort((a, b) => b[1].files - a[1].files).slice(0, 60)) console.log(`${e.files} 份 ${e.n} 条  ${sig}  例 ${e.keys.join(',')}  ${e.hex.slice(0, 60)}`);
console.log('不同条目', seen.size);
