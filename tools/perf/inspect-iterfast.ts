/** 检查指定课件的迭代能否编译为数值/几何快路径，并列出未覆盖的映射对象。
 * 用法：npx tsx tools/perf/inspect-iterfast.ts <课件.gsp> [页号=0] */
import { readFileSync } from 'node:fs';
import { decodeFile } from '../../src/gsp/codec';
import { compileIterBody } from '../../src/core/iterfast';
import { byId, type Def } from '../../src/core/model';
import { Store } from '../../src/core/store';

const file = process.argv[2];
if (!file) throw new Error('需要课件路径');
const pageNo = Number(process.argv[3] ?? 0);
const doc = decodeFile(new Uint8Array(readFileSync(file)), file).doc;
const page = doc.pages[pageNo];
if (!page) throw new Error(`没有第 ${pageNo} 页`);
const store = new Store(doc); store.doc.current = pageNo; store.recompute();
const label = (id: number) => {
  const o = byId(page, id);
  return `${id}:${o?.def.k ?? 'missing'}`;
};
const rows = page.objects.filter(o => o.def.k === 'iterate').map(o => {
  const d = o.def as Extract<Def, { k: 'iterate' }>;
  const p = compileIterBody(d, page);
  const kinds = d.body.reduce<Record<string, number>>((counts, id) => { const k = byId(page, id)?.def.k ?? 'missing'; counts[k] = (counts[k] ?? 0) + 1; return counts; }, {});
  const intersections = d.body.flatMap(id => { const x = byId(page, id); return x?.def.k === 'inter' ? [{ id, a: `${label(x.def.a)}=>${store.results.get(x.def.a)?.shape?.k ?? 'none'}`, b: `${label(x.def.b)}=>${store.results.get(x.def.b)?.shape?.k ?? 'none'}` }] : []; });
  return { id: o.id, pre: d.pre.map(label), bodyKinds: kinds, maps: d.maps.length, depth: d.depth, random: !!d.random, compiled: !!p, intersections, operators: d.maps.map(m => m.map(id => `${label(id)}=>${store.results.get(id)?.shape?.k ?? store.results.get(id)?.status ?? 'none'}`)) };
});
console.log(JSON.stringify({ file, page: pageNo, iterations: rows }, null, 2));
