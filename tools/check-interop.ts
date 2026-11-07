/** 比较新版写出的文件与原版另存后的文件：对象数、类型、父对象、自由点坐标。 */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

// 原版只接受这些字体名（样本 fonttest：宋体、黑体、楷体、Microsoft YaHei、Segoe UI 一律被换成 Tahoma，写入时无害）
const LATIN = new Set(['Times New Roman', 'Arial', 'Tahoma', 'Courier New', 'Verdana', 'Calibri']);
const a = decodeGsp(new Uint8Array(readFileSync(process.argv[2]))), b = decodeGsp(new Uint8Array(readFileSync(process.argv[3])));
const oa = a.doc.pages[0].objects, ob = b.doc.pages[0].objects;
let bad = 0;
console.log(`新版写出 ${oa.length} 个对象；原版另存后 ${ob.length} 个对象；原版另存后不认识的对象 ${ob.filter(o => o.def.k === 'unknown').length}`);
for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
  const x = oa[i], y = ob[i];
  // 原版会把文本框收缩到文字大小、按目标重写按钮文字：这两处只是显示上的差别
  // 表格的最后一行在原版里始终跟随度量的当前值，所以不比较最后一行
  const norm = (d: any) => (d?.k === 'image' ? { ...d, data: '' } : d?.k === 'table' ? { ...d, rows: d.rows.slice(0, -1) } : d?.k === 'text' ? { ...d, w: 0, h: 0, at: d.anchor !== undefined ? 0 : d.at, off: 0,   // 附着文本：原版读入时按自己的规则重新摆放，位置和偏移不比较
     font: { ...d.font, name: LATIN.has(d.font.name) ? d.font.name : 'Tahoma' } } : d?.k === 'button' ? { ...d, text: '', w: 0, h: 0 } : d);
  const sx = JSON.stringify(norm(x?.def)), sy = JSON.stringify(norm(y?.def));
  const near = (p: unknown, q: unknown) => JSON.stringify(p, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)) === JSON.stringify(q, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
  if (x?.def.k === 'measure' && y?.def.k === 'measure' && JSON.stringify(x.at) !== JSON.stringify(y.at)) { bad++; console.log(`#${i + 1} 度量位置不同 新版 ${JSON.stringify(x.at)} 原版 ${JSON.stringify(y.at)}`); }
  if (!near(norm(x?.def), norm(y?.def))) { bad++; console.log(`#${i + 1} 不同\n  新版 ${sx}\n  原版 ${sy}`); }
}
const ta = JSON.stringify(a.doc.pages[0].transforms ?? []), tb = JSON.stringify(b.doc.pages[0].transforms ?? []);
if (ta !== tb) { bad++; console.log(`自定义变换不同
  新版 ${ta}
  原版 ${tb}`); }
console.log(bad ? `有 ${bad} 处不同` : '全部对象一致');
process.exitCode = bad ? 1 : 0;
