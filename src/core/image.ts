/** 图片以单位矩形存放，六元矩阵按行映射到页面坐标。 */
import type { Pt } from './geom';
export type Affine = [number, number, number, number, number, number];
export function imageCorners(d: { at: Pt; w: number; h: number; affine?: Affine }): Pt[] {
  const [a, b, tx, c, e, ty] = d.affine ?? [d.w, 0, d.at.x, 0, d.h, d.at.y];
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => ({ x: a * x + b * y + tx, y: c * x + e * y + ty }));
}
export function imageBox(points: Pt[]) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { at: { x, y }, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
