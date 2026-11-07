/** 声音按钮：把一个（或两个）函数当作波形播放。一个函数是单声道，两个函数是左右声道（手册）。 */
import { evalFunction } from '../core/engine';
import type { Id } from '../core/model';
import type { DocView } from './docview';

const RATE = 22050, SECONDS = 1;
let ctx: AudioContext | undefined;

/** 函数在 [0, 1] 里来回穿过 0 的次数：声音函数要有足够多的振荡。 */
export function zeroCrossings(f: (x: number) => number | undefined): number {
  let last: number | undefined, n = 0;
  for (let i = 0; i <= 4000; i++) {
    const y = f(i / 4000); if (y === undefined || !Number.isFinite(y)) continue;
    if (last !== undefined && Math.sign(y) !== 0 && Math.sign(last) !== 0 && Math.sign(y) !== Math.sign(last)) n++;
    if (y !== 0) last = y;
  }
  return n;
}
export const valueFn = (v: DocView, id: Id) => (x: number) => evalFunction(v.store.page, v.store.results, id, x);
/** 没有明显振荡（零点少于 10 个）就很可能不是可听的函数，建立按钮前要问一声。 */
export const isAudible = (v: DocView, ids: Id[]) => ids.some(id => zeroCrossings(valueFn(v, id)) >= 10);

export function playFunctions(v: DocView, ids: Id[]) {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const chans = Math.min(2, ids.length), buf = ctx.createBuffer(chans, RATE * SECONDS, RATE);
    for (let c = 0; c < chans; c++) {
      const f = valueFn(v, ids[c]), data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) { const y = f(i / RATE); data[i] = y === undefined || !Number.isFinite(y) ? 0 : Math.max(-1, Math.min(1, y)); }
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
  } catch { /* 没有音频设备时不出声 */ }
}
