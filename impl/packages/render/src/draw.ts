/**
 * Canvas 2D 绘制与点击命中测试。坐标全部是 CSS 像素；高 DPI 由调用方用 ctx.setTransform 处理。
 * 只接收纯描述（PageDrawList + View），不读取 React 或应用状态。
 */

import { worldToScreen } from './view.ts';
import type { View } from './view.ts';
import type { PageDrawList, PointItem, SegmentItem } from './scene.ts';

/** 自由点的半径（CSS 像素，不随缩放变化）。 */
export const POINT_RADIUS = 3;
/** 线宽（CSS 像素）。 */
export const LINE_WIDTH = 1.5;
/** 选中高亮色。 */
export const SELECT_COLOR = '#2f80ed';
export const LABEL_COLOR = '#1f2933';
export const LABEL_FONT = '12px "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif';

export interface DrawOptions {
  /** 选中的对象序号；无选中为 null/undefined。 */
  selectedIndex?: number | null | undefined;
}

/** 在 ctx 上画整页。调用前应已清空画布；函数自己 save/restore。 */
export function drawPageScene(
  ctx: CanvasRenderingContext2D,
  list: PageDrawList,
  view: View,
  options: DrawOptions = {},
): void {
  const selected = options.selectedIndex ?? null;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const item of list.items) {
    if (item.kind === 'segment') drawSegment(ctx, item, view, item.index === selected);
  }
  for (const item of list.items) {
    if (item.kind === 'point') drawPoint(ctx, item, view, item.index === selected);
  }

  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'alphabetic';
  for (const item of list.items) {
    if (item.kind !== 'point' || item.label === undefined) continue;
    const p = worldToScreen(view, item.x, item.y);
    ctx.fillText(item.label, p.x + POINT_RADIUS + 4, p.y - POINT_RADIUS - 2);
  }
  ctx.restore();
}

function drawSegment(ctx: CanvasRenderingContext2D, item: SegmentItem, view: View, selected: boolean): void {
  const a = worldToScreen(view, item.x1, item.y1);
  const b = worldToScreen(view, item.x2, item.y2);
  if (selected) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = LINE_WIDTH + 5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = item.color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawPoint(ctx: CanvasRenderingContext2D, item: PointItem, view: View, selected: boolean): void {
  const p = worldToScreen(view, item.x, item.y);
  if (selected) {
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, POINT_RADIUS + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = item.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

/** 点到线段的距离（同一坐标系，通常是屏幕坐标）。 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 点击命中测试：屏幕坐标 (sx, sy) 附近的对象序号。先看点（点优先），再看线段。
 * 返回 null 表示空白处。
 */
export function hitTest(list: PageDrawList, view: View, sx: number, sy: number, tolerance = 6): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  const pointRadius = Math.max(tolerance, POINT_RADIUS + 2);
  for (const item of list.items) {
    if (item.kind !== 'point') continue;
    const p = worldToScreen(view, item.x, item.y);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= pointRadius && d < bestDistance) {
      best = item.index;
      bestDistance = d;
    }
  }
  if (best !== null) return best;
  for (const item of list.items) {
    if (item.kind !== 'segment') continue;
    const a = worldToScreen(view, item.x1, item.y1);
    const b = worldToScreen(view, item.x2, item.y2);
    const d = distanceToSegment(sx, sy, a.x, a.y, b.x, b.y);
    if (d <= tolerance && d < bestDistance) {
      best = item.index;
      bestDistance = d;
    }
  }
  return best;
}
