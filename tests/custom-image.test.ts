import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { encode } from 'fast-png';
import { Store } from '../src/core/store';
import { applyCustomTransform, createSystem } from '../src/core/construct';
import { decodeFile, decodeGsp, encodeFile, encodeGsp } from '../src/gsp/codec';
import { compareContent } from '../src/gsp/semantic';
import { hitAll } from '../src/core/hit';
import { warpGrid } from '../src/core/warp';
import type { Def, Obj } from '../src/core/model';

const FIXTURE = '../reference/raw/runtime/fixtures-p1/pic96/warp-native.gsp';
const png = (w: number, h: number) => Buffer.from(encode({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(255), channels: 4 })).toString('base64');
const meshOf = (st: Store, id: number) => { const s = st.results.get(id)?.shape; return s?.k === 'box' ? s.image?.mesh : undefined; };
const drawn = (st: Store, id: number) => { const m = meshOf(st, id); return m ? m.cells.reduce((a, b) => a + b, 0) : 0; };

/** 自制场景：坐标系 + 驱动点 P + 象点 (sqrt(x), y)，横坐标为负的格点无定义。 */
function sqrtScene() {
  const st = new Store();
  const sys = createSystem(st, { x: 300, y: 300 });
  const p = st.add({ k: 'free', x: 320, y: 280 }, { hidden: true });
  const x = st.add({ k: 'measure', m: 'abscissa', refs: [p.id, sys.id] }, { hidden: true, at: { x: 10, y: 10 } });
  const y = st.add({ k: 'measure', m: 'ordinate', refs: [p.id, sys.id] }, { hidden: true, at: { x: 10, y: 40 } });
  const sx = st.add({ k: 'calc', unit: 'none', expr: { t: 'fn', name: 'sqrt', a: { t: 'ref', id: x.id } } }, { hidden: true, at: { x: 10, y: 70 } });
  const out = st.add({ k: 'plotxy', x: sx.id, y: y.id, sys: sys.id }, { hidden: true });
  const img = st.add({ k: 'image', data: png(20, 10), mime: 'image/png', at: { x: 320, y: 200 }, w: 100, h: 50 });
  st.page.transforms = [{ name: '开方', src: p.id, img: out.id }];
  return { st, p, out, img, sys };
}

