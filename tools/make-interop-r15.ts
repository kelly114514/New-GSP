/** 第十五轮写出端三处改动的互读样本：按数值在轴上画点（方向）、样式表颜色、以坐标轴为参照线的平行线/垂线上的点（200 像素）。
 * 用法：npx tsx tools/make-interop-r15.ts 输出.gsp ；再用 reference/raw/runtime/interop_roundtrip.py 让原版打开并另存，
 * 然后 npx tsx tools/make-interop-r15.ts --check 原版另存.gsp 比较。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';

function build(): Store {
  const st = new Store();
  st.run('r15', () => {
    const sys = createSystem(st, { x: 200, y: 400 });
    const d = sys.def as Extract<typeof sys.def, { k: 'sys' }>;
    const k2 = st.add({ k: 'param', name: 'k', value: 2, unit: 'none', showEdit: true }, { at: { x: 20, y: 20 } });
    const k3 = st.add({ k: 'param', name: 'j', value: 3, unit: 'none', showEdit: true }, { at: { x: 20, y: 50 } });
    st.add({ k: 'axispt', axis: 'x', value: k2.id, sys: sys.id }, { label: 'X', labelShown: true });
    st.add({ k: 'axispt', axis: 'y', value: k3.id, sys: sys.id }, { label: 'Y', labelShown: true });
    // 带颜色的文字样式：红色标签点、蓝色度量
    const P = st.add({ k: 'free', x: 420, y: 300 }, { label: 'P', labelShown: true, font: { name: 'Times New Roman', size: 16, bold: true, italic: false, underline: false, color: '#ff0000' } });
    const Q = st.add({ k: 'free', x: 520, y: 340 }, { label: 'Q', labelShown: true, labelDx: -30, labelDy: -45 });
    st.add({ k: 'translate', src: Q.id, by: { mode: 'rect', dx: 1, dy: 1 } }, { label: "Q'", labelShown: true, labelDx: 20, labelDy: -30 });
    const m = st.add({ k: 'measure', m: 'distance', refs: [P.id, Q.id] }, { at: { x: 300, y: 40 }, font: { name: 'Arial', size: 14, bold: false, italic: false, underline: false, color: '#0000ff' } });
    void m;
    // 以坐标轴为参照线的平行线、垂线上的点（单位 200 像素）
    const through = st.add({ k: 'free', x: 300, y: 250 });
    const par = st.add({ k: 'parallel', pt: through.id, line: d.axisX });
    st.add({ k: 'onpath', path: par.id, t: 100, abs: true });
    const perp = st.add({ k: 'perp', pt: Q.id, line: d.axisX });
    st.add({ k: 'onpath', path: perp.id, t: -80, abs: true });
  });
  return st;
}
const args = process.argv.slice(2);
if (args[0] === '--check') {
  const b = decodeGsp(new Uint8Array(readFileSync(args[1]))).doc.pages[0].objects;
  const res = evaluatePage(decodeGsp(new Uint8Array(readFileSync(args[1]))).doc.pages[0], undefined, undefined, {});
  for (const o of b) { const s: any = res.get(o.id)?.shape; console.log(o.id, o.def.k, (o.def as any).axis ?? '', (o.def as any).abs ? 'abs t=' + (o.def as any).t : '', o.font?.color ?? '', o.labelDx !== undefined ? `label(${o.labelDx},${o.labelDy})` : '', s?.p ? `(${s.p.x.toFixed(1)},${s.p.y.toFixed(1)})` : ''); }
} else {
  const st = build();
  const bytes = encodeGsp(st.doc);
  writeFileSync(args[0], bytes);
  const a = decodeGsp(bytes).doc.pages[0];
  const res = evaluatePage(a, undefined, undefined, {});
  for (const o of a.objects) { const s: any = res.get(o.id)?.shape; console.log(o.id, o.def.k, (o.def as any).axis ?? '', (o.def as any).abs ? 'abs t=' + (o.def as any).t : '', o.font?.color ?? '', o.labelDx !== undefined ? `label(${o.labelDx},${o.labelDy})` : '', s?.p ? `(${s.p.x.toFixed(1)},${s.p.y.toFixed(1)})` : ''); }
}
