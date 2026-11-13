/** 第十七轮调查：列出当前页含指定对象类型的课件序号（逗号分隔）。用法：npx tsx tools/r17-find-kind.ts locus[,iterimg…] */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const want = new Set((process.argv[2] ?? '').split(','));
const hits: number[] = [];
for (const key of Object.keys(rows).sort()) {
  try {
    const doc = decodeGsp(new Uint8Array(readFileSync('../' + rows[key].file.replace(/\\/g, '/')))).doc;
    const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
    if (pg.objects.some(o => want.has(o.def.k))) hits.push(Number(key));
  } catch { /* 跳过 */ }
}
console.log(hits.join(','));
