import { describe, expect, it } from 'vitest';
import { buildPageDrawList, drawPageScene, fitView } from '../src/index';
import { loadSample } from './support/samples';

/** 记录调用的最小 2D 上下文替身。 */
function recordingContext() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.map((a) => (typeof a === 'number' ? String(Math.round(a * 100) / 100) : String(a))).join(',')})`);
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawPageScene', () => {
  it('segment.gsp：两个点各画一个圆，一条线段，save/restore 配对', () => {
    const list = buildPageDrawList(loadSample('segment.gsp').pages[0]!);
    const view = fitView(list.bounds, 800, 600);
    const { ctx, calls } = recordingContext();
    drawPageScene(ctx, list, view);
    expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(2);
    expect(calls.filter((c) => c === 'stroke()').length).toBe(1);
    expect(calls.filter((c) => c === 'save()').length).toBe(calls.filter((c) => c === 'restore()').length);
  });

  it('选中对象时多画高亮；有标签时调用 fillText', () => {
    const page = loadSample('midpoint.gsp').pages[0]!;
    const list = buildPageDrawList(page);
    const view = fitView(list.bounds, 800, 600);
    const plain = recordingContext();
    drawPageScene(plain.ctx, list, view);
    const selected = recordingContext();
    drawPageScene(selected.ctx, list, view, { selectedIndex: 3 });
    expect(selected.calls.length).toBeGreaterThan(plain.calls.length);
    expect(plain.calls.some((c) => c.startsWith('fillText('))).toBe(false);
  });
});
