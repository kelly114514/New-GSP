/** 生成演示课件（自制内容）：构造、度量、参数与计算、函数图像、表格、按钮、动画、多页、图片、文本。
 * 用法：npx tsx tools/make-demo.ts [输出目录]   输出 演示课件.ngsp（完整）与 演示课件-几何页.gsp（原版格式可保存的部分）。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSystem } from '../src/core/construct';
import type { Doc, FontSpec } from '../src/core/model';
import { Store } from '../src/core/store';
import { encodeNgsp, encodeGsp } from '../src/gsp/codec';

const font: FontSpec = { name: 'Microsoft YaHei', size: 16, bold: false, italic: false, underline: false, color: '#1a3d6e' };
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function buildDemo(): Store {
  const st = new Store();
  st.doc.name = '演示课件';
  st.run('第 1 页：三角形、中线与重心', () => {
    const A = st.add({ k: 'free', x: 220, y: 420 }, { label: 'A', labelShown: true }), B = st.add({ k: 'free', x: 560, y: 420 }, { label: 'B', labelShown: true }), C = st.add({ k: 'free', x: 360, y: 170 }, { label: 'C', labelShown: true });
    const AB = st.add({ k: 'seg', a: A.id, b: B.id }), BC = st.add({ k: 'seg', a: B.id, b: C.id }), CA = st.add({ k: 'seg', a: C.id, b: A.id });
    st.add({ k: 'poly', pts: [A.id, B.id, C.id] }, { style: { color: '#8a66d9', pointSize: 2, width: 2, dash: 'solid', fillAlpha: 0.35 } });
    const MA = st.add({ k: 'mid', seg: BC.id }, { label: 'D', labelShown: true }), MB = st.add({ k: 'mid', seg: CA.id }, { label: 'E', labelShown: true }), MC = st.add({ k: 'mid', seg: AB.id }, { label: 'F', labelShown: true });
    const m1 = st.add({ k: 'seg', a: A.id, b: MA.id }, { style: { color: '#c03030', pointSize: 2, width: 1, dash: 'dash' } }), m2 = st.add({ k: 'seg', a: B.id, b: MB.id }, { style: { color: '#c03030', pointSize: 2, width: 1, dash: 'dash' } });
    st.add({ k: 'seg', a: C.id, b: MC.id }, { style: { color: '#c03030', pointSize: 2, width: 1, dash: 'dash' } });
    const G = st.add({ k: 'inter', a: m1.id, b: m2.id, branch: 0 }, { label: 'G', labelShown: true });
    st.add({ k: 'circle', c: G.id, p: MA.id });
    const L1 = st.add({ k: 'measure', m: 'length', refs: [AB.id] }, { at: { x: 24, y: 24 } });
    st.add({ k: 'measure', m: 'angle', refs: [B.id, A.id, C.id] }, { at: { x: 24, y: 52 } });
    const t = st.add({ k: 'param', name: 't', value: 1.5, unit: 'none', showEdit: true }, { at: { x: 24, y: 84 }, label: 't' });
    st.add({ k: 'calc', expr: { t: 'bin', op: '*', a: { t: 'ref', id: L1.id }, b: { t: 'ref', id: t.id } }, unit: 'none' }, { at: { x: 24, y: 112 } });
    const walker = st.add({ k: 'onpath', path: BC.id, t: 0.2 }, { label: 'P', labelShown: true, trace: false, anim: { speed: 'medium', direction: 'bounce' } });
    st.add({ k: 'measure', m: 'distance', refs: [A.id, walker.id] }, { at: { x: 24, y: 140 } });
    const tb = st.add({ k: 'table', cols: [L1.id, t.id], rows: [[5.8, 1.5]] }, { at: { x: 640, y: 40 } });
    void tb;
    st.add({ k: 'text', text: '三角形的三条中线交于重心 G。\n拖动 A、B、C 观察。', at: { x: 600, y: 440 }, w: 280, h: 60, font });
    st.add({ k: 'button', action: { type: 'hideshow', targets: [m1.id, m2.id], mode: 'hide' }, text: '隐藏中线', at: { x: 24, y: 700 }, w: 110, h: 28 });
    st.add({ k: 'button', action: { type: 'animate', targets: [walker.id], speed: 'medium', direction: 'bounce' }, text: '动画点 P', at: { x: 150, y: 700 }, w: 110, h: 28 });
    st.add({ k: 'image', data: RED_PNG, mime: 'image/png', at: { x: 620, y: 600 }, w: 90, h: 60 });
  });
  st.run('第 2 页：函数与坐标系', () => {
    st.addPage(false);
    const sys = createSystem(st, { x: 400, y: 330 });
    st.update(sys.id, { ...(sys.def as Extract<typeof sys.def, { k: 'sys' }>), showGrid: true });
    const a = st.add({ k: 'param', name: 'a', value: 2, unit: 'none', showEdit: true }, { at: { x: 24, y: 24 }, label: 'a' });
    const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '*', a: { t: 'ref', id: a.id }, b: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } } }, { at: { x: 24, y: 56 }, label: 'f' });
    st.add({ k: 'plot', func: f.id, sys: sys.id, samples: 600 }, { style: { color: '#000080', pointSize: 2, width: 2, dash: 'solid' } });
    const g = st.add({ k: 'func', name: 'g', param: 'x', expr: { t: 'fn', name: 'sin', a: { t: 'x' } } }, { at: { x: 24, y: 88 }, label: 'g' });
    st.add({ k: 'plot', func: g.id, sys: sys.id, samples: 600 }, { style: { color: '#c03030', pointSize: 2, width: 2, dash: 'solid' } });
    const p = st.add({ k: 'free', x: 480, y: 250 }, { label: 'P', labelShown: true });
    st.add({ k: 'measure', m: 'abscissa', refs: [p.id, sys.id] }, { at: { x: 24, y: 120 } });
    st.add({ k: 'measure', m: 'ordinate', refs: [p.id, sys.id] }, { at: { x: 24, y: 148 } });
    st.add({ k: 'button', action: { type: 'link', page: 1 }, text: '回到第 1 页', at: { x: 24, y: 700 }, w: 120, h: 28 });
  });
  st.doc.current = 0;
  st.recompute();
  st.resetHistory();
  return st;
}

if (process.argv[1]?.includes('make-demo')) {
  const out = process.argv[2] ?? 'demo';
  mkdirSync(out, { recursive: true });
  const st = buildDemo();
  writeFileSync(join(out, '演示课件.ngsp'), encodeNgsp(st.doc));
  // 原版格式：只带第 1 页里能写成原版格式的对象（两列表格、图片除外）
  const gsp: Doc = JSON.parse(JSON.stringify(st.doc));
  gsp.pages = [gsp.pages[0]];
  gsp.pages[0].objects = gsp.pages[0].objects.filter(o => !['table', 'image'].includes(o.def.k));
  try { writeFileSync(join(out, '演示课件-几何页.gsp'), encodeGsp(gsp)); console.log('已写出 演示课件.ngsp 和 演示课件-几何页.gsp'); }
  catch (e) { console.log('演示课件.ngsp 已写出；.gsp 版本跳过：', (e as Error).message); }
}
