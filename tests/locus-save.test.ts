import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { decodeGsp, encodeFile } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';

/** 轨迹的驱动点附着于线段，但采样路径是另外一条圆。 */
function independentCircle(degenerate = false) {
  const st = new Store();
  const a = st.add({ k: 'free', x: 20, y: 20 }).id;
  const b = st.add({ k: 'free', x: 120, y: 20 }).id;
  const segment = st.add({ k: 'seg', a, b }).id;
  const driver = st.add({ k: 'onpath', path: segment, t: 0.5 }).id;
  const center = st.add({ k: 'free', x: 220, y: 180 }).id;
  const rim = st.add({ k: 'free', x: degenerate ? 220 : 260, y: 180 }).id;
  const path = st.add({ k: 'circle', c: center, p: rim }).id;
  const moved = st.add({ k: 'seg', a: driver, b: center }).id;
  const mid = st.add({ k: 'mid', seg: moved }).id;
  const p = st.add({ k: 'param', name: 'c', value: 0.5, unit: 'none', showEdit: true }, { at: { x: 5, y: 5 } }).id;
  const colored = st.add({ k: 'colorize', src: moved, params: [p], mode: 'gray', cycle: 'none', from: 0, to: 1 }).id;
  const traces = [mid, moved, colored].map((out, i) => st.add({ k: 'locus', driver, path, out, samples: 40, ...(i === 2 ? { colored: true } : {}) }).id);
  return { st, traces, path };
}

describe('轨迹保存与原版互读', () => {
  it('独立圆路径、点和非点轨迹写出后保留路径与实际求值', () => {
    const { st, traces, path } = independentCircle();
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw new Error(encoded.reason);
    const decoded = decodeGsp(encoded.bytes).doc;
    const loaded = new Store(decoded);
    for (const id of traces) {
      expect(loaded.get(id)?.def).toMatchObject({ k: 'locus', path });
      expect(loaded.results.get(id)?.shape).toEqual(st.results.get(id)?.shape);
    }
    const records = readRecords(encoded.bytes).records;
    const headers = records.filter(r => r.tag === 2000 && [35, 102].includes(new DataView(r.data.buffer, r.data.byteOffset).getUint16(0, true)));
    expect(headers.map(r => new DataView(r.data.buffer, r.data.byteOffset).getUint16(8, true))).toEqual([42, 43, 90]);
    const ranges = records.filter(r => r.tag === 2306).map(r => new DataView(r.data.buffer, r.data.byteOffset).getFloat64(8, true));
    expect(ranges).toEqual([Math.PI * 2, Math.PI * 2, Math.PI * 2]);
  });

  it('圆退化时仍按圆路径的完整角度范围写入，恢复后可求值', () => {
    const { st, traces } = independentCircle(true);
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw new Error(encoded.reason);
    const ranges = readRecords(encoded.bytes).records.filter(r => r.tag === 2306)
      .map(r => new DataView(r.data.buffer, r.data.byteOffset).getFloat64(8, true));
    expect(ranges).toEqual([Math.PI * 2, Math.PI * 2, Math.PI * 2]);
    const reopened = new Store(decodeGsp(encoded.bytes).doc);
    reopened.run('恢复圆', () => reopened.moveFree(6, 260, 180));
    expect(reopened.results.get(traces[0])?.shape?.k).toBe('paths');
  });

  const dir = join('..', 'reference', 'raw', 'runtime', 'interop-evidence');
  const source = join(dir, 'locus-independent.gsp'), original = join(dir, 'locus-independent-resaved.gsp');
  it.skipIf(!existsSync(source) || !existsSync(original))('自制独立路径、非点和着色轨迹经原版另存保留定义', () => {
    const before = decodeGsp(readFileSync(source)).doc.pages[0].objects;
    const after = decodeGsp(readFileSync(original)).doc.pages[0].objects;
    expect(before).toHaveLength(18);
    expect(after.map(o => o.def)).toEqual(before.map(o => o.def));
  });
  const circle = join(dir, 'locus-independent-circle.gsp'), circleOriginal = join(dir, 'locus-independent-circle-resaved.gsp');
  it.skipIf(!existsSync(circle) || !existsSync(circleOriginal))('附着点沿另一圆采样的点和线段轨迹经原版另存保留定义', () => {
    const before = decodeGsp(readFileSync(circle)).doc.pages[0].objects;
    const after = decodeGsp(readFileSync(circleOriginal)).doc.pages[0].objects;
    expect(before).toHaveLength(11);
    expect(after.map(o => o.def)).toEqual(before.map(o => o.def));
  });
});
