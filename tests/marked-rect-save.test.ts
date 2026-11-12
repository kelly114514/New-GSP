import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeFile } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';
import { Store } from '../src/core/store';

function fixture() {
  const st = new Store();
  const a = st.add({ k: 'free', x: 100, y: 100 }).id;
  const b = st.add({ k: 'free', x: 200, y: 100 }).id;
  const c = st.add({ k: 'free', x: 100, y: 220 }).id;
  const x = st.add({ k: 'measure', m: 'distance', refs: [a, b] }, { at: { x: 20, y: 30 } }).id;
  const y = st.add({ k: 'measure', m: 'distance', refs: [a, c] }, { at: { x: 20, y: 60 } }).id;
  const p = st.add({ k: 'free', x: 250, y: 180 }).id;
  const translations = [
    st.add({ k: 'translate', src: p, by: { mode: 'rect', dx: 1, dy: 0, dyBy: y } }).id,
    st.add({ k: 'translate', src: p, by: { mode: 'rect', dx: 0, dy: -1, dxBy: x } }).id,
    st.add({ k: 'translate', src: p, by: { mode: 'rect', dx: 0, dy: 0, dxBy: x, dyBy: y } }).id,
  ];
  return { st, translations };
}

describe('直角坐标标记距离平移保存', () => {
  it('三个方法按原始记录结构写出并随度量变化', () => {
    const { st, translations } = fixture();
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw Error(encoded.reason);
    const headers = readRecords(encoded.bytes).records.filter(r => r.tag === 2000)
      .map(r => new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength).getUint16(0, true));
    expect(headers.slice(-3)).toEqual([18, 19, 20]);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    for (const id of translations) {
      expect(reopened.get(id)?.def).toEqual(st.get(id)?.def);
      expect(reopened.results.get(id)?.shape).toEqual(st.results.get(id)?.shape);
    }
    st.moveFree(2, 240, 100); reopened.moveFree(2, 240, 100);
    for (const id of translations) expect(reopened.results.get(id)?.shape).toEqual(st.results.get(id)?.shape);
  });

  it('线段、圆和多边形的标记距离平移保留原象类型', () => {
    const { st } = fixture();
    const seg = st.add({ k: 'seg', a: 1, b: 2 }).id;
    const circle = st.add({ k: 'circle', c: 1, p: 2 }).id;
    const poly = st.add({ k: 'poly', pts: [1, 2, 3] }).id;
    const ids = [
      st.add({ k: 'translate', src: seg, by: { mode: 'rect', dx: 1, dy: 0, dyBy: 5 } }).id,
      st.add({ k: 'translate', src: circle, by: { mode: 'rect', dx: 0, dy: -1, dxBy: 4 } }).id,
      st.add({ k: 'translate', src: poly, by: { mode: 'rect', dx: 0, dy: 0, dxBy: 4, dyBy: 5 } }).id,
    ];
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw Error(encoded.reason);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    for (const id of ids) {
      expect(reopened.get(id)?.def).toEqual(st.get(id)?.def);
      expect(reopened.results.get(id)?.shape).toEqual(st.results.get(id)?.shape);
    }
  });

  const dir = join('..', 'reference', 'raw', 'runtime', 'interop-evidence');
  const source = join(dir, 'marked-rect.gsp'), original = join(dir, 'marked-rect-resaved.gsp');
  it.skipIf(!existsSync(source) || !existsSync(original))('自制样本经原版打开另存后平移定义一致', () => {
    const before = decodeGsp(readFileSync(source)).doc.pages[0].objects;
    const after = decodeGsp(readFileSync(original)).doc.pages[0].objects;
    expect(before).toHaveLength(9);
    expect(after.map(o => o.def)).toEqual(before.map(o => o.def));
  });
  const shapeSource = join(dir, 'marked-rect-shapes.gsp'), shapeOriginal = join(dir, 'marked-rect-shapes-resaved.gsp');
  it.skipIf(!existsSync(shapeSource) || !existsSync(shapeOriginal))('线段、圆和多边形样本经原版另存后定义一致', () => {
    const before = decodeGsp(readFileSync(shapeSource)).doc.pages[0].objects;
    const after = decodeGsp(readFileSync(shapeOriginal)).doc.pages[0].objects;
    expect(before).toHaveLength(15);
    expect(after.map(o => o.def)).toEqual(before.map(o => o.def));
  });
});
