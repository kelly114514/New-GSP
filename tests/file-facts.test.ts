/** 第十三轮逐工具实测得到的文件事实。原版样本放在 reference/raw，不在时跳过。 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';
import { newDoc } from '../src/core/model';
import { Store } from '../src/core/store';
import { applyTool, buildTool, toolInputLabel } from '../src/core/tooling';

/** 找到第 n 个指定标记的记录，返回数据在文件里的偏移。 */
function recordOffset(bytes: Uint8Array, tag: number, n = 0): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 4, seen = 0;
  while (i + 8 <= bytes.length) {
    const len = v.getUint32(i, true), t = v.getUint32(i + 4, true);
    if (t === tag && seen++ === n) return i + 8;
    i += 8 + len;
  }
  throw new Error(`没有记录 ${tag}`);
}
function pointDoc() {
  const st = new Store(newDoc('事实'));
  st.run('x', () => { st.add({ k: 'free', x: 100, y: 100 }); st.add({ k: 'free', x: 200, y: 100 }); });
  return st;
}

describe('页面和对象头', () => {
  it('隐藏值 2、3、4 都是隐藏', () => {
    for (const flag of [1, 2, 3, 4]) {
      const bytes = encodeGsp(pointDoc().doc), at = recordOffset(bytes, 2000);
      bytes[at + 2] = flag;
      expect(decodeGsp(bytes).doc.pages[0].objects[0].hidden).toBe(true);
    }
  });
  it('页记录偏移 4、6 是滚动位置，读写保留负值', () => {
    const st = pointDoc(); st.page.scroll = { x: 39, y: -12 };
    const bytes = encodeGsp(st.doc);
    expect(decodeGsp(bytes).doc.pages[0].scroll).toEqual({ x: 39, y: -12 });
  });
  it('900 偏移 16 是打开时显示的页', () => {
    const st = pointDoc(); st.doc.pages.push({ ...st.doc.pages[0], name: '第二页' }); st.doc.current = 1;
    expect(decodeGsp(encodeGsp(st.doc)).doc.current).toBe(1);
  });
});

describe('数值和路径', () => {
  it('计算的位置和精度在 2311 头里，带引用也能保留', () => {
    const st = pointDoc();
    st.run('x', () => {
      const t = st.add({ k: 'param', name: 't', value: 2.5, unit: 'none', showEdit: true }, { at: { x: 10, y: 10 }, decimals: 1 });
      st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: t.id }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 10, y: -7 }, decimals: 3 });
    });
    const back = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects;
    expect(back[2].decimals).toBe(1);
    expect(back[3].decimals).toBe(3);
    expect(back[3].at).toEqual({ x: 10, y: -7 });
  });
  it('函数形式写在 2311 偏移 46，x=f(y) 读写保留', () => {
    const st = pointDoc();
    st.run('x', () => { st.add({ k: 'func', name: 'f', param: 'x', form: 'x=f(y)', expr: { t: 'x' } }, { at: { x: 10, y: 10 } }); });
    const fn = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects[2].def;
    expect(fn.k === 'func' && fn.form).toBe('x=f(y)');
  });
  it('固定平移距离取像素值，不是显示值（单位可能是像素、英寸）', () => {
    const st = pointDoc();
    st.run('x', () => { st.add({ k: 'translate', src: 1, by: { mode: 'polar', angle: { fixed: 0 }, dist: { fixed: 1 } } }); });
    const bytes = encodeGsp(st.doc), at = recordOffset(bytes, 2003), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 模拟“5 像素”：像素值 5，显示值 5。
    v.setFloat64(at + 32, 5, true); v.setFloat64(at + 40, 5, true);
    const page = decodeGsp(bytes).doc.pages[0], s = evaluatePage(page).get(3)?.shape;
    expect(s?.k === 'pt' && s.p.x).toBeCloseTo(105);
  });
  it('标签记录偏移 4 是“在自定义工具中使用标签”', () => {
    const st = pointDoc();
    st.run('x', () => { const a = st.page.objects[0]; a.label = '重心'; a.labelShown = true; a.toolLabel = true; });
    expect(decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects[0].toolLabel).toBe(true);
  });
  const fixture = join(__dirname, '../../reference/raw/runtime/fixtures-v2/pp01-pathpoints.gsp');
  it.skipIf(!existsSync(fixture))('圆上点第二分量是 sinθ：真实鼠标点在圆心正上方，文件存 +1', () => {
    const page = decodeGsp(new Uint8Array(readFileSync(fixture))).doc.pages[0], res = evaluatePage(page);
    const point = res.get(4)?.shape, path = page.objects.find(o => o.id === 4)?.def;
    const circle = path?.k === 'onpath' ? res.get(path.path)?.shape : undefined;
    if (point?.k !== 'pt' || circle?.k !== 'circle') throw new Error('样本结构变了');
    expect(point.p.y).toBeLessThan(circle.c.c.y);
  });
});

describe('应用工具的规则（原版逐工具实测）', () => {
  const style = { color: '#000000', width: 1, pointSize: 1, dash: 'solid' as const };
  const objects = [
    { id: 1, def: { k: 'free' as const, x: 0, y: 0 }, style, hidden: false, labelShown: false, label: '中心', toolLabel: true, src: { m: 0, c: 1, k: 4 } },
    { id: 2, def: { k: 'translate' as const, src: 1, by: { mode: 'rect' as const, dx: 1, dy: 0 } }, style, hidden: false, labelShown: true, label: 'B' },
    { id: 3, def: { k: 'translate' as const, src: 2, by: { mode: 'rect' as const, dx: 1, dy: 0 } }, style, hidden: false, labelShown: true, label: '终点', toolLabel: true },
    { id: 4, def: { k: 'translate' as const, src: 3, by: { mode: 'rect' as const, dx: 1, dy: 0 } }, style, hidden: true, labelShown: false, label: 'K' },
  ];
  const tool = buildTool({ name: 't', prereq: [1] }, { name: '1', objects, nextId: 5, labelCounter: 0, scroll: { x: 0, y: 0 } });
  it('显示的自动标签重新分配，作者保留的标签不变，不显示的不带入', () => {
    const st = new Store(newDoc('t'));
    const made = st.run('工具', () => { const a = st.add({ k: 'free', x: 10, y: 10 }); return applyTool(st, tool, [a.id], () => ({ x: 0, y: 0 })); });
    expect(made.map(o => o.label)).toEqual(['A', '终点']);
    expect(st.page.objects.at(-1)?.label).toBeUndefined();
  });
  it('作者保留标签的前提，新建点时带上标签', () => {
    expect(toolInputLabel(tool, 1)).toBe('中心');
  });
});
