/** 第十九轮调查：全库文字标记（2300 的 <S…P序号…>）里各段文字引用的字体统计。
 *  P 是本页字体表（1201）的序号，十六进制，不带数字 = 0。用来核对原版自己是否会把文字段落指向宋体等中文字体。
 *  用法：npx tsx tools/r19-text-fonts.ts [文件.gsp …]（给路径时只列这些文件） */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';

const dec = (d: Uint8Array) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(d); } catch { return 'GBK:' + new TextDecoder('gbk').decode(d); } };
function survey(path: string): Map<string, number> {
  const out = new Map<string, number>();
  let fonts: string[] = [], lastWasFont = false;
  for (const r of readRecords(new Uint8Array(readFileSync(path))).records) {
    if (r.tag === 1201) { if (!lastWasFont) fonts = []; let e = 2; while (e < r.data.length && r.data[e]) e++; fonts.push(dec(r.data.subarray(2, e))); lastWasFont = true; continue; }   // 每页一张字体表
    if (r.tag !== 1203) lastWasFont = false;
    if (r.tag !== 2300) continue;
    const s = new TextDecoder('utf-8').decode(r.data);
    for (const m of s.matchAll(/<S([^<]{0,60})/g)) {
      const p = /P([0-9A-F]*)/.exec(m[1]);
      const k = p ? fonts[parseInt(p[1] || '0', 16)] ?? '?' : '（无 P）';
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}
const paths = process.argv.slice(2).filter(a => /\.gsp$/i.test(a));
if (paths.length) { for (const p of paths) console.log(p.split(/[\\/]/).pop(), JSON.stringify([...survey(p)])); process.exit(0); }
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const files = new Map<string, { n: number; segs: number; keys: string[] }>();
for (const [key, row] of Object.entries(rows)) {
  let m; try { m = survey('../' + row.file.replace(/\\/g, '/')); } catch { continue; }
  for (const [k, n] of m) { const e = files.get(k) ?? { n: 0, segs: 0, keys: [] }; e.n++; e.segs += n; if (e.keys.length < 4) e.keys.push(key); files.set(k, e); }
}
for (const [k, e] of [...files].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) console.log(`${String(e.n).padStart(5)} 份 ${String(e.segs).padStart(6)} 段  ${k}  例 ${e.keys.join(',')}`);
