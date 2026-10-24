import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  buildPageDrawList,
  distanceToSegment,
  fitView,
  hitTest,
  panView,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../src/index';
import type { View } from '../src/index';
import { loadSample } from './support/samples';

describe('视图变换', () => {
  it('fitView 让包围盒居中并留出边距（放大倍数不超过 2）', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 240, 140, 20);
    expect(v.scale).toBe(2);
    expect(worldToScreen(v, 0, 0)).toEqual({ x: 20, y: 20 });
    expect(worldToScreen(v, 100, 50)).toEqual({ x: 220, y: 120 });
  });

  it('fitView：内容太大时缩小到窗口内', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, 540, 240, 20);
    expect(v.scale).toBeCloseTo(0.5, 10); // (540-40)/1000
    const a = worldToScreen(v, 0, 0);
    const b = worldToScreen(v, 1000, 100);
    expect(a.x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(b.x).toBeLessThanOrEqual(520 + 1e-9);
  });

  it('fitView：没有内容或只有一个点时 scale = 1，并以中心为准', () => {
    expect(fitView(null, 300, 200)).toEqual({ scale: 1, offsetX: 150, offsetY: 100 });
    const one = fitView({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 300, 200);
    expect(one.scale).toBe(1);
    expect(worldToScreen(one, 5, 5)).toEqual({ x: 150, y: 100 });
  });

  it('zoomAt 保持光标下的世界点不动', () => {
    const v: View = { scale: 1, offsetX: 10, offsetY: -20 };
    const before = screenToWorld(v, 100, 100);
    const z = zoomAt(v, 100, 100, 2.5);
    expect(z.scale).toBeCloseTo(2.5, 10);
    const after = screenToWorld(z, 100, 100);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoomAt 的倍数被夹在最小和最大之间', () => {
    expect(zoomAt({ scale: 1, offsetX: 0, offsetY: 0 }, 0, 0, 1e9).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 1, offsetX: 0, offsetY: 0 }, 0, 0, 1e-9).scale).toBe(MIN_SCALE);
  });

  it('panView 只改偏移', () => {
    expect(panView({ scale: 2, offsetX: 1, offsetY: 2 }, 5, -3)).toEqual({ scale: 2, offsetX: 6, offsetY: -1 });
  });
});

describe('命中测试', () => {
  it('distanceToSegment：端点外侧取端点距离，中间取垂直距离', () => {
    expect(distanceToSegment(0, 0, 10, 0, 20, 0)).toBe(10);
    expect(distanceToSegment(15, 3, 10, 0, 20, 0)).toBe(3);
    expect(distanceToSegment(1, 1, 5, 5, 5, 5)).toBeCloseTo(Math.SQRT2 * 4, 9);
  });

  it('segment.gsp：点击自由点返回其序号，点击线段中部返回线段序号，空白返回 null', () => {
    const list = buildPageDrawList(loadSample('segment.gsp').pages[0]!);
    const v = fitView(list.bounds, 800, 600);
    const p1 = worldToScreen(v, 211, 147);
    const p2 = worldToScreen(v, 411, 281);
    expect(hitTest(list, v, p1.x, p1.y)).toBe(1);
    expect(hitTest(list, v, p2.x + 2, p2.y - 2)).toBe(2);
    const mid = worldToScreen(v, 311, 214);
    expect(hitTest(list, v, mid.x, mid.y)).toBe(3);
    expect(hitTest(list, v, 5, 5)).toBeNull();
  });
});
