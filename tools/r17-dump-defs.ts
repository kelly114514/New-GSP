/** 第十七轮调查：按序号列出课件当前页每个对象的定义（精简 JSON）。用法：npx tsx tools/r17-dump-defs.ts 截图序号 [起始id-结束id] */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const key = process.argv[2], range = process.argv[3]?.split('-').map(Number);
const doc = decodeGsp(new Uint8Array(readFileSync('../' + rows[key].file.replace(/\\/g, '/')))).doc;
const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
for (const o of pg.objects) {
  if (range && (o.id < range[0] || o.id > range[1])) continue;
  const { k, ...rest } = o.def as { k: string };
  console.log(`#${o.id} ${k}${o.hidden ? ' (hidden)' : ''}${o.label ? ` "${o.label}"` : ''} ${JSON.stringify(rest).slice(0, 220)}`);
}
