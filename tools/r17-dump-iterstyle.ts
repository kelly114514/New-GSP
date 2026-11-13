/** 第十七轮调查：列出课件里迭代象、迭代点及其原象的点型/线宽/颜色。用法：npx tsx tools/r17-dump-iterstyle.ts 序号,序号… */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
for (const key of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  const path = '../' + rows[key].file.replace(/\\/g, '/');
  const doc = decodeGsp(new Uint8Array(readFileSync(path))).doc;
  const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
  const byId = new Map(pg.objects.map(o => [o.id, o]));
  console.log(`== ${key} ${rows[key].file.split('\\').pop()}`);
  for (const o of pg.objects) {
    if (o.def.k !== 'iterimg' && o.def.k !== 'iterpt') continue;
    const src = o.def.k === 'iterimg' ? byId.get(o.def.src) : undefined;
    console.log(`  #${o.id} ${o.def.k} style=${JSON.stringify(o.style)} hidden=${o.hidden}` + (src ? ` | src #${src.id} ${src.def.k} style=${JSON.stringify(src.style)} hidden=${src.hidden}` : ''));
  }
}
