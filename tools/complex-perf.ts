import { Store } from '../src/core/store';
import type { Id } from '../src/core/model';
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

function measure(name: string, st: Store, driver: Id, detail: string) {
  st.begin('benchmark'); const times: number[] = [];
  for (let i = 0; i < 25; i++) { const t = performance.now(); st.moveFree(driver, 100 + i, 100 + i); st.recompute([driver]); const dt = performance.now() - t; if (i >= 5) times.push(dt); }
  st.cancel(); times.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, detail, objects: st.page.objects.length, p50: times[9], p95: times[18], max: times[19], unit: 'ms', scope: 'moveFree + recompute; no drawing' }));
}
function locus() {
  const s = new Store(); let a = 0;
  s.run('setup', () => { a = s.add({ k: 'free', x: 100, y: 100 }).id; const b = s.add({ k: 'free', x: 400, y: 100 }).id; const seg = s.add({ k: 'seg', a, b }).id; const p = s.add({ k: 'onpath', path: seg, t: .5 }).id; let out = p; for (let i = 0; i < 30; i++) { const line = s.add({ k: 'seg', a: out, b }).id; out = s.add({ k: 'mid', seg: line }).id; } s.add({ k: 'locus', driver: p, out, samples: 2000 }); });
  measure('复杂轨迹', s, a, '2000 采样，30 层中点依赖');
}
function fractal() {
  const s = new Store(); let a = 0;
  s.run('setup', () => { a = s.add({ k: 'free', x: 100, y: 100 }).id; const b = s.add({ k: 'free', x: 400, y: 100 }).id; const seg = s.add({ k: 'seg', a, b }).id; const mid = s.add({ k: 'mid', seg }).id; const it = s.add({ k: 'iterate', pre: [a, b], maps: [[a, mid], [mid, b]], body: [seg, mid], depth: { fixed: 10 } }).id; s.add({ k: 'iterimg', src: seg, iter: it }); });
  measure('二叉分形', s, a, '10 层二叉迭代，2046 个迭代状态及线段像');
}
function largeTool() {
  const s = new Store(); let a = 0; s.run('setup', () => { a = s.add({ k: 'free', x: 100, y: 100 }).id; const b = s.add({ k: 'free', x: 400, y: 100 }).id; let p = a; for (let i = 0; i < 500; i++) { const seg = s.add({ k: 'seg', a: p, b }).id; p = s.add({ k: 'mid', seg }).id; } });
  measure('大依赖链', s, a, '500 层线段中点，模拟大工具展开后的依赖链');
}
function capturedIteration() {
  const bytes = readFileSync('../reference/raw/runtime/fixtures-v3/i06.gsp');
  const st = new Store(decodeGsp(bytes).doc);
  const iter = st.page.objects.find(o => o.def.k === 'iterate');
  if (!iter || iter.def.k !== 'iterate') throw Error('缺少迭代对象');
  iter.def.depth = { fixed: 10 }; st.recompute();
  measure('采集样本扩展迭代', st, 1, 'i06 双映射，内存中将深度从 3 改为 10；不修改样本');
}
locus(); fractal(); largeTool(); capturedIteration();
