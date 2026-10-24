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

/** Kernel arc angles are math angles (counter-clockwise on screen, y down on the page). */
const quarterArc = (kind: 'arc' | 'sector' | 'circular-segment', index = 1): DrawItem => ({ ...base, index, kind, geometry: { center: [50, 50], radius: 20, startAngle: 0, sweepAngle: Math.PI / 2, start: [70, 50], end: [50, 30] } } as DrawItem);
describe('arcs and arc regions', () => {
  it('hit-tests the arc on the screen side given by the math convention, not its mirror', () => {
    const scene = list([quarterArc('arc')]);
    expect(hitTest(scene, view, 50 + 20 * Math.SQRT1_2, 50 - 20 * Math.SQRT1_2)).toBe(1);
    expect(hitTest(scene, view, 50 + 20 * Math.SQRT1_2, 50 + 20 * Math.SQRT1_2)).toBeNull();
    expect(hitTest(scene, view, 30, 50)).toBeNull();
  });
  it('fills a sector through the centre and a circular segment only to the chord', () => {
    const inside = [58, 42];
    expect(hitTest(list([quarterArc('sector')]), view, inside[0]!, inside[1]!)).toBe(1);
    expect(hitTest(list([quarterArc('sector')]), view, 42, 58)).toBeNull();
    // Point near the centre is in the sector but outside the chord-bounded segment.
    expect(hitTest(list([quarterArc('sector')]), view, 53, 47)).toBe(1);
    expect(hitTest(list([quarterArc('circular-segment')]), view, 53, 47)).toBeNull();
    expect(hitTest(list([quarterArc('circular-segment')]), view, 64, 36)).toBe(1);
  });
});

