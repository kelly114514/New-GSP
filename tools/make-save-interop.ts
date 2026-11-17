/** 生成用于原版互读的着色变换和数值表格夹具。 */
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Store } from '../src/core/store';
import { decodeGsp, encodeFile } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';

const out = process.argv[2];
if (!out) throw new Error('请指定系统临时目录');
const st = new Store();
const a = st.add({ k: 'free', x: 160, y: 150 }).id;
const b = st.add({ k: 'free', x: 236, y: 150 }).id;
const c = st.add({ k: 'free', x: 160, y: 250 }).id;
const line = st.add({ k: 'seg', a, b }).id;
const number = st.add({ k: 'param', unit: 'none', name: 'n', value: 0.25, showEdit: true }, { at: { x: 10, y: 20 } }).id;
const color = st.add({ k: 'colorize', src: line, params: [number], mode: 'color', cycle: 'one', from: 0, to: 1 }).id;
const gray = st.add({ k: 'colorize', src: color, params: [number], mode: 'gray', cycle: 'none', from: 0, to: 1 }).id;
st.add({ k: 'translate', src: gray, by: { mode: 'vector', from: a, to: c } });
const length = st.add({ k: 'measure', m: 'length', refs: [line] }, { at: { x: 10, y: 50 } }).id;
const angle = st.add({ k: 'measure', m: 'angle', refs: [b, a, c] }, { at: { x: 10, y: 80 } }).id;
st.add({ k: 'table', cols: [number, length, angle], rows: [[-1.25, 1.5, 45], [0.25, 2.01, 90]] }, { at: { x: 320, y: 130 } });
const saved = encodeFile(st.doc, undefined);
if (!saved.ok) throw new Error(saved.reason);
writeFileSync(join(out, 'save-mixed.gsp'), saved.bytes);
const imported = decodeGsp(saved.bytes);
const point = imported.doc.pages[0].objects[0].def;
if (point.k !== 'free') throw new Error('缺少自由点');
for (const o of imported.doc.pages[0].objects.slice(0, 3)) {
  if (o.def.k === 'free') o.def.y -= 10;
}
const edited = encodeFile(imported.doc, imported.source);
if (!edited.ok) throw new Error(edited.reason);
writeFileSync(join(out, 'save-mixed-edit.gsp'), edited.bytes);

const anchors = new Store();
const p = (x: number, y: number) => anchors.add({ k: 'free', x, y }).id;
const lineA = anchors.add({ k: 'line', a: p(160, 150), b: p(236, 150) }).id;
const lineB = anchors.add({ k: 'line', a: p(160, 250), b: p(240, 200) }).id;
const anchor = anchors.add({ k: 'inter', a: lineA, b: lineB, branch: 0 }).id;
const value = anchors.add({ k: 'param', name: 'p', value: 2, unit: 'none', showEdit: true }, { at: { x: 10, y: 10 } }).id;
anchors.add({ k: 'text', text: 'p=\uE0000\uE001', at: { x: 295, y: 138 }, w: 50, h: 24, anchor, off: { x: -25, y: -12 }, refs: [value],
  font: { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' } });
const anchored = encodeFile(anchors.doc, undefined);
if (!anchored.ok) throw new Error(anchored.reason);
writeFileSync(join(out, 'save-anchor.gsp'), anchored.bytes);
const invalid = anchored.bytes.slice();
const positions = readRecords(invalid).records.filter(r => r.tag === 2201);
new DataView(invalid.buffer).setFloat64(positions[3].offset + 16, 250, true);
writeFileSync(join(out, 'save-anchor-invalid.gsp'), invalid);
const parallel = decodeGsp(invalid);
const rewritten = encodeFile(parallel.doc, undefined);
if (!rewritten.ok) throw new Error(rewritten.reason);
writeFileSync(join(out, 'save-anchor-invalid-written.gsp'), rewritten.bytes);
const reopened = decodeGsp(rewritten.bytes);
const restore = reopened.doc.pages[0].objects[4].def;
if (restore.k !== 'free') throw new Error('缺少控制点');
restore.y = 200;
const restored = encodeFile(reopened.doc, reopened.source);
if (!restored.ok) throw new Error(restored.reason);
writeFileSync(join(out, 'save-anchor-restored.gsp'), restored.bytes);
