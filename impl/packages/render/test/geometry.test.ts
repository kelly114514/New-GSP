import { describe, expect, it } from 'vitest';
import { clipLinear, hitTest } from '../src/index';
import type { DrawItem, PageDrawList } from '../src/index';
import { buildPageDrawList } from '../src/index';
import { loadSample } from './support/samples';

function list(items: DrawItem[]): PageDrawList { return { ...buildPageDrawList(loadSample('empty.gsp').pages[0]!), items }; }
const base = { color: '#123456', label: undefined, draggable: false, style: { lineWidth: 1.5, pointRadius: 3, pointStrokeWidth: 0, pointStrokeColor: null, nativeStyleVerified: false } };
const view = { scale: 1, offsetX: 0, offsetY: 0 };
describe('M2 curve and region picking', () => {
  it('clips vertical lines and forward rays, without drawing their backward continuation', () => {
    expect(clipLinear([20, 10], [20, 20], 'line', 100, 80)).toEqual([[20, 0], [20, 80]]);
    expect(clipLinear([20, 10], [30, 10], 'ray', 100, 80)).toEqual([[20, 10], [100, 10]]);
    expect(clipLinear([20, 100], [30, 100], 'line', 100, 80)).toBeNull();
  });
  it('ray range and circle circumference are respected', () => {
    const scene = list([{ ...base, index: 1, kind: 'ray', parameterizationKnown: true, geometry: { a: [20, 10], b: [30, 10] } }, { ...base, index: 2, kind: 'circle', geometry: { center: [50, 50], radius: 20 } }]);
    expect(hitTest(scene, view, 90, 10)).toBe(1);
    expect(hitTest(scene, view, 0, 10)).toBeNull();
    expect(hitTest(scene, view, 70, 50)).toBe(2);
    expect(hitTest(scene, view, 50, 50)).toBeNull();
  });
  it('points take priority over filled regions', () => {
    const scene = list([{ ...base, index: 1, kind: 'disk', geometry: { center: [50, 50], radius: 30 } }, { ...base, index: 2, kind: 'point', geometry: { x: 50, y: 50 } }]);
    expect(hitTest(scene, view, 50, 50)).toBe(2);
    expect(hitTest(scene, view, 70, 50)).toBe(1);
  });
});

