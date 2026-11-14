import { describe, expect, it } from 'vitest';
import { Animator, type AnimatorRuntime } from '../src/anim';
import { Store } from '../src/core/store';

function harness(random: () => number) {
  const st = new Store(), free = st.add({ k: 'free', x: 100, y: 100 }), param = st.add({ k: 'param', name: 'a', value: 10, unit: 'angle', showEdit: true });
  st.recompute();
  let queued: FrameRequestCallback | undefined, now = 1000, frame = 1;
  const runtime: AnimatorRuntime = {
    now: () => now, random,
    requestFrame(cb) { queued = cb; return frame++; }, cancelFrame() { queued = undefined; },
  };
  const view = { store: st, viewRect: () => ({ x0: 0, y0: 0, x1: 1000, y1: 1000 }), invalidate() {} };
  const app = { motion: { show() {}, refresh() {} }, refresh() {} };
  const animator = new Animator(app as never, runtime);
  const tick = (at: number) => { now = at; (animator as unknown as { tick(t: number): void }).tick(at); };
  return { st, free, param, view, animator, tick, queued: () => queued };
}

describe('动画的可控时钟与随机源', () => {
  it('自由点的初始方向可复现，位移按传入时间推进', () => {
    const h = harness(() => 0.25); // 朝屏幕下方
    h.animator.toggle(h.view as never, [h.free], 'medium', 'forward');
    expect(h.queued()).toBeTypeOf('function');
    h.tick(1100);
    expect(h.st.ctx.posOverride?.get(h.free.id)).toEqual({ x: 100, y: 110.5 });
  });

  it('角度参数每秒推进 30 度，反向时速度符号翻转', () => {
    const h = harness(() => 0.5);
    h.animator.toggle(h.view as never, [h.param], 'medium', 'backward');
    h.tick(1100);
    expect(h.st.ctx.valOverride?.get(h.param.id)).toBe(7);
  });

  it('随机自由点在给定随机序列下可逐帧复现', () => {
    const values = [0, 0, 0.75]; let i = 0;
    const h = harness(() => values[i++ % values.length]);
    h.animator.toggle(h.view as never, [h.free], 'medium', 'random');
    h.tick(1100); // 触发随机换向量，角度 0
    expect(h.st.ctx.posOverride?.get(h.free.id)).toEqual({ x: 110.5, y: 100 });
  });
});
