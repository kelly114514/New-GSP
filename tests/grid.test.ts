import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeFile, encodeGsp } from '../src/gsp/codec';
import { pageAutoSnap } from '../src/core/model';
import { Store } from '../src/core/store';

const FIX = join(__dirname, '../../reference/raw/runtime/fixtures-v4');
const have = existsSync(join(FIX, 'grid_rect.gsp'));
const load = (n: string) => decodeGsp(new Uint8Array(readFileSync(join(FIX, `grid_${n}.gsp`))));

describe.skipIf(!have)('四种网格（原版采集 probe_grid2）', () => {
  for (const [n, grid] of [['sq', 'square'], ['rect', 'rect'], ['tri', 'tri'], ['polar', 'polar']] as const) {
    it(`${n}：读出 ${grid}；纵轴单位点${grid === 'rect' || grid === 'tri' ? '可见（方法 55）' : '隐藏'}；读后再写，网格和对象原样读回`, () => {
      const r = load(n), pg = r.doc.pages[0], sys = pg.objects.find(o => o.def.k === 'sys')!;
      expect(r.source.protectedReason).toBeUndefined();
      expect(sys.def).toMatchObject({ grid, showGrid: true });
      const uy = pg.objects.find(o => o.id === (sys.def as { unitY: number }).unitY)!;
      expect(uy.hidden).toBe(!(grid === 'rect' || grid === 'tri'));
      const back = decodeGsp(encodeGsp(r.doc)).doc.pages[0];
      expect(back.objects.map(o => o.def)).toEqual(pg.objects.map(o => o.def));
      expect(back.objects.map(o => o.hidden)).toEqual(pg.objects.map(o => o.hidden));
    });
  }
});

const PREVIOUS = join(__dirname, '../../reference/raw/runtime/fixtures-v2');
describe.skipIf(!existsSync(join(PREVIOUS, 'g7-gridpoints.gsp')))('原版自动吸附和格点记录', () => {
  it('分别读取页级吸附和坐标系格点', () => {
    for (const [file, snap, points] of [['g0-default.gsp', false, false], ['g6-snap.gsp', true, false], ['g7-gridpoints.gsp', true, true]] as const) {
      const doc = decodeGsp(readFileSync(join(PREVIOUS, file))).doc, page = doc.pages[0];
      const sys = page.objects.find(o => o.def.k === 'sys');
      expect(pageAutoSnap(page)).toBe(snap);
      expect(sys?.def.k === 'sys' && !!sys.def.gridPoints).toBe(points);
    }
  });

  it('分别修改两项时保留原版来源记录', () => {
    const r = decodeGsp(readFileSync(join(PREVIOUS, 'g6-snap.gsp'))), st = new Store(r.doc);
    const sys = st.page.objects.find(o => o.def.k === 'sys')!;
    if (sys.def.k !== 'sys') throw Error();
    st.page.autoSnap = false;
    st.update(sys.id, { ...sys.def, gridPoints: true });
    const saved = encodeFile(st.doc, r.source);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const page = decodeGsp(saved.bytes).doc.pages[0], back = page.objects.find(o => o.def.k === 'sys');
    expect(pageAutoSnap(page)).toBe(false);
    expect(back?.def).toMatchObject({ gridPoints: true });
    expect(saved.bytes.length).toBe(r.source.bytes!.length);
  });

  it('早期新版课件的坐标系吸附设置可写成页级记录', () => {
    const st = new Store(decodeGsp(readFileSync(join(PREVIOUS, 'g0-default.gsp'))).doc);
    const sys = st.page.objects.find(o => o.def.k === 'sys')!;
    if (sys.def.k !== 'sys') throw Error();
    st.update(sys.id, { ...sys.def, snap: true });
    const saved = encodeFile(st.doc, undefined);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const page = decodeGsp(saved.bytes).doc.pages[0];
    expect(pageAutoSnap(page)).toBe(true);
    expect(page.objects.find(o => o.def.k === 'sys')?.def).toMatchObject({ snap: false });
  });

  it('没有坐标系的页面也能保留自动吸附标志', () => {
    const st = new Store();
    st.page.autoSnap = true;
    const saved = encodeFile(st.doc, undefined);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(pageAutoSnap(decodeGsp(saved.bytes).doc.pages[0])).toBe(true);
  });
});
