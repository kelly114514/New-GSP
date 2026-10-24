import { describe, expect, it } from 'vitest';
import { buildPageDrawList, colorRefToCss } from '../src/index';
import { loadSample } from './support/samples';

describe('colorRefToCss（COLORREF 0x00BBGGRR）', () => {
  it('低字节是红色', () => {
    expect(colorRefToCss(255)).toBe('rgb(255, 0, 0)');
  });
  it('0x800000 是蓝色分量 128', () => {
    expect(colorRefToCss(0x800000)).toBe('rgb(0, 0, 128)');
  });
});

describe('buildPageDrawList（基准样本）', () => {
  it('segment.gsp → 2 个点 + 1 条线段，全部画出', () => {
    const page = loadSample('segment.gsp').pages[0]!;
    const list = buildPageDrawList(page);
    const points = list.items.filter((i) => i.kind === 'point');
    const segments = list.items.filter((i) => i.kind === 'segment');
    expect(points).toEqual([
      { kind: 'point', index: 1, x: 211, y: 147, color: 'rgb(255, 0, 0)', label: undefined },
      { kind: 'point', index: 2, x: 411, y: 281, color: 'rgb(255, 0, 0)', label: undefined },
    ]);
    // 线段的父序列是 [2, 1]：端点按父序列次序给出
    expect(segments).toEqual([
      { kind: 'segment', index: 3, x1: 411, y1: 281, x2: 211, y2: 147, color: 'rgb(0, 0, 128)' },
    ]);
    expect(list.objectCount).toBe(3);
    expect([...list.drawnIndices].sort()).toEqual([1, 2, 3]);
    expect(list.unsupportedIndices).toEqual([]);
    expect(list.bounds).toEqual({ minX: 211, minY: 147, maxX: 411, maxY: 281 });
  });

  it('midpoint.gsp → 2 个点 + 1 条线段；中点计为暂不支持', () => {
    const page = loadSample('midpoint.gsp').pages[0]!;
    const list = buildPageDrawList(page);
    expect(list.items.filter((i) => i.kind === 'point')).toHaveLength(2);
    expect(list.items.filter((i) => i.kind === 'segment')).toHaveLength(1);
    expect(list.objectCount).toBe(4);
    expect(list.unsupportedIndices).toEqual([4]);
    expect([...list.drawnIndices].sort()).toEqual([1, 2, 3]);
  });

  it('midpoint-moved.gsp 的自由点取移动后的坐标', () => {
    const list = buildPageDrawList(loadSample('midpoint-moved.gsp').pages[0]!);
    const first = list.items.find((i) => i.kind === 'point' && i.index === 1);
    expect(first).toMatchObject({ x: 251, y: 174 });
  });

  it('point.gsp → 1 个点，没有线段', () => {
    const list = buildPageDrawList(loadSample('point.gsp').pages[0]!);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'point', x: 211, y: 147 });
    expect(list.bounds).toEqual({ minX: 211, minY: 147, maxX: 211, maxY: 147 });
  });

  it('empty.gsp → 空列表，包围盒为 null', () => {
    const list = buildPageDrawList(loadSample('empty.gsp').pages[0]!);
    expect(list.items).toEqual([]);
    expect(list.bounds).toBeNull();
    expect(list.objectCount).toBe(0);
    expect(list.unsupportedIndices).toEqual([]);
  });

  it('线段的某个父对象不是自由点时不画，计为暂不支持', () => {
    const page = loadSample('segment.gsp').pages[0]!;
    // 去掉第 2 个对象（自由点）：线段的父 2 不再有坐标
    const broken = { ...page, objects: page.objects.filter((o) => o.index !== 2) };
    const list = buildPageDrawList(broken);
    expect(list.items.filter((i) => i.kind === 'segment')).toEqual([]);
    expect(list.unsupportedIndices).toEqual([3]);
  });

  it('自由点的标签文字原样带到绘制项（空标签为 undefined）', () => {
    const page = loadSample('segment.gsp').pages[0]!;
    const first = page.objects[0]!;
    const withLabel = { ...first, label: { ...first.label!, text: '甲' } };
    const list = buildPageDrawList({ ...page, objects: [withLabel, ...page.objects.slice(1)] });
    expect(list.items[0]).toMatchObject({ kind: 'point', label: '甲' });
    expect(list.items[1]).toMatchObject({ kind: 'point', label: undefined });
  });
});
