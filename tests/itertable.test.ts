import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { Store } from '../src/core/store';
import { constructIteration } from '../src/core/iterate';

const F = join(__dirname, '../../reference/raw/runtime/fixtures-v4/iter_table.gsp');
describe.skipIf(!existsSync(F))('迭代数据表（原版采集 probe_itertable：n=3，n+1，迭代 3 次）', () => {
  it('读出：迭代 + 数据表（方法 92），位置 (10, 64)；求值得到原版画面上的 4 行', () => {
    const doc = decodeGsp(new Uint8Array(readFileSync(F))).doc, st = new Store(doc);
    const t = doc.pages[0].objects.find(o => o.def.k === 'itertable')!;
    expect(t.def).toEqual({ k: 'itertable', iter: 3, cols: [2] });
    expect(t.at).toEqual({ x: 10, y: 64 });
    const s = st.results.get(t.id)!.shape as { rows: number[][]; intFirst: boolean };
    expect(s.rows).toEqual([[0, 4], [1, 5], [2, 6], [3, 7]]);
  });
  it('读后再写，原样读回', () => {
    const a = decodeGsp(new Uint8Array(readFileSync(F))).doc, b = decodeGsp(encodeGsp(a)).doc;
    expect(b.pages[0].objects.map(o => o.def)).toEqual(a.pages[0].objects.map(o => o.def));
  });
  it('新版自己建：参数 n 和 n+1，迭代 3 次，默认生成数据表', () => {
    const st = new Store();
    st.run('场景', () => {
      const n = st.add({ k: 'param', name: 'n', value: 3, unit: 'none', showEdit: true }, { at: { x: 24, y: 24 }, label: 'n' });
      const c = st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: n.id }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 24, y: 48 } });
      constructIteration(st, { pre: [n.id], maps: [[c.id]], depth: { fixed: 3 }, table: true });
    });
    const t = st.page.objects.find(o => o.def.k === 'itertable')!;
    expect(t.at).toEqual({ x: 10, y: 64 });
    expect((st.results.get(t.id)!.shape as { rows: number[][] }).rows).toEqual([[0, 4], [1, 5], [2, 6], [3, 7]]);
  });
});
