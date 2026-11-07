import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';

const FIX = join(__dirname, '../../reference/raw/runtime/fixtures-v3');
const have = existsSync(join(FIX, 'pl3.gsp'));
const load = (n: string) => new Uint8Array(readFileSync(join(FIX, `${n}.gsp`)));

// 原版里用真实鼠标（150% 缩放，文件坐标 = 点击位置 / 1.5）在垂线、平行线上点的点，按对象顺序：先垂线上的，再平行线上的
const CLICKS: Record<string, [number, number][]> = {
  pl2: [[250, 400], [250, 500], [250, 250], [250, 80], [250, 600], [80, 180], [180, 180], [330, 180], [400, 180], [600, 180], [700, 180]],
  pl3: [[417, 75], [472, 158], [528, 242], [583, 325], [639, 408], [117, 555], [283, 445], [366, 389], [450, 334], [533, 278]],
};

describe.skipIf(!have)('垂线/平行线上的点（原版采集 pl2、pl3）', () => {
  for (const name of ['pl2', 'pl3']) {
    it(`${name}：t=0.5 在所过的点，单位是参照线的向量，点的位置与点击位置一致`, () => {
      const pg = decodeGsp(load(name)).doc.pages[0], res = evaluatePage(pg);
      const pts = pg.objects.filter(o => o.def.k === 'onpath');
      expect(pts.length).toBe(CLICKS[name].length);
      pts.forEach((o, i) => {
        const s = res.get(o.id)?.shape;
        expect(s?.k).toBe('pt');
        if (s?.k !== 'pt') return;
        const [cx, cy] = CLICKS[name][i];
        expect(Math.hypot(s.p.x - cx / 1.5, s.p.y - cy / 1.5)).toBeLessThan(1.6);
      });
    });
    it(`${name}：写出再读回，参数不变`, () => {
      const doc = decodeGsp(load(name)).doc;
      const back = decodeGsp(encodeGsp(doc)).doc.pages[0];
      const a = doc.pages[0].objects.filter(o => o.def.k === 'onpath').map(o => (o.def as { t: number }).t);
      const b = back.objects.filter(o => o.def.k === 'onpath').map(o => (o.def as { t: number }).t);
      b.forEach((t, i) => expect(t).toBeCloseTo(a[i], 9));
    });
  }

  it('坐标轴上的点（pl5a、pl6）：t=0.5 在原点，单位 200 像素，与单位长度无关', () => {
    const X = [[500, 478], [700, 478], [1100, 478], [1250, 478]], Y = [[888, 120], [888, 250], [888, 600], [888, 700]];
    const pg = decodeGsp(load('pl5a')).doc.pages[0], res = evaluatePage(pg);
    const pts = pg.objects.filter(o => o.def.k === 'onpath');
    expect(pts.length).toBe(8);
    pts.forEach((o, i) => {
      const s = res.get(o.id)?.shape, [cx, cy] = [...X, ...Y][i];
      expect(s?.k).toBe('pt');
      if (s?.k === 'pt') expect(Math.abs(i < 4 ? s.p.x - cx / 1.5 : s.p.y - cy / 1.5)).toBeLessThan(1.2);   // 只比较沿轴的坐标（点击位置离轴有偏差）
    });
    // 拖大 x 轴单位点以后（pl6）再点的两个点（第 17、18 个对象），位置仍对应点击位置
    const pg6 = decodeGsp(load('pl6')).doc.pages[0], res6 = evaluatePage(pg6);
    [1300, 1400].forEach((cx, i) => {
      const o = pg6.objects.filter(q => q.def.k === 'onpath')[8 + i], s = res6.get(o.id)?.shape;
      if (s?.k === 'pt') expect(Math.abs(s.p.x - cx / 1.5)).toBeLessThan(1.2); else expect(s?.k).toBe('pt');
    });
    const back = decodeGsp(encodeGsp(decodeGsp(load('pl5a')).doc)).doc.pages[0], resB = evaluatePage(back);
    back.objects.filter(o => o.def.k === 'onpath').forEach((o, i) => {
      const a = res.get(pts[i].id)?.shape, b = resB.get(o.id)?.shape;
      if (a?.k === 'pt' && b?.k === 'pt') expect(Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y)).toBeLessThan(1e-6);
    });
  });
});
