import { describe, expect, it } from 'vitest';
import { buildDemo } from '../tools/make-demo';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { Store } from '../src/core/store';

describe('综合演示课件', () => {
  it('所有对象都能求值；多页；包含按钮、表格、图片、函数、动画点', () => {
    const st = buildDemo();
    expect(st.doc.pages.length).toBe(2);
    const kinds = new Set(st.doc.pages.flatMap(p => p.objects.map(o => o.def.k)));
    for (const k of ['free', 'seg', 'poly', 'mid', 'inter', 'circle', 'measure', 'param', 'calc', 'onpath', 'table', 'button', 'image', 'text', 'func', 'plot', 'sys']) expect(kinds.has(k as never)).toBe(true);
    for (const page of st.doc.pages) { st.doc.current = st.doc.pages.indexOf(page); st.recompute(); for (const o of page.objects) expect(['ok'], `${o.def.k}#${o.id}`).toContain(st.results.get(o.id)?.status); }
  });
  it('保存成新版课件再打开，内容完全一致；含不能写成原版格式的内容时明确提示', () => {
    const st = buildDemo();
    const back = decodeFile(encodeNgsp(st.doc), '演示课件.ngsp').doc;
    expect(JSON.stringify(back)).toBe(JSON.stringify(st.doc));
    const enc = encodeFile(st.doc, undefined);
    expect(enc.ok).toBe(false);
  });
  it('拖动后重新计算，重心仍是三条中线的交点；撤消回到原状', () => {
    const st = buildDemo();
    st.doc.current = 0; st.recompute();
    const g = st.page.objects.find(o => o.label === 'G')!;
    const before = JSON.stringify(st.results.get(g.id)?.shape);
    st.begin('拖动'); st.moveFree(1, 250, 400); st.commit();
    const after = st.results.get(g.id)?.shape as { p: { x: number; y: number } };
    const a = { x: 250, y: 400 }, b = (st.results.get(2)!.shape as { p: { x: number; y: number } }).p, c = (st.results.get(3)!.shape as { p: { x: number; y: number } }).p;
    expect(after.p.x).toBeCloseTo((a.x + b.x + c.x) / 3, 6); expect(after.p.y).toBeCloseTo((a.y + b.y + c.y) / 3, 6);
    st.doUndo();
    expect(JSON.stringify(st.results.get(g.id)?.shape)).toBe(before);
    void Store;
  });
});
