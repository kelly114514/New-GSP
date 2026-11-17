/** 比较新版写出的文件与原版另存后的文件：对象数、类型、父对象、自由点坐标。 */
import { readFileSync } from 'node:fs';
import { pageDisplay } from '../src/core/model';
import { decodeGsp } from '../src/gsp/codec';
const a = decodeGsp(new Uint8Array(readFileSync(process.argv[2]))), b = decodeGsp(new Uint8Array(readFileSync(process.argv[3])));
const oa = a.doc.pages[0].objects, ob = b.doc.pages[0].objects;
let bad = 0;
console.log(`新版写出 ${oa.length} 个对象；原版另存后 ${ob.length} 个对象；原版另存后不认识的对象 ${ob.filter(o => o.def.k === 'unknown').length}`);
for (let i = 0; i < Math.max(oa.length, ob.length); i++) {
  const x = oa[i], y = ob[i];
  // 原版会把文本框收缩到文字大小、按目标重写按钮文字：这两处只是显示上的差别
  // 表格的最后一行在原版里始终跟随度量的当前值，所以不比较最后一行
  const norm = (d: any) => (d?.k === 'image' ? { ...d, data: '' } : d?.k === 'table' ? { ...d, rows: d.rows.slice(0, -1) } : d?.k === 'text' ? { ...d, w: 0, h: 0, at: d.anchor !== undefined ? 0 : d.at, off: 0 } : d?.k === 'button' ? { ...d, text: '', w: 0, h: 0 } : d);
  const sx = JSON.stringify(norm(x?.def)), sy = JSON.stringify(norm(y?.def));
  const near = (p: unknown, q: unknown) => JSON.stringify(p, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)) === JSON.stringify(q, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
  if (x?.def.k === 'measure' && y?.def.k === 'measure' && JSON.stringify(x.at) !== JSON.stringify(y.at)) { bad++; console.log(`#${i + 1} 度量位置不同 新版 ${JSON.stringify(x.at)} 原版 ${JSON.stringify(y.at)}`); }
  if (!near(norm(x?.def), norm(y?.def))) { bad++; console.log(`#${i + 1} 不同\n  新版 ${sx}\n  原版 ${sy}`); }
}
const ta = JSON.stringify(a.doc.pages[0].transforms ?? []), tb = JSON.stringify(b.doc.pages[0].transforms ?? []);
if (ta !== tb) { bad++; console.log(`自定义变换不同
  新版 ${ta}
  原版 ${tb}`); }
const fonts = (doc: typeof a.doc) => doc.pages.map((page, pageIndex) => ({
  styles: pageDisplay(doc, page).textStyles,
  // 原版另存可为未指定字体的对象写入程序默认值。检查有明确字体要求的对象及所有文本。
  objects: page.objects.flatMap((o, index) => a.doc.pages[pageIndex]?.objects[index]?.font || o.def.k === 'text' ? [{
    index,
    font: o.font,
    textFont: o.def.k === 'text' ? o.def.font : undefined,
    runs: o.def.k === 'text' ? o.def.runs?.map(r => r.font) : undefined,
    math: o.def.k === 'text' ? o.def.math : undefined,
  }] : []),
}));
const fa = JSON.stringify(fonts(a.doc)), fb = JSON.stringify(fonts(b.doc));
if (fa !== fb) { bad++; console.log('字体或样式不同', { 新版: fa, 原版: fb }); }
console.log(bad ? `有 ${bad} 处不同` : '全部对象及字体检查通过');
process.exitCode = bad ? 1 : 0;
