import { CORE_VERSION } from '@gsp-plus/core';

export { drawGrid } from './grid.ts';
export type { GridOptions } from './grid.ts';
export { buildPageDrawList, colorRefToCss, SEGMENT_CONSTRAINT_ID } from './scene.ts';
export type { Bounds, DrawItem, PageDrawList, PointItem, SegmentItem } from './scene.ts';
export { drawPageScene, distanceToSegment, hitTest, LINE_WIDTH, POINT_RADIUS, SELECT_COLOR } from './draw.ts';
export type { DrawOptions } from './draw.ts';
export { clampScale, fitView, MAX_FIT_SCALE, MAX_SCALE, MIN_SCALE, panView, screenToWorld, worldToScreen, zoomAt } from './view.ts';
export type { View } from './view.ts';

/** 绘制包版本，需与 package.json 的 version 保持一致。 */
export const RENDER_VERSION = '0.1.0';

/** 人类可读的版本说明，例如状态栏显示用。 */
export function versionInfo(): string {
  return `render ${RENDER_VERSION} / core ${CORE_VERSION}`;
}
