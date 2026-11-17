/** 第十七轮调查：打印文字对象的原文（可见控制字符转义）、引用对象和分段字体。用法：npx tsx tools/r17-dump-text.ts 截图序号 [对象id] */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const doc = decodeGsp(new Uint8Array(readFileSync('../' + rows[process.argv[2]].file.replace(/\\/g, '/')))).doc;
const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
for (const o of pg.objects) {
  if (o.def.k !== 'text' || o.hidden) continue;
  if (process.argv[3] && o.id !== Number(process.argv[3])) continue;
  const d = o.def as { text: string; refs?: number[]; runs?: { text: string; font: { name: string; size: number; italic: boolean } }[]; font: { name: string } };
  console.log('#' + o.id, 'font', d.font.name, 'refs', JSON.stringify(d.refs));
  console.log('  text', JSON.stringify(d.text).slice(0, 300));
  console.log('  hex', [...d.text].slice(0, 60).map(c => c.charCodeAt(0).toString(16)).join(' '));
  console.log('  runs', d.runs?.slice(0, 8).map(r => `${JSON.stringify(r.text)}@${r.font.name}`).join(' | '));
  for (const id of d.refs ?? []) { const r = pg.objects.find(x => x.id === id); console.log('  ref', id, r?.def.k, 'label', r?.label, 'hidden', r?.hidden); }
}
