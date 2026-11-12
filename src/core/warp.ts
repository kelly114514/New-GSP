/** 自定义变换作用于图片（原版方法 96）的取样网格。
 *
 * 源图片按纹理坐标划成 nx × ny 个小格，格点放进驱动点求出象点位置，每格按对应的源图片小块贴到四个象点围成的四边形上。
 * 原版只确认了：采样数（属性“绘图”页）和允许失真度两项设置；四色夹具的采样数等于像素数时每个像素是一格。
 * 下面的格数分配、失真判据和象点数上限是新版策略（原版具体算法未知），见 docs/gsp格式.md。
 */
import type { Pt } from './geom';

export interface WarpMesh {
  nx: number; ny: number;
  /** (nx+1)(ny+1) 个格点的页面坐标，按行存 [x, y]；该处变换无定义时为 NaN。格点 (i, j) 对应纹理坐标 (i/nx, j/ny)。 */
  pts: Float64Array;
  /** nx·ny 个格子：1 表示绘制，0 表示无定义或失真过大而不画。 */
  cells: Uint8Array;
}

/** 一次求值最多计算的格点数。采样数更大时按比例减少格数，格内的像素仍按仿射插值，画面连续。 */
export const WARP_MAX_VERTICES = 12000;

/** 按源图片在页面上的长宽比分配格数，使格数约等于采样数。 */
export function warpGrid(samples: number, w: number, h: number, maxVertices = WARP_MAX_VERTICES): { nx: number; ny: number } {
  const want = Math.max(1, Math.round(Number.isFinite(samples) ? samples : 1));
  const aspect = w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : 1;
  const fit = (n: number) => {
    const nx = Math.max(1, Math.round(Math.sqrt(n * aspect)));
    return { nx, ny: Math.max(1, Math.round(n / nx)) };
  };
  let g = fit(want);
  if ((g.nx + 1) * (g.ny + 1) > maxVertices) {
    const k = Math.sqrt(maxVertices / ((g.nx + 1) * (g.ny + 1)));
    g = fit(Math.max(1, Math.floor(g.nx * g.ny * k * k)));
    while ((g.nx + 1) * (g.ny + 1) > maxVertices && g.nx * g.ny > 1) g = { nx: Math.max(1, g.nx - 1), ny: Math.max(1, g.ny - 1) };
  }
  return g;
}

const at = (m: WarpMesh, i: number, j: number): Pt => { const k = (j * (m.nx + 1) + i) * 2; return { x: m.pts[k], y: m.pts[k + 1] }; };
export const warpVertex = at;

/** 失真度：格子四个象点偏离平行四边形的程度（残差 / 最长边），仿射变换为 0，四边形翻折或断开时接近或超过 1。 */
function residual(a: Pt, b: Pt, c: Pt, d: Pt): { r: number; size: number } {
  const size = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - a.x, d.y - a.y), Math.hypot(c.x - b.x, c.y - b.y), Math.hypot(c.x - d.x, c.y - d.y));
  const r = Math.hypot(c.x - b.x - d.x + a.x, c.y - b.y - d.y + a.y);
  return { r: size > 1e-9 ? r / size : 0, size };
}

/** 标记要画的格子。distortion ≥ 1 时（“全部”）只去掉无定义的格子；否则去掉偏离平行四边形太多、或比一般格子大很多的格子（跨越断点）。 */
export function warpCells(m: WarpMesh, distortion: number, keep?: (i: number, j: number) => boolean): void {
  const { nx, ny } = m, sizes: number[] = [], info = new Float64Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = at(m, i, j), b = at(m, i + 1, j), c = at(m, i + 1, j + 1), d = at(m, i, j + 1), k = j * nx + i;
    const ok = [a, b, c, d].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) && (!keep || keep(i, j));
    m.cells[k] = ok ? 1 : 0;
    if (!ok) continue;
    const q = residual(a, b, c, d);
    info[k * 2] = q.r; info[k * 2 + 1] = q.size;
    sizes.push(q.size);
  }
  if (!(distortion < 1) || !sizes.length) return;
  sizes.sort((x, y) => x - y);
  const typical = sizes[sizes.length >> 1];
  const allowed = Math.max(0.02, distortion), stretch = typical * (2 + 30 * Math.max(0, distortion)) + 2;
  for (let k = 0; k < nx * ny; k++) if (m.cells[k] && (info[k * 2] > allowed || info[k * 2 + 1] > stretch)) m.cells[k] = 0;
}

function inTri(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/** 点是否落在某个要画的格子里。 */
export function warpHit(m: WarpMesh, p: Pt): boolean {
  for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
    if (!m.cells[j * m.nx + i]) continue;
    const a = at(m, i, j), b = at(m, i + 1, j), c = at(m, i + 1, j + 1), d = at(m, i, j + 1);
    if (p.x < Math.min(a.x, b.x, c.x, d.x) || p.x > Math.max(a.x, b.x, c.x, d.x) || p.y < Math.min(a.y, b.y, c.y, d.y) || p.y > Math.max(a.y, b.y, c.y, d.y)) continue;
    if (inTri(p, a, b, c) || inTri(p, a, c, d)) return true;
  }
  return false;
}

/** 要画的格点的外包矩形。 */
export function warpBounds(m: WarpMesh): { x0: number; y0: number; x1: number; y1: number } | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
    if (!m.cells[j * m.nx + i]) continue;
    for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = at(m, i + di, j + dj);
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : undefined;
}

/** 新建时的默认采样数：源图片像素数，最多 50000（推测：原版夹具 20×12 得 240、样例 100×120 得 12000，更大的样例为 50000；需原版复核）。 */
export function defaultWarpSamples(pixelW: number, pixelH: number): number {
  const n = Math.round(pixelW) * Math.round(pixelH);
  return Number.isFinite(n) && n > 0 ? Math.min(50000, n) : 50000;
}
