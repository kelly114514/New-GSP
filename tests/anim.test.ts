import { describe, expect, it } from 'vitest';
import { Animator, type AnimatorRuntime } from '../src/anim';
import { Store } from '../src/core/store';
import { buttonSize } from '../src/core/button';
import { animationScalar, makeParameterAnimation, parameterAnimation } from '../src/gsp/animation';
import { decodeGsp, encodeFile } from '../src/gsp/codec';

describe('原版动画记录', () => {
  it.each([[0.001875, 0.03], [0.625, 0.125], [1.2, 0.6], [2.4, 0.2], [10, 0.5], [12, 1], [307200, 300]])('将文件值 %s 换算成 %s', (field, rate) => {
    expect(animationScalar(Math.fround(field))).toBeCloseTo(rate, 5);
  });

  it('角度参数按钮通过正式保存入口读回相同的变化量、周期和范围', () => {
    const st = new Store();
    const angle = st.add({ k: 'param', name: 'a', value: 45, unit: 'angle', showEdit: true }, { at: { x: 10, y: 50 } });
    const action = makeParameterAnimation([angle.id], 'angle', 'forward', { amount: 90, interval: 0.25, min: 0, max: 180, discrete: true, once: true });
    st.add({ k: 'button', text: '动画', at: { x: 12, y: 12 }, ...buttonSize('动画'), action });
    const save = encodeFile(st.doc, undefined);
    if (!save.ok) throw new Error(save.reason);
    const button = decodeGsp(save.bytes).doc.pages[0].objects.find(o => o.def.k === 'button')?.def;
    expect(button).toMatchObject({ k: 'button', action: { type: 'animate', once: true } });
    if (button?.k !== 'button' || button.action.type !== 'animate') throw new Error('缺动画按钮');
    expect(parameterAnimation(button.action, 'angle')).toMatchObject({
      amount: expect.closeTo(90, 4), interval: 0.25, min: 0, max: expect.closeTo(180, 4), discrete: true, once: true,
    });
  });
});

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

  it('按原版文件值运行点动画，加速只作用于当前运行', () => {
    const h = harness(() => 0);
    h.animator.toggle(h.view as never, [h.free], Math.fround(1.2), 'forward');
    h.tick(1100);
    expect(h.st.ctx.posOverride?.get(h.free.id)?.x).toBeCloseTo(102.1);
    h.animator.speedFor(h.view as never, [h.free], 2);
    h.tick(1200);
    expect(h.st.ctx.posOverride?.get(h.free.id)?.x).toBeCloseTo(106.3);
    expect(h.free.def).toMatchObject({ x: 100 });
  });

  it('选择性的加速使用角度参数自己的速率', () => {
    const h = harness(() => 0);
    h.animator.toggle(h.view as never, [h.param], 'medium');
    h.animator.speedFor(h.view as never, [h.param], 2);
    h.tick(1100);
    expect(h.st.ctx.valOverride?.get(h.param.id)).toBe(16);
  });

  it('参数动画在范围内按速度连续变化，过端点后保留余量', () => {
    const h = harness(() => 0.5);
    const param = h.st.add({ k: 'param', name: 'p', value: 0.95, unit: 'none', showEdit: true });
    const button = makeParameterAnimation([param.id], 'none', 'forward', { amount: 1, interval: 1, min: 0, max: 1, discrete: false, once: false });
    h.animator.toggle(h.view as never, [param], button.speed, button.direction, button);
    h.tick(1100);
    expect(h.st.ctx.valOverride?.get(param.id)).toBeCloseTo(0.05);
    expect(param.def).toMatchObject({ value: 0.95 });
  });

  it('离散动画立即走一步，单次循环回到初值后停止', () => {
    const h = harness(() => 0.5);
    const param = h.st.add({ k: 'param', name: 'p', value: 1, unit: 'none', showEdit: true });
    const button = makeParameterAnimation([param.id], 'none', 'forward', { amount: 1, interval: 0.25, min: 0, max: 2, discrete: true, once: true });
    h.animator.toggle(h.view as never, [param], button.speed, button.direction, button);
    h.tick(1100);
    expect(h.st.ctx.valOverride?.get(param.id)).toBe(2);
    h.tick(1200);
    expect(h.st.ctx.valOverride?.get(param.id)).toBe(2);
    h.tick(1300);
    expect(h.st.ctx.valOverride?.get(param.id)).toBe(1);
    expect(h.animator.running).toBe(false);
  });

  it.each([['slow', 35], ['medium', 105], ['fast', 175]] as const)('移动按钮 %s 按页面像素匀速移动', (speed, rate) => {
    const h = harness(() => 0);
    const target = h.st.add({ k: 'free', x: 370, y: 100 });
    h.animator.moveTo(h.view as never, h.free.id, target.id, speed);
    h.tick(1100);
    expect(h.st.ctx.posOverride?.get(h.free.id)?.x).toBeCloseTo(100 + rate / 10);
    h.animator.setFactor(2);
    h.tick(1200);
    expect(h.st.ctx.posOverride?.get(h.free.id)?.x).toBeCloseTo(100 + 3 * rate / 10);
  });

  it('高速移动在首帧到达且可以撤消', () => {
    const h = harness(() => 0);
    const target = h.st.add({ k: 'free', x: 370, y: 100 });
    h.animator.moveTo(h.view as never, h.free.id, target.id, 'high');
    h.tick(1016);
    expect(h.st.get(h.free.id)?.def).toMatchObject({ x: 370, y: 100 });
    h.st.doUndo();
    expect(h.st.get(h.free.id)?.def).toMatchObject({ x: 100, y: 100 });
  });

  it('随机自由点在给定随机序列下可逐帧复现', () => {
    const values = [0, 0, 0.75]; let i = 0;
    const h = harness(() => values[i++ % values.length]);
    h.animator.toggle(h.view as never, [h.free], 'medium', 'random');
    h.tick(1100); // 触发随机换向量，角度 0
    expect(h.st.ctx.posOverride?.get(h.free.id)).toEqual({ x: 110.5, y: 100 });
  });
});
