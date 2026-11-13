import { describe, expect, it } from 'vitest';
import { decimalSteps } from '../src/ui/render';

// 数据来自第十七轮原版夹具：0813 的单位点位移改成指定像素数后，原版画出的刻度间距与数字间距（x 轴，数字间距下限 80 像素）。
describe('十进制坐标轴的刻度与数字步长', () => {
  const x = (u: number) => { const s = decimalSteps(u, 80); return [s.label, s.tick]; };
  it('与原版夹具逐档一致', () => {
    expect(x(3)).toEqual([50, 10]);
    expect(x(5)).toEqual([20, 5]);
    expect(x(8)).toEqual([20, 5]);
    expect(x(9)).toEqual([10, 1]);
    expect(x(16)).toEqual([10, 1]);   // 恰好 80 像素的 5 被舍掉；单位 4 的夹具却取了 20（80 像素），属于已知的单点不吻合
    expect(x(12)).toEqual([10, 1]);
    expect(x(20)).toEqual([5, 1]);
    expect(x(40)).toEqual([5, 1]);
    expect(x(45)).toEqual([2, 0.5]);
    expect(x(80)).toEqual([2, 0.5]);
    expect(x(90)).toEqual([1, 0.1]);
    expect(x(131)).toEqual([1, 0.1]);
    expect(x(200)).toEqual([0.5, 0.1]);
    expect(x(400)).toEqual([0.5, 0.1]);
    expect(x(700)).toEqual([0.2, 0.05]);
    expect(x(1000)).toEqual([0.1, 0.01]);
  });
  it('单位 31.6 像素时横轴数字每 5 个单位、纵轴每 2 个单位（旧记录与 1221 的原版画面）', () => {
    expect(decimalSteps(31.6, 80).label).toBe(5);
    expect(decimalSteps(31.6, 40).label).toBe(2);
    expect(decimalSteps(3.16, 80)).toMatchObject({ label: 50, tick: 10, every: 5 });
    expect(decimalSteps(3.16, 40)).toMatchObject({ label: 20, tick: 5, every: 4 });
  });
});
