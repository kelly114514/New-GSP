import { describe, expect, it } from 'vitest';
import { buildPageDrawList, colorRefToCss } from '../src/index';
import { loadSample } from './support/samples';

describe('COLORREF and evaluated page scene', () => {
  it('COLORREF low byte is red', () => {
    expect(colorRefToCss(255)).toBe('rgb(255, 0, 0)');
    expect(colorRefToCss(0x800000)).toBe('rgb(0, 0, 128)');
  });
  it('segment endpoints keep native parent order and color', () => {
    const list = buildPageDrawList(loadSample('segment.gsp').pages[0]!);
    expect(list.items[0]).toMatchObject({ kind: 'point', index: 1, geometry: { x: 211, y: 147 }, color: 'rgb(255, 0, 0)', label: undefined, draggable: true });
    expect(list.items[2]).toMatchObject({ kind: 'segment', index: 3, geometry: { a: [411, 281], b: [211, 147] }, color: 'rgb(0, 0, 128)', draggable: false, style: { lineWidth: 3 } });
    expect(list.unsupportedIndices).toEqual([]);
    expect([...list.drawnIndices]).toEqual([1, 2, 3]);
    expect(list.bounds).toEqual({ minX: 211, minY: 147, maxX: 411, maxY: 281 });
  });
  it('midpoint is drawn as a constrained point', () => {
    const list = buildPageDrawList(loadSample('midpoint.gsp').pages[0]!);
    expect(list.items.filter((i) => i.kind === 'point')).toHaveLength(3);
    expect(list.items[3]).toMatchObject({ kind: 'point', geometry: { x: 311, y: 214 }, draggable: false });
    expect(list.unsupportedIndices).toEqual([]);
  });
  it('moved baseline and empty page', () => {
    expect(buildPageDrawList(loadSample('midpoint-moved.gsp').pages[0]!).items[0]).toMatchObject({ geometry: { x: 251, y: 174 } });
    expect(buildPageDrawList(loadSample('empty.gsp').pages[0]!)).toMatchObject({ items: [], bounds: null, objectCount: 0 });
  });
  it('missing parent is nonexistent, separate from unsupported constraints', () => {
    const page = loadSample('segment.gsp').pages[0]!;
    const broken = { ...page, objects: page.objects.filter((o) => o.index !== 2) };
    const list = buildPageDrawList(broken);
    expect(list.items.filter((i) => i.kind === 'segment')).toEqual([]);
    expect(list.nonexistentIndices).toEqual([3]);
    expect(list.unsupportedIndices).toEqual([]);
    const unrecognized = buildPageDrawList({ ...page, objects: [{ ...page.objects[2]!, constraintId: 1000, parents: [] }] });
    expect(unrecognized.unsupportedIndices).toEqual([3]);
  });
  it('preserves explicit label text without inventing automatic letters', () => {
    const page = loadSample('segment.gsp').pages[0]!;
    const first = page.objects[0]!;
    const list = buildPageDrawList({ ...page, objects: [{ ...first, label: { ...first.label!, text: '甲' } }, ...page.objects.slice(1)] });
    expect(list.items[0]).toMatchObject({ label: '甲' });
    expect(list.items[1]).toMatchObject({ label: undefined });
  });
  it('ignores a coordinate-system container while retaining its independently drawn axes', () => {
    const page = loadSample('segment.gsp').pages[0]!;
    const list = buildPageDrawList(page, { pageIndex: 1, objects: [
      { objectIndex: 1, constraintId: 58, status: 'ok', exists: true, kind: 'line', geometry: { a: [100, 100], b: [110, 100] }, parameterizationKnown: true },
      { objectIndex: 2, constraintId: 58, status: 'ok', exists: true, kind: 'line', geometry: { a: [100, 100], b: [100, 80] }, parameterizationKnown: true },
      { objectIndex: 3, constraintId: 61, status: 'ok', exists: true, kind: 'coordinate-system', geometry: { origin: [100, 100], u: [10, 0], v: [0, -20] } },
    ] });
    expect([...list.drawnIndices]).toEqual([1, 2]);
    expect(list.items.map((item) => item.kind)).toEqual(['line', 'line']);
    expect(list.bounds).toEqual({ minX: 100, minY: 80, maxX: 110, maxY: 100 });
    expect(list.unsupportedIndices).toEqual([]);
  });
});
