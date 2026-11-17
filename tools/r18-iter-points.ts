/** 第十八轮调查：打印迭代象的点数、包围盒和若干指定序号的点，用来和按公式独立模拟的轨道逐点比较。
 *  用法：npx tsx tools/r18-iter-points.ts 截图序号或文件路径 [点序号,点序号…] [--nofast] */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';
import { iterFast } from '../src/core/iterfast';
import { pageDisplay } from '../src/core/model';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const key = process.argv[2], want = (process.argv[3] ?? '0,1,2,10,100,499,500,1000,4999,5000,49999').split(',').flatMap(s => { const m = /^(\d+)-(\d+)$/.exec(s); return m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i) : [Number(s)]; });   // 支持 起-止
if (process.argv.includes('--nofast')) iterFast.enabled = false;
const doc = decodeGsp(readFileSync(rows[key] ? '../' + rows[key].file.replace(/\\/g, '/') : key)).doc;
const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
const sc = pg.scroll ?? { x: 0, y: 0 };
const view = { x0: sc.x, y0: sc.y, x1: sc.x + 1190, y1: sc.y + 636 };
const res = evaluatePage(pg, undefined, undefined, { angleUnit: pageDisplay(doc, pg).angleUnit, view });
console.log('scroll', JSON.stringify(sc));
for (const o of pg.objects) {
  if (o.def.k !== 'iterimg' && o.def.k !== 'iterate') continue;
  const r = res.get(o.id) as { status: string; shape?: Record<string, unknown> } | undefined;
  const s = r?.shape as Record<string, unknown> | undefined;
  console.log('#' + o.id, o.def.k, r?.status, s ? Object.keys(s).map(k => `${k}:${Array.isArray(s[k]) ? 'array' + (s[k] as unknown[]).length : ArrayBuffer.isView(s[k]) ? 'typed' + (s[k] as Float64Array).length : typeof s[k] === 'object' ? 'object' : String(s[k])}`).join(' ') : '');
  if (o.def.k !== 'iterimg' || !s) continue;
  // 点列可能是 {x,y} 数组，也可能是紧凑的坐标数组
  let pts: { x: number; y: number }[] = [];
  for (const v of Object.values(s)) {
    if (ArrayBuffer.isView(v)) { const a = v as Float64Array; for (let i = 0; i + 1 < a.length; i += 2) pts.push({ x: a[i], y: a[i + 1] }); break; }
    if (Array.isArray(v) && v.length && typeof (v[0] as { x?: number }).x === 'number') { pts = v as { x: number; y: number }[]; break; }
    if (Array.isArray(v) && v.length && (v[0] as { p?: { x: number; y: number } }).p) { pts = (v as { p: { x: number; y: number } }[]).map(e => e.p); break; }
    if (Array.isArray(v) && v.length && (v[0] as { shape?: { p?: { x: number; y: number } } }).shape?.p) { pts = (v as { shape: { p: { x: number; y: number } } }[]).map(e => e.shape.p); break; }
  }
  if (!pts.length) continue;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  console.log('  点数', pts.length, '包围盒', [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(v => v.toFixed(1)).join(' '));
  for (const i of want) if (i < pts.length) console.log('  ', i, pts[i].x, pts[i].y);
}
