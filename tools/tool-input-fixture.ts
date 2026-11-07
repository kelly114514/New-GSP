import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import { newDoc } from '../src/core/model';
import type { Tool } from '../src/core/tooling';

/** 给工具造输入：点放在一圈上，数值用参数。 */
export function toolInputFixture(tool: Tool): { st: Store; picks: number[] } {
  const st = new Store(newDoc('t')), picks: number[] = [];
  st.run('输入', () => tool.inputs.forEach((inp, i) => {
    if (inp.kind === 'system') { picks.push(createSystem(st, { x: 300, y: 260 }).id); return; }
    if (inp.kind === 'axis') { const sys = createSystem(st, { x: 300, y: 260 }).def; if (sys.k === 'sys') picks.push(sys.axisX); return; }
    if (inp.kind === 'function') { picks.push(st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '*', a: { t: 'x' }, b: { t: 'x' } } }, { at: { x: 20, y: 20 } }).id); return; }
    if (inp.kind === 'text') { picks.push(st.add({ k: 'text', text: '测试', at: { x: 20, y: 20 }, w: 80, h: 24, font: { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' } }).id); return; }
    if (inp.kind === 'plot-path') {
      const sys = createSystem(st).id;
      const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }).id;
      picks.push(st.add({ k: 'plot', func: f, sys, lo: -5, hi: 5, samples: 50 }).id); return;
    }
    if (inp.kind === 'iteration-image') {
      const a = st.add({ k: 'free', x: 300, y: 260 }).id;
      const b = st.add({ k: 'translate', src: a, by: { mode: 'rect', dx: 1, dy: 0 } }).id;
      const iter = st.add({ k: 'iterate', pre: [a], maps: [[b]], body: [b], depth: { fixed: 3 } }).id;
      picks.push(st.add({ k: 'iterimg', src: b, iter }).id); return;
    }
    if (inp.kind === 'number') { picks.push(st.add({ k: 'param', name: `p${i}`, value: 3, unit: 'none', showEdit: true }, { at: { x: 20, y: 20 + 20 * i } }).id); return; }
    const a = st.add({ k: 'free', x: 300 + 120 * Math.cos(i * 2.1 + 0.4), y: 260 + 110 * Math.sin(i * 2.1 + 0.4) });
    if (inp.kind === 'point' || inp.kind === 'object' || inp.kind === 'geometry') { picks.push(a.id); return; }
    const b = st.add({ k: 'free', x: 120 + 40 * i, y: 350 - 20 * i });
    if (inp.kind === 'curve' || inp.kind === 'path') { picks.push(st.add({ k: 'circle', c: a.id, p: b.id }).id); return; }
    if (inp.kind === 'polygon') { const c = st.add({ k: 'free', x: 140, y: 100 }).id; picks.push(st.add({ k: 'poly', pts: [a.id, b.id, c] }).id); return; }
    picks.push(st.add({ k: inp.kind === 'segment' ? 'seg' : 'line', a: a.id, b: b.id }).id);
  }));
  return { st, picks };
}