describe('自定义变换作用于图片（方法 96）', () => {
  it.skipIf(!existsSync(FIXTURE))('读取原版四色夹具：左右交换落在横坐标 300–380，原样另存，重编码后模型一致', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const r = decodeGsp(bytes), page = r.doc.pages[0];
    const obj = page.objects[12];
    expect(obj.def).toMatchObject({ k: 'custom-image', img: page.objects[10].id, src: page.objects[11].id, pre: page.objects[6].id, samples: 240, distortion: 0.6 });
    expect(r.source.protectedReason).toBeUndefined();
    const st = new Store(r.doc);
    const s = st.results.get(obj.id)?.shape;
    if (s?.k !== 'box') throw Error('取样变换无定义');
    expect(s.at.x).toBeCloseTo(300); expect(s.at.x + s.w).toBeCloseTo(380);
    expect(s.at.y).toBeCloseTo(100); expect(s.at.y + s.h).toBeCloseTo(148);
    const m = s.image!.mesh!;
    expect([m.nx, m.ny]).toEqual([20, 12]);
    // 源图片左上角 (100,100) 映到右上角 (380,100)：纹理左右交换
    expect([m.pts[0], m.pts[1]]).toEqual([380, 100]);
    expect(encodeFile(r.doc, r.source)).toMatchObject({ ok: true });
    const again = decodeGsp(encodeGsp(r.doc));
    expect(compareContent(r.doc, again.doc)).toEqual([]);
  });

  it.skipIf(!existsSync(FIXTURE))('修改原版图片采样数与失真度时保留来源记录', () => {
    const bytes = readFileSync(FIXTURE);
    const original = Buffer.from(bytes);
    const input = decodeGsp(bytes);
    const st = new Store(input.doc);
    const obj = st.page.objects.find(o => o.def.k === 'custom-image')!;
    if (obj.def.k !== 'custom-image') throw Error();
    st.update(obj.id, { ...obj.def, samples: 400, distortion: 0.8 });
    const result = encodeFile(st.doc, input.source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ext).toBe('gsp');
    expect(result.bytes.length).toBe(input.source.bytes!.length);
    expect(bytes.equals(original)).toBe(true);
    expect(Buffer.from(input.source.bytes!).equals(original)).toBe(true);
    expect(decodeGsp(result.bytes).doc.pages[0].objects.find(o => o.id === obj.id)?.def)
      .toMatchObject({ k: 'custom-image', samples: 400, distortion: 0.8 });
  });

  it('局部无定义只少画对应格子，依赖保留；拖回有效位置后重新显示', () => {
    const { st, img, sys } = sqrtScene();
    const made = applyCustomTransform(st, st.page.transforms![0], [img.id]);
    st.recompute();
    const w = made[0];
    expect(w.def.k).toBe('custom-image');
    const full = drawn(st, w.id);
    expect(full).toBeGreaterThan(0);
    // 把坐标原点拖到图片中间：左半边横坐标为负，开方无定义
    const origin = st.get((sys.def as Extract<Def, { k: 'sys' }>).origin)!;
    st.update(origin.id, { k: 'free', x: 370, y: 300 }); st.recompute();
    const half = drawn(st, w.id);
    expect(half).toBeGreaterThan(0); expect(half).toBeLessThan(full * 0.7);
    // 整张图都在负半轴：对象无定义，但仍在页面上
    st.update(origin.id, { k: 'free', x: 500, y: 300 }); st.recompute();
    expect(st.results.get(w.id)?.status).toBe('undefined');
    expect(st.get(w.id)?.def.k).toBe('custom-image');
    st.update(origin.id, { k: 'free', x: 300, y: 300 }); st.recompute();
    expect(drawn(st, w.id)).toBe(full);
  });

  it('只经过内置变换的自定义变换给出普通变换图片', () => {
    const st = new Store();
    const p = st.add({ k: 'free', x: 10, y: 10 });
    const q = st.add({ k: 'translate', src: p.id, by: { mode: 'rect', dx: 2, dy: 0 } });
    const img = st.add({ k: 'image', data: png(4, 4), mime: 'image/png', at: { x: 50, y: 50 }, w: 40, h: 40 });
    const made = applyCustomTransform(st, { src: p.id, img: q.id }, [img.id]);
    expect(made.map(o => o.def.k)).toEqual(['translate']);
  });

  it('平移后的图片可继续应用非线性自定义变换', () => {
    const { st, img } = sqrtScene();
    const moved = st.add({ k: 'translate', src: img.id, by: { mode: 'rect', dx: 1, dy: 0 } });
    st.recompute();
    const [result] = applyCustomTransform(st, st.page.transforms![0], [moved.id]);
    st.recompute();
    expect(result.def).toMatchObject({ k: 'custom-image', src: moved.id, samples: 200 });
    expect(st.results.get(result.id)?.status).toBe('ok');
    expect(drawn(st, result.id)).toBeGreaterThan(0);
    const saved = encodeFile(st.doc, undefined);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const restored = new Store(decodeGsp(saved.bytes).doc);
    const image = restored.page.objects.find(o => o.def.k === 'custom-image');
    expect(image && restored.results.get(image.id)?.status).toBe('ok');
  });

  it('新建默认采样数取源图片像素数（上限 50000），可以写成原版格式并读回', () => {
    const { st, img } = sqrtScene();
    const [w] = applyCustomTransform(st, st.page.transforms![0], [img.id]);
    expect(w.def).toMatchObject({ samples: 200, distortion: 0.6 });
    const d = w.def as Extract<Def, { k: 'custom-image' }>;
    expect(d.body).toContain(d.img);
    expect(d.body).not.toContain(d.pre);
    st.recompute();
    const saved = encodeFile(st.doc, undefined);
    expect(saved).toMatchObject({ ok: true });
    if (!saved.ok) return;
    const back = decodeFile(saved.bytes, 'x.gsp').doc;
    const again = back.pages[0].objects.find((o: Obj) => o.def.k === 'custom-image');
    expect(again?.def).toMatchObject({ samples: 200, distortion: 0.6 });
  });

  it('命中测试只在画出的格子里', () => {
    const { st, img } = sqrtScene();
    const [w] = applyCustomTransform(st, st.page.transforms![0], [img.id]);
    st.recompute();
    const s = st.results.get(w.id)?.shape;
    if (s?.k !== 'box') throw Error();
    expect(hitAll(st.page, st.results, { x: s.at.x + s.w / 2, y: s.at.y + s.h / 2 }, 'mid')).toContain(w.id);
    expect(hitAll(st.page, st.results, { x: s.at.x - 30, y: s.at.y - 30 }, 'mid')).not.toContain(w.id);
  });

  it('再次变换时保留取样图片上新增的多边形裁剪', () => {
    const { st, img } = sqrtScene();
    const [first] = applyCustomTransform(st, st.page.transforms![0], [img.id]);
    st.recompute();
    const box = st.results.get(first.id)?.shape;
    if (box?.k !== 'box') throw Error('取样图片无定义');
    const points = [[box.at.x, box.at.y], [box.at.x + box.w / 2, box.at.y], [box.at.x + box.w / 2, box.at.y + box.h], [box.at.x, box.at.y + box.h]]
      .map(([x, y]) => st.add({ k: 'free', x, y }).id);
    const polygon = st.add({ k: 'poly', pts: points });
    const clipped = st.add({ k: 'image-clip', src: first.id, clip: polygon.id, size: [20, 10, 10, 10] });
    st.recompute();
    const [full] = applyCustomTransform(st, st.page.transforms![0], [first.id]);
    const [partial] = applyCustomTransform(st, st.page.transforms![0], [clipped.id]);
    st.recompute();
    expect(drawn(st, partial.id)).toBeGreaterThan(0);
    expect(drawn(st, partial.id)).toBeLessThan(drawn(st, full.id) * 0.7);
  });

  it('格数按采样数和长宽比分配，超过上限时按比例减少', () => {
    expect(warpGrid(240, 80, 48)).toEqual({ nx: 20, ny: 12 });
    const g = warpGrid(208077, 303, 200);
    expect((g.nx + 1) * (g.ny + 1)).toBeLessThanOrEqual(12000);
    expect(g.nx / g.ny).toBeCloseTo(303 / 200, 0);
  });
});
