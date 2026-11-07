/** 迭代互读样本：新版写出 → 原版打开/另存 → 新版重读（reference/raw/runtime/interop_roundtrip.py + tools/check-interop.ts）。
 * 用法：npx tsx tools/make-iter-interop.ts <输出.gsp> */
import { writeFileSync } from 'node:fs';
import { Store } from '../src/core/store';
import { constructIteration } from '../src/core/iterate';
import { encodeGsp } from '../src/gsp/codec';

const st = new Store();
st.run('迭代样本', () => {
  const grp = (x: number, y: number) => {
    const a = st.add({ k: 'free', x, y }).id, b = st.add({ k: 'free', x: x + 140, y }).id;
    const s = st.add({ k: 'seg', a, b }).id, m = st.add({ k: 'mid', seg: s }).id;
    return { a, b, s, m };
  };
  const g1 = grp(60, 80);                                       // 单映射：A→B，B→M，默认 3 次，所有对象的象
  constructIteration(st, { pre: [g1.a, g1.b], maps: [[g1.b, g1.m]], depth: { fixed: 3 } });
  const g2 = grp(60, 180);                                      // 两个映射 + 非点类象
  constructIteration(st, { pre: [g2.a, g2.b], maps: [[g2.a, g2.m], [g2.m, g2.b]], depth: { fixed: 3 }, nonPointOnly: true });
  const g3 = grp(60, 280);                                      // 深度迭代：次数取自参数，只显示最终迭代
  const n = st.add({ k: 'param', name: 'n', value: 4, unit: 'none', showEdit: true }, { at: { x: 30, y: 330 } }).id;
  constructIteration(st, { pre: [g3.a, g3.b], maps: [[g3.b, g3.m]], depth: { param: n }, finalOnly: true });
  const g4 = grp(60, 380);                                      // 圆也迭代（和前像无关的后代）
  st.add({ k: 'circle', c: g4.a, p: g4.b });
  constructIteration(st, { pre: [g4.a, g4.b], maps: [[g4.b, g4.m]], depth: { fixed: 2 } });
});
writeFileSync(process.argv[2], encodeGsp(st.doc));
console.log('写出', process.argv[2], st.page.objects.length, '个对象');
