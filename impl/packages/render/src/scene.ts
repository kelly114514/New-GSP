import { evaluatePageGeometry } from '@gsp-plus/core';
import type { ContainerModel, Geometry, PageGeometry, ObjectInfo } from '@gsp-plus/core';

export const SEGMENT_CONSTRAINT_ID = 2;
export function colorRefToCss(colorRef: number): string {
  return `rgb(${colorRef & 255}, ${(colorRef >>> 8) & 255}, ${(colorRef >>> 16) & 255})`;
}
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface RenderStyle {
  lineWidth: number;
  pointRadius: number;
  pointStrokeWidth: number;
  pointStrokeColor: string | null;
  /** Native style/label fields remain preserved; unverified fields use viewer defaults. */
  nativeStyleVerified: boolean;
}
export type DrawItem = Geometry & {
  index: number;
  color: string;
  label: string | undefined;
  draggable: boolean;
  style: RenderStyle;
};
export type PointItem = Extract<DrawItem, { kind: 'point' }>;
export type SegmentItem = DrawItem & { kind: 'segment' };
export interface PageDrawList {
  source: ContainerModel['node'];
  items: DrawItem[];
  bounds: Bounds | null;
  objectCount: number;
  drawnIndices: ReadonlySet<number>;
  unsupportedIndices: number[];
  nonexistentIndices: number[];
  evaluation: PageGeometry;
}
function style(o: ObjectInfo): RenderStyle {
  const point = o.mainKind === 1 && o.header.styleWord === 0x0221;
  const segment = o.constraintId === 2 && o.header.styleWord === 0x0122;
  return {
    lineWidth: segment ? 3 : 1.5, pointRadius: point ? 4 : 3,
    pointStrokeWidth: point ? 1.25 : 0, pointStrokeColor: point ? '#000000' : null,
    nativeStyleVerified: point || segment,
  };
}
export function buildPageDrawList(page: ContainerModel, evaluation: PageGeometry = evaluatePageGeometry(page)): PageDrawList {
  const byIndex = new Map(page.objects.map((o) => [o.index, o]));
  const items: DrawItem[] = [];
  let bounds: Bounds | null = null;
  const extend = (x: number, y: number) => {
    bounds = bounds === null ? { minX: x, minY: y, maxX: x, maxY: y } : {
      minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y),
    };
  };
  for (const result of evaluation.objects) {
    if (result.status !== 'ok') continue;
    const o = byIndex.get(result.objectIndex);
    if (o === undefined) continue;
    const text = o.label?.text;
    const item: DrawItem = { ...result, index: result.objectIndex, color: colorRefToCss(o.header.colorRef), label: text || undefined, draggable: o.constraintId === 0 && o.mainKind === 1 && page.type === 'page', style: style(o) };
    items.push(item);
    if (item.kind === 'point') extend(item.geometry.x, item.geometry.y);
    else if (item.kind === 'segment' || item.kind === 'line' || item.kind === 'ray') {
      extend(...item.geometry.a); extend(...item.geometry.b);
    } else if (item.kind === 'polygon') item.geometry.vertices.forEach((p) => extend(...p));
    else {
      const { center, radius } = item.geometry;
      extend(center[0] - radius, center[1] - radius); extend(center[0] + radius, center[1] + radius);
    }
  }
  return {
    source: page.node, items, bounds, objectCount: page.objects.length, evaluation,
    drawnIndices: new Set(items.map((i) => i.index)),
    unsupportedIndices: evaluation.objects.filter((o) => o.status === 'unsupported' || o.status === 'unbound-input').map((o) => o.objectIndex),
    nonexistentIndices: evaluation.objects.filter((o) => o.status === 'not-existing').map((o) => o.objectIndex),
  };
}


