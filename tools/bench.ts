/** 基准：1000 个普通几何对象，拖动一个自由点的重算耗时。 */
import { Store } from '../src/core/store';
const st = new Store();
st.run('x', () => {
  const pts: number[] = [];
  for (let i = 0; i < 250; i++) pts.push(st.add({ k: 'free', x: (i % 25) * 30, y: Math.floor(i / 25) * 30 }).id);
  for (let i = 0; i + 1 < 250; i++) st.add({ k: 'seg', a: pts[i], b: pts[i + 1] });
  for (let i = 0; i < 249; i++) st.add({ k: 'mid', seg: 251 + i });
  for (let i = 0; i < 250; i++) st.add({ k: 'circle', c: pts[i], p: pts[(i + 3) % 250] });
});
const times: number[] = [];
st.begin('drag');
for (let i = 0; i < 400; i++) { const t0 = performance.now(); st.moveFree(1, i % 200, i % 150); times.push(performance.now() - t0); }
st.commit();
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.floor(times.length * p)].toFixed(3);
console.log(`对象数 ${st.page.objects.length}；拖动重算耗时 中位 ${q(0.5)} ms，P95 ${q(0.95)} ms，最大 ${times[times.length - 1].toFixed(3)} ms（要求 P95 ≤ 33 ms）`);
// 最坏情况：被拖动的点是几乎所有对象的祖先
const st2 = new Store();
st2.run('x', () => { const c = st2.add({ k: 'free', x: 0, y: 0 }).id; for (let i = 0; i < 999; i++) { const p = st2.add({ k: 'free', x: i, y: i }).id; st2.add({ k: 'seg', a: c, b: p }); i++; } });
const t2: number[] = [];
st2.begin('drag'); for (let i = 0; i < 200; i++) { const t0 = performance.now(); st2.moveFree(1, i, i); t2.push(performance.now() - t0); } st2.commit();
t2.sort((a, b) => a - b);
console.log(`最坏情形（1000 个对象都依赖被拖动的点）：P95 ${t2[Math.floor(t2.length * 0.95)].toFixed(3)} ms`);
