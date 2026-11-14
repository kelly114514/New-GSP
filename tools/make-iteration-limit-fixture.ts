/** 原版上限夹具。写入系统临时目录，分别观察最后一层和所有层。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import { encodeGsp } from '../src/gsp/codec';
import type { Expr } from '../src/core/expr';

const dir = process.argv[2];
if (!dir) throw new Error('请提供临时输出目录');
mkdirSync(dir, { recursive: true });
for (const n of [10000, 60000, 95000, 100000, 105000, 125000, 200000]) {
  const st = new Store();
  const sys = createSystem(st, { x: 45, y: 220 }).id;
  for (const o of st.page.objects) o.hidden = true;
  const start = st.add({ k: 'param', name: 'u', unit: 'none', value: 0, showEdit: true }, { hidden: true });
  const depth = st.add({ k: 'param', name: 'n', unit: 'none', value: n, showEdit: true }, { hidden: true });
  const next = st.add({ k: 'calc', unit: 'none', expr: { t: 'bin', op: '+', a: { t: 'ref', id: start.id }, b: { t: 'num', v: 1 } } }, { hidden: true });
  const x = st.add({ k: 'calc', unit: 'none', expr: { t: 'bin', op: '/', a: { t: 'ref', id: start.id }, b: { t: 'num', v: 20000 } } }, { hidden: true });
  const y = st.add({ k: 'param', name: 'y', unit: 'none', value: 0, showEdit: true }, { hidden: true });
  const p = st.add({ k: 'plotxy', x: x.id, y: y.id, sys }, { hidden: true });
  const iteration = st.add({ k: 'iterate', pre: [start.id], maps: [[next.id]], body: [next.id, x.id, p.id], depth: { param: depth.id }, finalOnly: true });
  st.add({ k: 'iterimg', iter: iteration.id, src: p.id }, { style: { color: '#ff0000', width: 1, pointSize: 3, dash: 'solid' } });
  writeFileSync(join(dir, `single-${n}.gsp`), encodeGsp(st.doc));
}

const cases = [15, 16, 17, 18, 19].map(n => ({ n, branches: 2 }));
cases.push({ n: 8, branches: 5 }, { n: 5, branches: 10 }, { n: 3, branches: 46 }, { n: 3, branches: 47 });
for (const { n, branches } of cases) for (const finalOnly of [false, true]) {
  const st = new Store();
  const sys = createSystem(st, { x: 45, y: 520 }).id;
  for (const o of st.page.objects) o.hidden = true;
  const param = (name: string, value: number) => st.add({ k: 'param', name, unit: 'none', value, showEdit: true }, { hidden: true }).id;
  const calc = (op: '+' | '*' | '/', a: Expr, b: number) => st.add({ k: 'calc', unit: 'none', expr: { t: 'bin', op, a, b: { t: 'num', v: b } } }, { hidden: true }).id;
  const ref = (id: number): Expr => ({ t: 'ref', id });
  const level = param('i', 0), index = param('j', 0);
  const inc = calc('+', ref(level), 1), low = calc('*', ref(index), branches);
  const mapped = [low, ...Array.from({ length: branches - 1 }, (_, i) => calc('+', ref(low), i + 1))];
  const y = calc('/', ref(index), 24000);
  const p = st.add({ k: 'plotxy', x: level, y, sys }, { hidden: true }).id;
  const iter = st.add({ k: 'iterate', pre: [level, index], maps: mapped.map(id => [inc, id]), body: [inc, ...mapped, y, p], depth: { param: param('n', n) }, finalOnly });
  st.add({ k: 'iterimg', iter: iter.id, src: p }, { style: { color: '#ff0000', width: 1, pointSize: 0, dash: 'solid' } });
  const prefix = branches === 2 ? 'multi' : `multi-${branches}`;
  writeFileSync(join(dir, `${prefix}-${n}-${finalOnly ? 'final' : 'all'}.gsp`), encodeGsp(st.doc));
}
