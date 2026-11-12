import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { compareContent } from '../src/gsp/semantic';
import { createSystem } from '../src/core/construct';
import { Store } from '../src/core/store';

/** 重新编码后再读回，对象的名字、颜色、线型、隐藏状态这些样式信息不能丢（全库强制重编码审计里数量最多的几类差异）。 */
describe('重编码保留对象样式和名字', () => {
  it('度量、计算、轨迹、函数图像的名字和“自定义标签”标志', () => {
    const st = new Store();
    const sys = createSystem(st).id;
    const a = st.add({ k: 'free', x: 100, y: 100 }), b = st.add({ k: 'free', x: 260, y: 140 });
    const path = st.add({ k: 'seg', a: a.id, b: b.id });
    const p = st.add({ k: 'onpath', path: path.id, t: 0.4 });
    const abscissa = st.add({ k: 'measure', m: 'abscissa', refs: [p.id, sys] }, { label: 'm[1]', labelShown: false });
    const ordinate = st.add({ k: 'measure', m: 'ordinate', refs: [p.id, sys] }, { label: '纵坐标', labelShown: true, toolLabel: true });
    const calc = st.add({ k: 'calc', unit: 'none', expr: { t: 'bin', op: '+', a: { t: 'ref', id: abscissa.id }, b: { t: 'ref', id: ordinate.id } } }, { label: '累积分数', labelShown: false });
    const q = st.add({ k: 'free', x: 100, y: 300 });
    const tail = st.add({ k: 'seg', a: p.id, b: b.id });
    const mid = st.add({ k: 'mid', seg: tail.id });
    st.add({ k: 'locus', driver: p.id, out: mid.id, samples: 50 }, { label: 'O', labelShown: false });
    const doc = st.doc;
    const back = decodeGsp(encodeGsp(doc)).doc;
    expect(compareContent(doc, back).filter(d => !d.path.endsWith('.at'))).toEqual([]);   // 没写位置的度量/计算读回时取缺省位置
    const byId = (id: number) => back.pages[0].objects.find(x => x.id === id)!;
    expect(byId(abscissa.id).label).toBe('m[1]');
    expect(byId(ordinate.id)).toMatchObject({ label: '纵坐标', labelShown: true, toolLabel: true });
    expect(byId(calc.id).label).toBe('累积分数');
    expect(q.id).toBeGreaterThan(0);
  });

  it('按钮颜色取自对象样式，新建按钮缺省为橙色', () => {
    const st = new Store();
    const fresh = st.add({ k: 'button', action: { type: 'link', page: 0, url: 'http://example.com' }, text: '链接', at: { x: 30, y: 30 }, w: 80, h: 20 });
    const green = st.add({ k: 'button', action: { type: 'link', page: 0, url: 'http://example.org' }, text: '绿色', at: { x: 30, y: 60 }, w: 80, h: 20 }, { style: { color: '#008000', pointSize: 1, width: 1, dash: 'solid' } });
    const custom = st.add({ k: 'button', action: { type: 'hideshow', targets: [], mode: 'toggle', first: 'hide' }, text: '按钮', at: { x: 30, y: 90 }, w: 80, h: 20 }, { style: { color: '#ff0000', pointSize: 1, width: 1, dash: 'solid' }, label: '按钮', toolLabel: true });
    expect(fresh.style.color).toBe('#ff8000');
    const back = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects;
    expect(back.find(o => o.id === fresh.id)!.style.color).toBe('#ff8000');
    expect(back.find(o => o.id === green.id)!.style.color).toBe('#008000');
    expect(back.find(o => o.id === custom.id)).toMatchObject({ toolLabel: true });
    expect(back.find(o => o.id === custom.id)!.style.color).toBe('#ff0000');
  });

  it('坐标轴的线型和线宽、横轴单位点的隐藏状态', () => {
    const st = new Store();
    const sys = createSystem(st);
    if (sys.def.k !== 'sys') throw Error();
    const axis = st.get(sys.def.axisX)!, unitX = st.get(sys.def.unitX)!;
    axis.style = { ...axis.style, dash: 'dot', width: 0 };
    unitX.hidden = true;
    const back = decodeGsp(encodeGsp(st.doc)).doc.pages[0].objects;
    expect(back.find(o => o.id === axis.id)!.style).toMatchObject({ dash: 'dot', width: 0 });
    expect(back.find(o => o.id === unitX.id)!.hidden).toBe(true);
    // 缺省的坐标轴（实线、线宽 1）保持不变
    const plain = new Store(); const s2 = createSystem(plain);
    if (s2.def.k !== 'sys') throw Error();
    const doc = plain.doc;
    expect(compareContent(doc, decodeGsp(encodeGsp(doc)).doc)).toEqual([]);
  });
});
