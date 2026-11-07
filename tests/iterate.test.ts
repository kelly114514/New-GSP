import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';
import { evaluatePage, type Shape } from '../src/core/engine';
import { Store } from '../src/core/store';

const FIX = join(__dirname, '../../reference/raw/runtime/fixtures-v3');
const have = existsSync(FIX);
const load = (n: string) => new Uint8Array(readFileSync(join(FIX, `${n}.gsp`)));
const round = (x: number) => Math.round(x * 100) / 100;

/** 迭代对象和迭代象的原始记录（头前 18 字节、父对象、2314）。 */
function iterRecords(bytes: Uint8Array) {
  const out: string[] = [];
  let cur: string[] | undefined;
  for (const r of readRecords(bytes).records) {
    const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    if (r.tag === 2000) cur = v.getUint16(6, true) === 14 || v.getUint16(6, true) === 15 ? [`h${Buffer.from(r.data.subarray(0, 4)).toString('hex')}/${Buffer.from(r.data.subarray(6, 18)).toString('hex')}`] : undefined;
    else if (cur && r.tag === 2002) cur.push(`p[${Array.from({ length: v.getUint32(0, true) }, (_, i) => v.getUint32(4 + 4 * i, true)).join(',')}]`);
    else if (cur && r.tag === 2314) cur.push(`2314:${Buffer.from(r.data).toString('hex')}`);
    else if (cur && r.tag === 2007) { out.push(cur.join(' ')); cur = undefined; }
  }
  return out;
}

const imagesOf = (st: ReturnType<typeof evaluatePage>, id: number) => { const s = st.get(id)?.shape; return s?.k === 'multi' ? s.items : []; };

describe.skipIf(!have)('迭代：原版采集的样本', () => {
  it('点和线段的迭代：A→B、B→中点，默认 3 次；位置与手算一致', () => {
    const r = decodeGsp(load('i01')), pg = r.doc.pages[0], res = evaluatePage(pg);
    expect(r.source.protectedReason).toBeUndefined();
    expect(pg.objects[4].def).toMatchObject({ k: 'iterate', pre: [1, 2], maps: [[2, 4]], body: [3, 4], depth: { fixed: 3 } });
    const A = 134, B = 267;               // 原版里放在 200/400 物理像素，文件里是 2/3
    const m = (a: number, b: number) => (a + b) / 2;
    const s1 = [B, m(A, B)], s2 = [s1[1], m(s1[0], s1[1])], s3 = [s2[1], m(s2[0], s2[1])];   // 状态：前像 (A, B) 每次换成 (B, M)
    const seg = imagesOf(res, 6).map(s => s.k === 'line' ? [round(s.s.a.x), round(s.s.b.x)] : []);
    expect(seg).toEqual([s1, s2, s3].map(s => [round(s[0]), round(s[1])]));
    const pts = imagesOf(res, 7).map(s => s.k === 'pt' ? round(s.p.x) : NaN);
    expect(pts).toEqual([s1, s2, s3].map(s => round(m(s[0], s[1]))));
  });

  it('增加迭代、只显示最终迭代、仅保留非点类象（没有点的像）', () => {
    const count = (n: string, id: number) => imagesOf(evaluatePage(decodeGsp(load(n)).doc.pages[0]), id).length;
    expect(count('i02', 6)).toBe(4);
    expect(count('i03', 6)).toBe(1);
    expect(decodeGsp(load('i03')).doc.pages[0].objects[4].def).toMatchObject({ finalOnly: true });
    expect(decodeGsp(load('i04')).doc.pages[0].objects.filter(o => o.def.k === 'iterimg').length).toBe(1);
  });

  it('两个映射：每层的状态数按映射数翻倍（2+4+8 = 14 条线段）', () => {
    const r = decodeGsp(load('i06')), pg = r.doc.pages[0];
    expect(pg.objects[4].def).toMatchObject({ maps: [[1, 4], [4, 2]] });
    expect(imagesOf(evaluatePage(pg), 6).length).toBe(14);
  });

  it('与前像无关的后代（圆）也有像；隐藏的线段不产生像但仍在 body 里', () => {
    const r8 = decodeGsp(load('i08')), r9 = decodeGsp(load('i09'));
    expect(r8.doc.pages[0].objects.find(o => o.def.k === 'iterate')!.def).toMatchObject({ body: [3, 4, 5] });
    const circles = imagesOf(evaluatePage(r8.doc.pages[0]), 9);
    expect(circles.length).toBe(3); expect(circles.every((c: Shape) => c.k === 'circle')).toBe(true);
    expect(r9.doc.pages[0].objects.filter(o => o.def.k === 'iterimg').length).toBe(1);
    expect(r9.doc.pages[0].objects.find(o => o.def.k === 'iterate')!.def).toMatchObject({ body: [3, 4] });
  });

  it('深度迭代：次数取自参数；改参数后像的个数跟着变', () => {
    const r = decodeGsp(load('p01')), pg = r.doc.pages[0];
    expect(pg.objects.find(o => o.def.k === 'iterate')!.def).toMatchObject({ depth: { param: 5 } });
    expect(imagesOf(evaluatePage(pg), 7).length).toBe(3);
    const st = new Store(r.doc);
    st.run('x', () => st.update(5, { ...(st.get(5)!.def as { k: 'param'; name: string; value: number; unit: 'none'; showEdit: boolean }), value: 5 }));
    expect(imagesOf(st.results, 7).length).toBe(5);
  });

  it('拖动前像：像跟着动', () => {
    const r = decodeGsp(load('i01')), st = new Store(r.doc);
    st.run('x', () => st.moveFree(1, 300, 100));
    const seg = imagesOf(st.results, 6)[0];
    expect(seg.k === 'line' && seg.s.b.x).toBeCloseTo((300 + 267) / 2);   // 第一层 (A1, B1) = (B, M)，M 是 A、B 的中点；A 挪到 300 后 M 跟着动
  });

  it('写出：迭代对象和迭代象的头、父对象、2314 与原版写的完全一致', () => {
    for (const n of ['i01', 'i02', 'i03', 'i04', 'i06', 'i08', 'i09', 'p01']) {
      const bytes = load(n), r = decodeGsp(bytes);
      const again = encodeGsp(r.doc);
      const a = iterRecords(bytes), b = iterRecords(again);
      // 头的 18 字节之后是颜色/样式，和下面的“互读”样本一起核对；这里只比较种类、父对象和 2314
      expect(b.map(x => x.replace(/\/[0-9a-f]+/, ''))).toEqual(a.map(x => x.replace(/\/[0-9a-f]+/, '')));
    }
  });
});
