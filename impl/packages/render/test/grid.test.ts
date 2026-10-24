import { CORE_VERSION } from '@gsp-plus/core';
import { describe, expect, it } from 'vitest';
import { RENDER_VERSION, drawGrid, versionInfo } from '../src/index';

/** 只记录调用的最小 2D 上下文替身，让测试不依赖浏览器。 */
function recordingContext() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.join(',')})`);
      };
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      calls.push(`${prop}=${String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('drawGrid', () => {
  it('先填充背景，再画网格线，并保持 save/restore 配对', () => {
    const { ctx, calls } = recordingContext();
    drawGrid(ctx, 100, 60);
    expect(calls[0]).toBe('save()');
    expect(calls).toContain('fillRect(0,0,100,60)');
    expect(calls.at(-1)).toBe('restore()');
    expect(calls.filter((c) => c === 'save()').length).toBe(calls.filter((c) => c === 'restore()').length);
  });

  it('竖线数 = floor(width/step)+1，横线数 = floor(height/step)+1', () => {
    const { ctx, calls } = recordingContext();
    drawGrid(ctx, 100, 60, { minorStep: 20, majorEvery: 5 });
    const moves = calls.filter((c) => c.startsWith('moveTo('));
    const vertical = moves.filter((c) => c.endsWith(',0)')).length; // moveTo(x,0)
    const horizontal = moves.filter((c) => c.startsWith('moveTo(0,')).length;
    expect(vertical).toBe(6); // x = 0,20,...,100
    expect(horizontal).toBe(4); // y = 0,20,40,60
  });

  it('参数不合法时抛出 RangeError', () => {
    const { ctx } = recordingContext();
    expect(() => drawGrid(ctx, 10, 10, { minorStep: 0 })).toThrow(RangeError);
    expect(() => drawGrid(ctx, 10, 10, { majorEvery: 0 })).toThrow(RangeError);
  });
});

describe('版本信息', () => {
  it('同时包含 render 与 core 版本', () => {
    expect(versionInfo()).toBe(`render ${RENDER_VERSION} / core ${CORE_VERSION}`);
  });
});
