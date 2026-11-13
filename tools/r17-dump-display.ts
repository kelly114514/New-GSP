/** 第十七轮调查：列出课件的显示设置（文本样式、数学标签斜体）及一类对象的字体。用法：npx tsx tools/r17-dump-display.ts 序号,序号… */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
import { pageDisplay } from '../src/core/model';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
for (const key of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  const path = '../' + rows[key].file.replace(/\\/g, '/');
  const doc = decodeGsp(new Uint8Array(readFileSync(path))).doc;
  const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
  const disp = pageDisplay(doc, pg);
  console.log(`== ${key} ${rows[key].file.split('\\').pop()}  pages=${doc.pages.length}`);
  console.log('  settings.display =', JSON.stringify(doc.settings.display));
  console.log('  page.display    =', JSON.stringify(pg.display));
  console.log('  effective mathItalic =', disp.mathItalic, ' textStyles.label =', JSON.stringify(disp.textStyles?.label), ' value =', JSON.stringify(disp.textStyles?.value));
  const kinds = new Map<string, number>();
  for (const o of pg.objects) if (['measure', 'param', 'calc'].includes(o.def.k)) {
    const f = o.font ? `${o.font.name}/${o.font.size}/b${+o.font.bold}/i${+o.font.italic}` : 'none';
    kinds.set(`${o.def.k} font=${f}`, (kinds.get(`${o.def.k} font=${f}`) ?? 0) + 1);
  }
  for (const [k, n] of kinds) console.log(`   ${k} ×${n}`);
}
