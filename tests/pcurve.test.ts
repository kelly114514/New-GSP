import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';
import { CM } from '../src/core/expr';

const FIX = join(__dirname, '../../reference/raw/runtime/fixtures-v4');
const have = existsSync(join(FIX, 'curve_rect.gsp'));
const load = (n: string) => new Uint8Array(readFileSync(join(FIX, `${n}.gsp`)));

describe.skipIf(!have)('参数曲线（原版采集 probe_curve2：f(t)=t，g(t)=t²）', () => {
  it('直角：方法 126，t∈[0,2]，端点是 (0,0) 和 (2,4)（单位厘米）', () => {
    const pg = decodeGsp(load('curve_rect')).doc.pages[0], res = evaluatePage(pg);
    const c = pg.objects.find(o => o.def.k === 'pcurve')!;
    expect(c.def).toMatchObject({ k: 'pcurve', polar: false, lo: 0, hi: 2, samples: 750 });
    const org = pg.objects.find(o => o.def.k === 'free')!, o = res.get(org.id)!.shape as { p: { x: number; y: number } };
    const s = res.get(c.id)!.shape as { k: string; paths: { x: number; y: number }[][] };
    expect(s.k).toBe('paths');
    const pts = s.paths.flat(), first = pts[0], last = pts[pts.length - 1];
    expect(first.x).toBeCloseTo(o.p.x, 3); expect(first.y).toBeCloseTo(o.p.y, 3);
    expect(last.x).toBeCloseTo(o.p.x + 2 * CM, 3); expect(last.y).toBeCloseTo(o.p.y - 4 * CM, 3);
  });
  it('极坐标：方法 127，α 无单位时按弧度（t=3 时 r=3、α=9 弧度）', () => {
    const pg = decodeGsp(load('curve_polar')).doc.pages[0], res = evaluatePage(pg);
    const c = pg.objects.find(o => o.def.k === 'pcurve')!;
    expect(c.def).toMatchObject({ polar: true, lo: 0, hi: 3 });
    const org = pg.objects.find(o => o.def.k === 'free')!, o = res.get(org.id)!.shape as { p: { x: number; y: number } };
    const pts = (res.get(c.id)!.shape as { paths: { x: number; y: number }[][] }).paths.flat(), last = pts[pts.length - 1];
    expect(last.x - o.p.x).toBeCloseTo(3 * Math.cos(9) * CM, 3); expect(o.p.y - last.y).toBeCloseTo(3 * Math.sin(9) * CM, 3);
  });
  it('读后再写，原样读回', () => {
    for (const n of ['curve_rect', 'curve_polar']) {
      const a = decodeGsp(load(n)).doc, b = decodeGsp(encodeGsp(a)).doc;
      expect(b.pages[0].objects.map(o => o.def)).toEqual(a.pages[0].objects.map(o => o.def));
    }
  });
});
