/**
 * 页面绘制描述（纯数据，不依赖 DOM）：把一个页的对象模型转成“要画什么”的列表。
 *
 * M1 只能画两类东西，不需要几何计算：
 * - 自由点（对象带 2201 坐标）：按保存的坐标画一个点；
 * - 线段（约束 ID 2）且两个父对象都是自由点：直接连接两点的保存坐标。
 * 其它对象（中点、圆、交点……）在 M1 不绘制，只计入“暂不支持”。
 */

import type { ContainerModel, ObjectInfo } from '@gsp-plus/core';

/** 线段的约束外部 ID（spec/objects/catalog.json）。 */
export const SEGMENT_CONSTRAINT_ID = 2;

/** 把 2000 对象头里的 COLORREF（0x00BBGGRR）转成 CSS 颜色。 */
export function colorRefToCss(colorRef: number): string {
  const r = colorRef & 0xff;
  const g = (colorRef >>> 8) & 0xff;
  const b = (colorRef >>> 16) & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

/** 世界坐标（文件里保存的坐标，y 向下）的包围盒。 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PointItem {
  kind: 'point';
  /** 对象序号（页内，从 1 起）。 */
  index: number;
  x: number;
  y: number;
  /** CSS 颜色。 */
  color: string;
  /** 标签文字；没有或为空为 undefined。 */
  label: string | undefined;
}

export interface SegmentItem {
  kind: 'segment';
  /** 对象序号（页内，从 1 起）。 */
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export type DrawItem = PointItem | SegmentItem;

export interface PageDrawList {
  /** 按对象次序排列的绘制项。 */
  items: DrawItem[];
  /** 所有点的包围盒；页上没有点时为 null。 */
  bounds: Bounds | null;
  /** 页上的对象总数。 */
  objectCount: number;
  /** 已画出的对象序号。 */
  drawnIndices: ReadonlySet<number>;
  /** 暂不支持（未画出）的对象序号，升序。 */
  unsupportedIndices: number[];
}

function hasFreePoint(o: ObjectInfo | undefined): o is ObjectInfo & { freePoint: NonNullable<ObjectInfo['freePoint']> } {
  return o !== undefined && o.freePoint !== undefined;
}

/** 把一个页的对象模型转成绘制列表。 */
export function buildPageDrawList(page: ContainerModel): PageDrawList {
  const byIndex = new Map<number, ObjectInfo>();
  for (const o of page.objects) byIndex.set(o.index, o);

  const items: DrawItem[] = [];
  const drawn = new Set<number>();
  let bounds: Bounds | null = null;

  for (const o of page.objects) {
    if (o.freePoint !== undefined) {
      const label = o.label?.text;
      items.push({
        kind: 'point',
        index: o.index,
        x: o.freePoint.x,
        y: o.freePoint.y,
        color: colorRefToCss(o.header.colorRef),
        label: label !== undefined && label.length > 0 ? label : undefined,
      });
      drawn.add(o.index);
      bounds = extendBounds(bounds, o.freePoint.x, o.freePoint.y);
      continue;
    }
    if (o.constraintId === SEGMENT_CONSTRAINT_ID && o.parents.length === 2) {
      const a = byIndex.get(o.parents[0] ?? -1);
      const b = byIndex.get(o.parents[1] ?? -1);
      if (hasFreePoint(a) && hasFreePoint(b)) {
        items.push({
          kind: 'segment',
          index: o.index,
          x1: a.freePoint.x,
          y1: a.freePoint.y,
          x2: b.freePoint.x,
          y2: b.freePoint.y,
          color: colorRefToCss(o.header.colorRef),
        });
        drawn.add(o.index);
      }
    }
  }

  const unsupportedIndices = page.objects
    .map((o) => o.index)
    .filter((index) => !drawn.has(index));

  return {
    items,
    bounds,
    objectCount: page.objects.length,
    drawnIndices: drawn,
    unsupportedIndices,
  };
}

function extendBounds(b: Bounds | null, x: number, y: number): Bounds {
  if (b === null) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(b.minX, x),
    minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x),
    maxY: Math.max(b.maxY, y),
  };
}
