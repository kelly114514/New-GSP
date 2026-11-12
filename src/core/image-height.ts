import { decode } from 'fast-png';
import { EPS, inPolygon, type Pt } from './geom';

export interface HeightMask {
  width: number;
  height: number;
  opaque: Uint8Array;
  solid: boolean;
}

/** 按 PNG 的有效透明度生成边界掩码。RGB 不参与高度判定。 */
export function readHeightMask(data: string): HeightMask | undefined {
  try {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (bytes.length < 33) return;
    const header = new DataView(bytes.buffer);
    const w = header.getUint32(16), h = header.getUint32(20);
    if (w < 1 || h < 1 || w * h > 25_000_000) return;
    const { width, height, data: pixels, depth, channels, palette, transparency } = decode(bytes);
    const opaque = new Uint8Array(width * height);
    const full = 2 ** depth - 1;
    const stride = Math.ceil(width * depth / 8);
    let solid = true;
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      const pos = i * channels;
      const value = depth < 8 ? (pixels[y * stride + Math.floor(x * depth / 8)] >> (8 - depth - (x * depth % 8))) & full : pixels[pos];
      let alpha = 255;
      if (palette) alpha = palette[value]?.[3] ?? 255;
      else if (channels === 2 || channels === 4) alpha = 255 * pixels[pos + channels - 1] / full;
      else if (transparency && value === transparency[0] &&
        (channels === 1 || (pixels[pos + 1] === transparency[1] && pixels[pos + 2] === transparency[2]))) alpha = 0;
      if (alpha >= 192) opaque[i] = 1;
      else solid = false;
    }
    return { width, height, opaque, solid };
  } catch {
    return undefined;
  }
}

/** 取图像在函数坐标系中的上包络。图片局部像素中心按原版的 1.5 像素偏移定位。 */
export function imageHeightPaths(mask: HeightMask, corners: Pt[], clips: Pt[][]): Pt[][] {
  const [a, b, , d] = corners;
  const { width, height, opaque } = mask;
  const ux = { x: (b.x - a.x) / width, y: (b.y - a.y) / width };
  const uy = { x: (d.x - a.x) / height, y: (d.y - a.y) / height };
  if (Math.abs(ux.x * uy.y - ux.y * uy.x) < Number.EPSILON) return [];
  const at = (x: number, y: number): Pt => ({ x: a.x + ux.x * x + uy.x * y, y: a.y + ux.y * x + uy.y * y });
  const covered = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height &&
    !!opaque[y * width + x] && (!clips.length || clips.every(poly => inPolygon(at(x + 0.5, y + 0.5), poly)));
  const straight = Math.abs(uy.x) < EPS && Math.abs(ux.y) < EPS;
  const swapped = Math.abs(ux.x) < EPS && Math.abs(uy.y) < EPS;
  if (!straight && !swapped) {
    const edges: Pt[][] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!covered(x, y)) continue;
      if (!covered(x, y - 1) || !covered(x, y + 1)) edges.push([at(x + 1, y + 1.5), at(x + 2, y + 1.5)]);
      if (!covered(x - 1, y) || !covered(x + 1, y)) edges.push([at(x + 1.5, y + 1), at(x + 1.5, y + 2)]);
    }
    return edges;
  }
  const cols = straight ? width : height, rows = straight ? height : width;
  const yUp = (straight ? uy.y : ux.y) > 0;
  const heights = Array.from({ length: cols }, (_, col) => {
    for (let i = 0; i < rows; i++) {
      const row = yUp ? rows - 1 - i : i;
      if (straight ? covered(col, row) : covered(row, col)) return row + 1.5;
    }
    return undefined;
  });
  const point = (col: number, row: number) => straight ? at(col, row) : at(row, col);
  const paths: Pt[][] = [];
  let path: Pt[] | undefined;
  for (let col = 0; col < cols; col++) {
    const y = heights[col];
    if (y === undefined) { path = undefined; continue; }
    const before = heights[col - 1], after = heights[col + 1];
    if (!path) {
      path = [point(col === 0 ? -1 : col + 1, y)];
      paths.push(path);
    }
    path.push(point(col + 1.5, ((before ?? y) + 2 * y + (after ?? y)) / 4));
    if (after === undefined) path.push(point(col >= cols - 2 ? cols + 1 : col + 2, y));
  }
  return paths;
}

export function imageHeightAt(paths: Pt[][], x: number): number | undefined {
  let highest = -Infinity;
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue;
    const y = a.x === b.x ? Math.max(a.y, b.y) : a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x));
    highest = Math.max(highest, y);
  }
  return Number.isFinite(highest) ? highest : undefined;
}
