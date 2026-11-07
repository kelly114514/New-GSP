import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { constructPointOnPath, createSystem, dragSysUnit, ptOf } from '../src/core/construct';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';

describe('坐标轴上的点：拖动单位点后保持页面位置（原版行为，进度 第六轮 ③）', () => {
  it('点在原点右侧 100 像素；把单位点拖远，点的页面位置不变', () => {
    const st = new Store();
    let pt = 0, sysId = 0;
    st.run('场景', () => {
      const sys = createSystem(st, { x: 200, y: 300 }); sysId = sys.id;
      const axisX = (sys.def as { axisX: number }).axisX;
      pt = constructPointOnPath(st, axisX, { x: 300, y: 300 })!.id;
    });
    expect(st.get(pt)!.def).toMatchObject({ k: 'onpath', abs: true });
    const before = ptOf(st, pt)!;
    expect(before.x).toBeCloseTo(300, 6); expect(before.y).toBeCloseTo(300, 6);
    st.run('拖单位点', () => { const sys = st.get(sysId)!; dragSysUnit(st, sys, (sys.def as { unitX: number }).unitX, { x: 600, y: 300 }); st.recompute(); });
    const after = ptOf(st, pt)!;
    expect(after.x).toBeCloseTo(300, 6); expect(after.y).toBeCloseTo(300, 6);
  });
  it('写成 .gsp 再读回：位置不变', () => {
    const st = new Store();
    st.run('场景', () => { const sys = createSystem(st, { x: 200, y: 300 }); constructPointOnPath(st, (sys.def as { axisX: number }).axisX, { x: 340, y: 300 }); });
    const back = decodeGsp(encodeGsp(st.doc)).doc, st2 = new Store(back);
    const o = back.pages[0].objects.find(x => x.def.k === 'onpath')!;
    expect(ptOf(st2, o.id)!.x).toBeCloseTo(340, 3);
  });
});
