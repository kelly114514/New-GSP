import { describe, expect, it } from 'vitest';
import { remapDef } from '../src/core/remap';
import type { Def } from '../src/core/model';

const map = new Map([[1, 101], [2, 102], [3, 103], [24, 124], [48, 148]]);
describe('remapDef：只替换引用，不动坐标和数值', () => {
  it('自由点、文本、按钮的坐标不会被当成对象编号', () => {
    expect(remapDef({ k: 'free', x: 1, y: 2 }, map)).toEqual({ k: 'free', x: 1, y: 2 });
    const t: Def = { k: 'text', text: 'a', at: { x: 24, y: 48 }, w: 10, h: 10, font: { name: 'x', size: 1, bold: false, italic: false, underline: false, color: '#000' } };
    expect((remapDef(t, map) as typeof t).at).toEqual({ x: 24, y: 48 });
    expect(remapDef({ k: 'param', name: 't', value: 2, unit: 'none', showEdit: true }, map)).toMatchObject({ value: 2 });
  });
  it('plotxy 的 x、y 是引用；多边形顶点、迭代的数组引用都会替换', () => {
    expect(remapDef({ k: 'plotxy', x: 1, y: 2, sys: 3 }, map)).toEqual({ k: 'plotxy', x: 101, y: 102, sys: 103 });
    expect(remapDef({ k: 'poly', pts: [1, 2, 3] }, map)).toEqual({ k: 'poly', pts: [101, 102, 103] });
    expect(remapDef({ k: 'iterate', pre: [1], maps: [[2]], body: [3], depth: { param: 24 } }, map)).toEqual({ k: 'iterate', pre: [101], maps: [[102]], body: [103], depth: { param: 124 } });
    expect(remapDef({ k: 'iterimg', src: 1, iter: 2 }, map)).toEqual({ k: 'iterimg', src: 101, iter: 102 });
  });
  it('不改原定义；没有映射的引用保持不变', () => {
    const d: Def = { k: 'seg', a: 1, b: 99 };
    const r = remapDef(d, map);
    expect(r).toEqual({ k: 'seg', a: 101, b: 99 });
    expect(d).toEqual({ k: 'seg', a: 1, b: 99 });
  });
});
