/** 第十七轮调查：列出坐标轴对象解码出的字体（来自 2008 样式条目）。用法：npx tsx tools/r17-axis-font.ts 序号… */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
for (const key of process.argv.slice(2)) {
  const doc = decodeGsp(new Uint8Array(readFileSync('../' + rows[key].file.replace(/\\/g, '/')))).doc;
  const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
  for (const o of pg.objects) if (o.def.k === 'sys') {
    const d = o.def as { axisX: number; axisY: number };
    for (const id of [d.axisX, d.axisY]) { const a = pg.objects.find(x => x.id === id); console.log(key, 'axis', id, a?.def.k, 'color', a?.style.color, 'font', JSON.stringify(a?.font)); }
  }
}
