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

/** 从 PNG/BMP 文件头读像素尺寸；读不出时 undefined。 */
export function imagePixelSize(b64: string, mime: string): { w: number; h: number } | undefined {
  let head: string;
  try { head = atob(b64.slice(0, 44)); } catch { return undefined; }
  const u32be = (i: number) => ((head.charCodeAt(i) << 24) | (head.charCodeAt(i + 1) << 16) | (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3)) >>> 0;
  const i32le = (i: number) => head.charCodeAt(i) | (head.charCodeAt(i + 1) << 8) | (head.charCodeAt(i + 2) << 16) | (head.charCodeAt(i + 3) << 24);
  if (mime === 'image/png' && head.length >= 24 && head.slice(12, 16) === 'IHDR') return { w: u32be(16), h: u32be(20) };
  if (mime === 'image/bmp' && head.length >= 26 && head.startsWith('BM')) return { w: Math.abs(i32le(18)), h: Math.abs(i32le(22)) };
  return undefined;
}
