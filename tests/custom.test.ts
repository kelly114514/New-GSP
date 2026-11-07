import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { Store } from '../src/core/store';
import { applyCustomTransform, customChain } from '../src/core/construct';

const FIX = join(__dirname, '../../reference/raw/runtime/fixtures-v4');
const have = existsSync(join(FIX, 'ct_created.gsp'));
const load = (n: string) => new Uint8Array(readFileSync(join(FIX, `${n}.gsp`)));

describe.skipIf(!have)('自定义变换（原版采集 probe_misc2 / probe_custom2）', () => {
  it('创建后文件里记 9009：原象序号、象序号、名称', () => {
    const t1 = decodeGsp(load('ct_created')).doc.pages[0].transforms, t2 = decodeGsp(load('ct2_index')).doc.pages[0].transforms;
    expect(t1).toEqual([{ name: 'T1', src: 3, img: 5 }]);
    expect(t2).toEqual([{ name: 'T2', src: 4, img: 5 }]);   // 原象是第 4 个对象时，记的就是 4
  });
  it('重放：对新点应用，得到与原版相同的构造（新点 → 以同一镜面反射）', () => {
    const doc = decodeGsp(load('ct_created')).doc, st = new Store(doc);
    st.run('新点', () => { st.add({ k: 'free', x: 520, y: 120 }); });
    const before = st.page.objects.length;
    let made: { id: number; def: unknown }[] = [];
    st.run('应用', () => { made = applyCustomTransform(st, st.page.transforms![0], [before]); });
    expect(made.length).toBe(1);
    const orig = decodeGsp(load('ct_applied')).doc.pages[0].objects.slice(-1)[0];   // 原版：#7 = 反射(#6, #4)
    expect(made[0].def).toEqual({ ...(orig.def as object) });
    expect(st.page.objects.length).toBe(before + 1);
  });
  it('同时应用到两个点：后选的先出象（原版 ct2_two：#8 是 #7 的象，#9 是 #6 的象）', () => {
    const doc = decodeGsp(load('ct2_two')).doc.pages[0], st = new Store(decodeGsp(load('ct_created')).doc);
    st.run('点', () => { st.add({ k: 'free', x: 520, y: 120 }); st.add({ k: 'free', x: 540, y: 200 }); });
    let made: { def: { src?: number } }[] = [];
    st.run('应用', () => { made = applyCustomTransform(st, st.page.transforms![0], [6, 7]) as never; });
    expect(made.map(o => o.def.src)).toEqual(doc.objects.slice(-2).map(o => (o.def as { src?: number }).src));
  });
  it('象不依赖原象时没有可重放的链', () => {
    const st = new Store(decodeGsp(load('ct_created')).doc);
    expect(customChain(st, { src: 1, img: 2 })).toBeUndefined();
  });
  it('读后再写，记录原样读回', () => {
    const a = decodeGsp(load('ct_created')).doc, b = decodeGsp(encodeGsp(a)).doc;
    expect(b.pages[0].transforms).toEqual(a.pages[0].transforms);
  });
});

describe.skipIf(!have)('声音按钮与绘图函数（原版采集）', () => {
  it('声音按钮：A=8，父对象是函数，文字“听到函数 f”', () => {
    const o = decodeGsp(load('sound_1')).doc.pages[0].objects.find(x => x.def.k === 'button')!;
    expect(o.def).toMatchObject({ k: 'button', action: { type: 'sound', funcs: [1] }, text: '听到函数 f' });
    const back = decodeGsp(encodeGsp(decodeGsp(load('sound_1')).doc)).doc.pages[0].objects.find(x => x.def.k === 'button')!;
    expect(back.def).toMatchObject({ action: { type: 'sound', funcs: [1] } });
  });
});
