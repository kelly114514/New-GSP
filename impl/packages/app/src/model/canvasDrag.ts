import { hitTest, screenToWorld } from '@gsp-plus/render';
import type { PageDrawList, View } from '@gsp-plus/render';
export interface FreePointDrag {
  objectIndex: number;
  offsetX: number;
  offsetY: number;
  startScreenX: number;
  startScreenY: number;
  originalX: number;
  originalY: number;
}
/** Preserve the pointer's initial offset so grabbing a point edge never snaps its center. */
export function beginFreePointDrag(scene: PageDrawList | null, view: View, sx: number, sy: number): FreePointDrag | null {
  if (scene === null) return null;
  const hit = hitTest(scene, view, sx, sy);
  const item = scene.items.find((i) => i.index === hit);
  if (item?.kind !== 'point' || !item.draggable) return null;
  const world = screenToWorld(view, sx, sy);
  return {
    objectIndex: item.index, offsetX: world.x - item.geometry.x, offsetY: world.y - item.geometry.y,
    startScreenX: sx, startScreenY: sy, originalX: item.geometry.x, originalY: item.geometry.y,
  };
}
export function freePointDragTarget(drag: FreePointDrag, view: View, sx: number, sy: number): { x: number; y: number } {
  // Return to the exact original doubles, even when view inversion has rounding error.
  if (sx === drag.startScreenX && sy === drag.startScreenY) return { x: drag.originalX, y: drag.originalY };
  const world = screenToWorld(view, sx, sy);
  return { x: world.x - drag.offsetX, y: world.y - drag.offsetY };
}
