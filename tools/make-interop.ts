/** 生成"全对象族"互读样本：新版写出 → 原版打开/另存 → 新版重读（见 reference/raw/runtime/interop_roundtrip.py）。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Store } from '../src/core/store';
import { createSystem, setGridStyle } from '../src/core/construct';
import { constructIteration } from '../src/core/iterate';
import { encodeGsp } from '../src/gsp/codec';

/** 生成 w×h 的纯色 PNG（互读样本用）。 */
export function makePng(w: number, h: number, rgb: [number, number, number]): string {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255; }
  const chunk = (t: string, d: Buffer) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

export function buildAll(parts: string[] = ['params', 'calc', 'func', 'plot', 'pv', 'new']): Store {
  const st = new Store();
  st.run('全部', () => {
    const A = st.add({ k: 'free', x: 200, y: 200 }, { label: 'A', labelShown: true }), B = st.add({ k: 'free', x: 420, y: 220 }), C = st.add({ k: 'free', x: 300, y: 400 }), D = st.add({ k: 'free', x: 560, y: 380 });
    const sAB = st.add({ k: 'seg', a: A.id, b: B.id }), sBC = st.add({ k: 'seg', a: B.id, b: C.id });
    st.add({ k: 'ray', a: C.id, b: D.id }); const lAD = st.add({ k: 'line', a: A.id, b: D.id });
    const cir = st.add({ k: 'circle', c: C.id, p: A.id });
    st.add({ k: 'mid', seg: sAB.id });
    st.add({ k: 'parallel', pt: D.id, line: sAB.id }); st.add({ k: 'perp', pt: D.id, line: sBC.id });
    st.add({ k: 'bisect', a: A.id, v: B.id, b: C.id });
    st.add({ k: 'onpath', path: sAB.id, t: 0.3 }); st.add({ k: 'onpath', path: cir.id, t: 1.2 }); st.add({ k: 'onpath', path: lAD.id, t: 0.5 });
    st.add({ k: 'inter', a: sAB.id, b: lAD.id, branch: 0 }); st.add({ k: 'inter', a: sBC.id, b: cir.id, branch: 0 });
    st.add({ k: 'arc3', a: A.id, b: B.id, c: D.id });
    const arc = st.add({ k: 'arc-circle', circle: cir.id, a: A.id, b: B.id });
    void arc;
    st.add({ k: 'poly', pts: [A.id, B.id, C.id] }); st.add({ k: 'circle-int', circle: cir.id });
    st.add({ k: 'translate', src: A.id, by: { mode: 'rect', dx: 1, dy: 2 } }); st.add({ k: 'translate', src: B.id, by: { mode: 'vector', from: A.id, to: C.id } });
    st.add({ k: 'translate', src: C.id, by: { mode: 'polar', dist: { fixed: 2 }, angle: { fixed: 45 } } });
    st.add({ k: 'rotate', src: A.id, center: C.id, angle: { mode: 'fixed', deg: 30 } }); st.add({ k: 'rotate', src: B.id, center: C.id, angle: { mode: 'marked', a: A.id, v: B.id, b: C.id } });
    st.add({ k: 'dilate', src: A.id, center: C.id, ratio: { mode: 'fixed', num: 0.5, den: 1 } }); st.add({ k: 'dilate', src: B.id, center: C.id, ratio: { mode: 'marked', a: sAB.id, b: sBC.id } });
    st.add({ k: 'reflect', src: D.id, mirror: sAB.id });
    for (const m of ['length'] as const) st.add({ k: 'measure', m, refs: [sAB.id] }, { at: { x: 20, y: 20 } });
    st.add({ k: 'measure', m: 'angle', refs: [A.id, B.id, C.id] }, { at: { x: 20, y: 44 } }); st.add({ k: 'measure', m: 'radius', refs: [cir.id] }, { at: { x: 20, y: 68 } });
    st.add({ k: 'measure', m: 'ratio', refs: [sAB.id, sBC.id] }, { at: { x: 20, y: 92 } });
    const sys = createSystem(st);
    if (parts.includes('n-rectgrid')) setGridStyle(st, sys, 'rect');
    if (parts.includes('n-trigrid')) setGridStyle(st, sys, 'tri'); st.add({ k: 'measure', m: 'ordinate', refs: [D.id, sys.id] }, { at: { x: 20, y: 116 } });
    const t = st.add({ k: 'param', name: 't', value: 2.5, unit: 'none', showEdit: true }, { at: { x: 20, y: 140 }, label: 't' });
    if (parts.includes('params')) { st.add({ k: 'param', name: 'a', value: 30, unit: 'angle', showEdit: true }, { at: { x: 20, y: 170 }, label: 'a' });
    st.add({ k: 'param', name: 'd', value: 4, unit: 'distance', showEdit: true }, { at: { x: 20, y: 200 }, label: 'd' }); }
    if (parts.includes('calc')) st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'bin', op: '*', a: { t: 'ref', id: t.id }, b: { t: 'num', v: 3 } }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 20, y: 230 } });
    const f = parts.includes('func') || parts.includes('plot') || parts.includes('new') || parts.includes('n-call') ? st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } }, { at: { x: 20, y: 260 }, label: 'f' }) : undefined;
    if (f && parts.includes('plot')) { const pl = st.add({ k: 'plot', func: f.id, sys: sys.id, lo: -15.74, hi: 15.74, samples: 750 }); st.add({ k: 'onpath', path: pl.id, t: 0.55 }); }
    const nw = (k: string) => parts.includes('new') || parts.includes(k);
    const font = { name: 'Microsoft YaHei', size: 16, bold: false, italic: false, underline: false, color: '#000000' };
    const triId = st.add({ k: 'poly', pts: [A.id, B.id, C.id] }).id;
    if (nw('n-poly')) { st.add({ k: 'onpath', path: triId, t: 0.4 }); st.add({ k: 'onpath', path: triId, t: 0.9 }); }
    const circ2 = st.add({ k: 'circle', c: C.id, p: D.id });
    if (nw('n-arc')) { const ar = st.add({ k: 'arc3', a: A.id, b: B.id, c: D.id }); st.add({ k: 'onpath', path: ar.id, t: 0.6 }); }
    if (nw('n-disk')) { const disk = st.add({ k: 'circle-int', circle: circ2.id }); st.add({ k: 'onpath', path: disk.id, t: 2.0 }); }
    const len = st.add({ k: 'measure', m: 'length', refs: [sAB.id] }, { at: { x: 20, y: 400 } });
    if (nw('n-trans')) {
      st.add({ k: 'translate', src: D.id, by: { mode: 'polar', dist: { m: len.id }, angle: { fixed: 30 } } });
      st.add({ k: 'translate', src: D.id, by: { mode: 'polar', dist: { fixed: 2 }, angle: { pts: [A.id, B.id, C.id] } } });
      st.add({ k: 'translate', src: D.id, by: { mode: 'polar', dist: { m: len.id }, angle: { pts: [A.id, B.id, C.id] } } });
    }
    const rt = st.add({ k: 'param', name: 'r', value: 2, unit: 'none', showEdit: true }, { at: { x: 20, y: 460 }, label: 'r' });
    if (nw('n-dil')) { st.add({ k: 'dilate', src: A.id, center: C.id, ratio: { mode: 'value', m: rt.id } }); const q1 = st.add({ k: 'free', x: 100, y: 100 }), q2 = st.add({ k: 'free', x: 200, y: 100 }), q3 = st.add({ k: 'free', x: 250, y: 100 }); st.add({ k: 'dilate', src: B.id, center: C.id, ratio: { mode: 'marked', a: q1.id, b: q2.id, c: q3.id } }); }
    if (nw('n-fn')) {
      st.add({ k: 'calc', expr: { t: 'fn', name: 'sqrt', a: { t: 'bin', op: '+', a: { t: 'ref', id: rt.id }, b: { t: 'num', v: 7 } } }, unit: 'none' }, { at: { x: 20, y: 490 } });
      st.add({ k: 'calc', expr: { t: 'bin', op: '*', a: { t: 'fn', name: 'sin', a: { t: 'num', v: 30 } }, b: { t: 'fn', name: 'abs', a: { t: 'neg', a: { t: 'ref', id: rt.id } } } }, unit: 'none' }, { at: { x: 20, y: 520 } });
    }
    if (nw('n-text')) {
      st.add({ k: 'text', text: '你好 abc', at: { x: 300, y: 500 }, w: 120, h: 30, font });
      st.add({ k: 'text', text: 'line1' + String.fromCharCode(10) + 'line2', at: { x: 300, y: 540 }, w: 120, h: 50, font });
      // 文本样式：粗体 + 斜体 + 下划线、字号、字体名（Arial、宋体）、颜色（原版采集 ts01、tc01）
      st.add({ k: 'text', text: '粗斜下划线', at: { x: 450, y: 500 }, w: 120, h: 30, font: { ...font, bold: true, italic: true, underline: true, size: 24 } });
      st.add({ k: 'text', text: 'Arial red', at: { x: 450, y: 540 }, w: 120, h: 30, font: { ...font, name: 'Arial', color: '#ff0000' } });
      st.add({ k: 'text', text: 't = 0 厘', at: { x: 0, y: 0 }, off: { x: 12, y: -30 }, anchor: B.id, refs: [t.id], w: 90, h: 24, font });
      st.add({ k: 'text', text: '宋体 紫', at: { x: 450, y: 580 }, w: 120, h: 30, font: { ...font, name: '宋体', color: '#8a66d9', size: 20 } });
    }
    if (nw('n-table')) { const len2 = st.add({ k: 'measure', m: 'length', refs: [sBC.id] }, { at: { x: 20, y: 424 } }); st.add({ k: 'table', cols: [len.id, len2.id], rows: [[5.29, 3.55], [5.29, 3.55]] }, { at: { x: 400, y: 440 } }); }
    if (nw('n-table')) st.add({ k: 'table', cols: [len.id], rows: [[Number((220.9 / (96 / 2.54)).toFixed(2))], [Number((220.9 / (96 / 2.54)).toFixed(2))]] }, { at: { x: 400, y: 400 } });
    if (f && nw('n-call')) st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'call', func: f.id, a: { t: 'num', v: 3 } }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 20, y: 290 } });
    if (nw('n-rotv')) { const pa = st.add({ k: 'param', name: 'ang', value: 40, unit: 'angle', showEdit: true }, { at: { x: 20, y: 230 }, label: 'ang' }); st.add({ k: 'rotate', src: A.id, center: C.id, angle: { mode: 'value', m: pa.id } }); }
    if (nw('n-img')) { st.add({ k: 'image', data: makePng(41, 23, [200, 30, 30]), mime: 'image/png', at: { x: 300, y: 520 }, w: 41, h: 23 }, {}); st.add({ k: 'image', data: makePng(30, 30, [30, 30, 200]), mime: 'image/png', at: { x: 400, y: 520 }, w: 60, h: 45 }, {}); }
    if (nw('n-eq')) { st.add({ k: 'measure', m: 'equation', refs: [lAD.id, sys.id] }, { at: { x: 400, y: 470 } }); st.add({ k: 'measure', m: 'equation', refs: [cir.id, sys.id] }, { at: { x: 400, y: 500 } }); }
    if (nw('n-coords')) { st.add({ k: 'plotxy', x: t.id, y: t.id, sys: sys.id }); st.add({ k: 'plotfix', sys: sys.id, x: 2, y: 3 }); st.add({ k: 'axispt', axis: 'x', value: t.id, sys: sys.id }); st.add({ k: 'axispt', axis: 'y', value: t.id, sys: sys.id }); st.add({ k: 'pointval', path: sAB.id, fixed: 0.25 }); st.add({ k: 'pointval', path: sBC.id, value: t.id }); }
    if (nw('n-coords')) st.add({ k: 'measure', m: 'coords', refs: [D.id, sys.id] }, { at: { x: 400, y: 440 } });
    if (nw('n-pcurve')) {   // 参数曲线：直角与极坐标各一条（原版采集 probe_curve2：方法 126/127）
      const fp = st.add({ k: 'func', name: 'p', param: 'x', expr: { t: 'x' } }, { at: { x: 20, y: 640 }, label: 'p' });
      const fq = st.add({ k: 'func', name: 'q', param: 'x', expr: { t: 'bin', op: '^', a: { t: 'x' }, b: { t: 'num', v: 2 } } }, { at: { x: 20, y: 664 }, label: 'q' });
      st.add({ k: 'pcurve', fx: fp.id, fy: fq.id, sys: sys.id, lo: 0, hi: 2, polar: false, samples: 750 });
      st.add({ k: 'pcurve', fx: fp.id, fy: fq.id, sys: sys.id, lo: 0, hi: 3, polar: true, samples: 750 });
    }
    if (nw('n-custom')) {   // 自定义变换：象点依赖原象点（原版采集 probe_misc2：记 9009）
      const im = st.add({ k: 'reflect', src: C.id, mirror: sAB.id });
      const im2 = st.add({ k: 'rotate', src: im.id, center: A.id, angle: { mode: 'fixed', deg: 40 } });
      (st.page.transforms ??= []).push({ name: 'T1', src: C.id, img: im2.id });
    }
    if (nw('n-sound')) {    // 声音按钮：A=8，父对象是函数
      const fs = st.add({ k: 'func', name: 'w', param: 'x', expr: { t: 'x' } }, { at: { x: 20, y: 700 }, label: 'w' });
      st.add({ k: 'button', action: { type: 'sound', funcs: [fs.id] }, text: '听到函数 w', at: { x: 120, y: 700 }, w: 100, h: 28 });
    }
    if (nw('n-itertable')) {   // 数值迭代 + 迭代数据表（原版采集 probe_itertable：方法 92）
      const nn = st.add({ k: 'param', name: 'k', value: 3, unit: 'none', showEdit: true }, { at: { x: 20, y: 740 }, label: 'k' });
      const cc = st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: nn.id }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 20, y: 764 } });
      constructIteration(st, { pre: [nn.id], maps: [[cc.id]], depth: { fixed: 3 }, table: true });
    }
    if (nw('n-link')) st.add({ k: 'button', action: { type: 'link', page: 0, url: 'https://example.org/lesson' }, text: '课件网页', at: { x: 400, y: 600 }, w: 90, h: 28 });
    if (nw('n-locus')) {
      const pp2 = st.add({ k: 'onpath', path: circ2.id, t: 1.0 }); const sg = st.add({ k: 'seg', a: pp2.id, b: B.id }); const md = st.add({ k: 'mid', seg: sg.id });
      const lc = st.add({ k: 'locus', driver: pp2.id, out: md.id, samples: 500 }); st.add({ k: 'onpath', path: lc.id, t: 0.3 }); st.add({ k: 'inter', a: lAD.id, b: lc.id, branch: 0 }); st.add({ k: 'inter', a: lc.id, b: sBC.id, branch: 1 });
    }
    if (nw('n-btn')) {
      const pp = st.add({ k: 'onpath', path: sAB.id, t: 0.5 });
      const bAnim = st.add({ k: 'button', action: { type: 'animate', targets: [pp.id], speed: 'medium', direction: 'bounce' }, text: '动画点', at: { x: 20, y: 560 }, w: 90, h: 28 });
      const bMove = st.add({ k: 'button', action: { type: 'move', from: A.id, to: B.id, speed: 'medium' }, text: '移动点', at: { x: 130, y: 560 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'series', buttons: [bAnim.id, bMove.id], mode: 'seq', deselect: true, stopAnim: true, seconds: 2 }, text: '系列1', at: { x: 680, y: 596 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'series', buttons: [bMove.id, bAnim.id], mode: 'together', clearTraces: true, after: 'duration', seconds: 3 }, text: '系列2', at: { x: 780, y: 596 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'scroll', point: C.id, where: 'topleft' }, text: '滚动点', at: { x: 240, y: 560 }, w: 90, h: 28 });
      const p2 = st.add({ k: 'onpath', path: sBC.id, t: 0.4 });
      st.add({ k: 'button', action: { type: 'animate', targets: [p2.id], speed: 'fast', direction: 'backward', once: true }, text: '动画2', at: { x: 350, y: 560 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'animate', targets: [p2.id], speed: 'slow', direction: 'random' }, text: '动画3', at: { x: 350, y: 596 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'move', from: C.id, to: D.id, speed: 'high', toInitial: true }, text: '移动2', at: { x: 460, y: 560 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'move', from: C.id, to: D.id, speed: 'slow' }, text: '移动3', at: { x: 460, y: 596 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'scroll', point: C.id, where: 'center' }, text: '滚动2', at: { x: 570, y: 560 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'hideshow', targets: [C.id], mode: 'show', first: 'show', fade: false, select: false }, text: '显示2', at: { x: 570, y: 596 }, w: 90, h: 28 });
      st.add({ k: 'button', action: { type: 'hideshow', targets: [D.id], mode: 'toggle', first: 'hide', fade: true, select: false }, text: '切换', at: { x: 680, y: 560 }, w: 90, h: 28 });
    }
    if (parts.includes('pv')) { st.add({ k: 'button', action: { type: 'hideshow', targets: [A.id, B.id], mode: 'hide' }, text: '隐藏点', at: { x: 20, y: 330 }, w: 90, h: 28 }); st.add({ k: 'button', action: { type: 'hideshow', targets: [A.id], mode: 'show' }, text: '显示点', at: { x: 130, y: 330 }, w: 90, h: 28 }); const pp = st.add({ k: 'onpath', path: sAB.id, t: 0.7 }); st.add({ k: 'measure', m: 'pointvalue', refs: [pp.id, sAB.id] }, { at: { x: 20, y: 290 } }); }
  });
  return st;
}
if (process.argv[1] && process.argv[1].includes('make-interop')) {
  const out = process.argv[2] ?? 'out';
  mkdirSync(out, { recursive: true });
  const st = buildAll();
  writeFileSync(join(out, 'interop-all.gsp'), encodeGsp(st.doc));
  console.log(`写出 ${join(out, 'interop-all.gsp')}：${st.page.objects.length} 个对象`);
  for (const part of ['none', 'params', 'calc', 'func', 'plot', 'pv', 'n-poly', 'n-arc', 'n-disk', 'n-trans', 'n-dil', 'n-fn', 'n-text', 'n-btn', 'n-table', 'n-coords', 'n-img', 'n-eq', 'n-pcurve', 'n-custom', 'n-sound', 'n-itertable', 'n-rectgrid', 'n-trigrid', 'n-rotv', 'n-call', 'n-link', 'n-locus']) writeFileSync(join(out, `part-${part}.gsp`), encodeGsp(buildAll(part === 'none' ? [] : part === 'plot' ? ['plot'] : [part]).doc));
}
