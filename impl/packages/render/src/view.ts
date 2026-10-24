/**
 * 视图变换：屏幕 = 世界 × scale + offset（CSS 像素）。纯函数，便于测试。
 */

import type { Bounds } from './scene.ts';

export interface View {
  scale: number;
  /** 世界原点在屏幕上的 x（CSS 像素）。 */
  offsetX: number;
  offsetY: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
/** “适合窗口”最多放大到这个倍数：内容很少时不至于放得过大。 */
export const MAX_FIT_SCALE = 2;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: x * view.scale + view.offsetX, y: y * view.scale + view.offsetY };
}

export function screenToWorld(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}

/**
 * 适合窗口：让包围盒在 (width, height) 内居中，周围留 padding。
 * 没有内容时以世界原点居中、scale = 1；只有一个点时 scale = 1。
 */
export function fitView(bounds: Bounds | null, width: number, height: number, padding = 40): View {
  const cx = width / 2;
  const cy = height / 2;
  if (bounds === null) return { scale: 1, offsetX: cx, offsetY: cy };
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const fitW = bw > 0 ? availW / bw : Infinity;
  const fitH = bh > 0 ? availH / bh : Infinity;
  const fit = Math.min(fitW, fitH);
  const scale = clampScale(Math.min(Number.isFinite(fit) ? fit : 1, MAX_FIT_SCALE));
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  return { scale, offsetX: cx - midX * scale, offsetY: cy - midY * scale };
}

/** 以屏幕点 (sx, sy) 为中心缩放 factor 倍，该点下的世界坐标保持不动。 */
export function zoomAt(view: View, sx: number, sy: number, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return {
    scale,
    offsetX: sx - (sx - view.offsetX) * k,
    offsetY: sy - (sy - view.offsetY) * k,
  };
}

/** 平移（屏幕像素）。 */
export function panView(view: View, dx: number, dy: number): View {
  return { scale: view.scale, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
}
