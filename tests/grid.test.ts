import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';

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
