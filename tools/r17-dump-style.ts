/** 第十七轮调查：按序号列出对象的类型、隐藏、颜色、线宽（看叠放次序和颜色）。用法：npx tsx tools/r17-dump-style.ts 截图序号 [类型,类型…] */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const kinds = process.argv[3]?.split(',');
const doc = decodeGsp(new Uint8Array(readFileSync('../' + rows[process.argv[2]].file.replace(/\\/g, '/')))).doc;
const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
for (const o of pg.objects) {
  if (kinds && !kinds.includes(o.def.k)) continue;
  console.log(`#${o.id} ${o.def.k}${o.hidden ? ' (hidden)' : ''} color=${o.style.color} w=${o.style.width} dash=${o.style.dash} ${JSON.stringify(o.def).slice(0, 90)}`);
}
