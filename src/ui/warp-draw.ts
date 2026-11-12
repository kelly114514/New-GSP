/** 画取样变换后的图片：每个格子拆成两个三角形，按设备像素逐点反算源图片纹理坐标并双线性取样。
 * 格子很多（原版课件可达二十万个采样）时，用逐三角形 drawImage 太慢，这里在离屏像素缓冲里一次画完再贴到画布。 */
import type { WarpMesh } from '../core/warp';

interface Pixels { w: number; h: number; data: Uint8ClampedArray }
const pixelCache = new WeakMap<HTMLImageElement, Pixels>();

function pixelsOf(img: HTMLImageElement): Pixels | undefined {
  const have = pixelCache.get(img);
  if (have) return have;
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return undefined;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return undefined;
  g.drawImage(img, 0, 0);
  const px = { w, h, data: g.getImageData(0, 0, w, h).data };
  pixelCache.set(img, px);
  return px;
}

let scratch: HTMLCanvasElement | undefined;

/** 在 ctx 当前变换（页面 → 设备）下画出取样变换后的图片。返回 false 表示源图片还没解码。 */
export function drawWarp(ctx: CanvasRenderingContext2D, img: HTMLImageElement, mesh: WarpMesh): boolean {
  const src = pixelsOf(img);
  if (!src) return false;
  const m = ctx.getTransform(), { nx, ny } = mesh, n = (nx + 1) * (ny + 1);
  const dx = new Float64Array(n), dy = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const x = mesh.pts[k * 2], y = mesh.pts[k * 2 + 1];
    dx[k] = m.a * x + m.c * y + m.e; dy[k] = m.b * x + m.d * y + m.f;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!mesh.cells[j * nx + i]) continue;
    for (const k of [j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i, (j + 1) * (nx + 1) + i + 1]) {
      if (dx[k] < x0) x0 = dx[k]; if (dx[k] > x1) x1 = dx[k]; if (dy[k] < y0) y0 = dy[k]; if (dy[k] > y1) y1 = dy[k];
    }
  }
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0));
  const bw = Math.min(W, Math.ceil(x1) + 1) - bx, bh = Math.min(H, Math.ceil(y1) + 1) - by;
  if (!(bw > 0 && bh > 0)) return true;
  const out = new ImageData(bw, bh), o = out.data, s = src.data, sw = src.w, sh = src.h;
  const sample = (u: number, v: number, at: number) => {
    // 纹理坐标 → 源像素中心坐标，双线性插值，边缘夹紧
    const fx = Math.min(sw - 1, Math.max(0, u * sw - 0.5)), fy = Math.min(sh - 1, Math.max(0, v * sh - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const ix1 = Math.min(sw - 1, ix + 1), iy1 = Math.min(sh - 1, iy + 1);
    const p00 = (iy * sw + ix) * 4, p10 = (iy * sw + ix1) * 4, p01 = (iy1 * sw + ix) * 4, p11 = (iy1 * sw + ix1) * 4;
    const w00 = (1 - tx) * (1 - ty) * s[p00 + 3], w10 = tx * (1 - ty) * s[p10 + 3], w01 = (1 - tx) * ty * s[p01 + 3], w11 = tx * ty * s[p11 + 3];
    const a = w00 + w10 + w01 + w11;
    if (a <= 0) return;
    for (let c = 0; c < 3; c++) o[at + c] = (s[p00 + c] * w00 + s[p10 + c] * w10 + s[p01 + c] * w01 + s[p11 + c] * w11) / a;
    o[at + 3] = a;
  };
  // 一个三角形：顶点设备坐标 (ax, ay)… 与纹理坐标 (au, av)…
  const tri = (ka: number, kb: number, kc: number, au: number, av: number, bu: number, bv: number, cu: number, cv: number) => {
    const ax = dx[ka], ay = dy[ka], bx2 = dx[kb], by2 = dy[kb], cx = dx[kc], cy = dy[kc];
    const den = (by2 - cy) * (ax - cx) + (cx - bx2) * (ay - cy);
    if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return;
    const minX = Math.max(bx, Math.floor(Math.min(ax, bx2, cx))), maxX = Math.min(bx + bw - 1, Math.ceil(Math.max(ax, bx2, cx)));
    const minY = Math.max(by, Math.floor(Math.min(ay, by2, cy))), maxY = Math.min(by + bh - 1, Math.ceil(Math.max(ay, by2, cy)));
    const eps = -1e-7;
    for (let py = minY; py <= maxY; py++) {
      const yc = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const xc = px + 0.5;
        const l1 = ((by2 - cy) * (xc - cx) + (cx - bx2) * (yc - cy)) / den;
        const l2 = ((cy - ay) * (xc - cx) + (ax - cx) * (yc - cy)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < eps || l2 < eps || l3 < eps) continue;
        sample(l1 * au + l2 * bu + l3 * cu, l1 * av + l2 * bv + l3 * cv, ((py - by) * bw + (px - bx)) * 4);
      }
    }
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!mesh.cells[j * nx + i]) continue;
    const k00 = j * (nx + 1) + i, k10 = k00 + 1, k01 = k00 + nx + 1, k11 = k01 + 1;
    const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
    tri(k00, k10, k11, u0, v0, u1, v0, u1, v1);
    tri(k00, k11, k01, u0, v0, u1, v1, u0, v1);
  }
  scratch ??= document.createElement('canvas');
  if (scratch.width < bw) scratch.width = bw;
  if (scratch.height < bh) scratch.height = bh;
  const g = scratch.getContext('2d');
  if (!g) return true;
  g.clearRect(0, 0, bw, bh);
  g.putImageData(out, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scratch, 0, 0, bw, bh, bx, by, bw, bh);
  ctx.restore();
  return true;
}

/** 选中时画格网外框和几条格线（原版选中变换图片时也显示格线）。 */
export function strokeWarpOutline(ctx: CanvasRenderingContext2D, mesh: WarpMesh) {
  const { nx, ny } = mesh;
  const p = (i: number, j: number) => { const k = (j * (nx + 1) + i) * 2; return [mesh.pts[k], mesh.pts[k + 1]] as const; };
  const line = (pts: (readonly [number, number])[]) => {
    let open = false;
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) { open = false; continue; }
      if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
    }
  };
  ctx.beginPath();
  const stepsX = [...new Set([0, Math.round(nx / 4), Math.round(nx / 2), Math.round((3 * nx) / 4), nx])];
  const stepsY = [...new Set([0, Math.round(ny / 4), Math.round(ny / 2), Math.round((3 * ny) / 4), ny])];
  for (const i of stepsX) line(Array.from({ length: ny + 1 }, (_, j) => p(i, j)));
  for (const j of stepsY) line(Array.from({ length: nx + 1 }, (_, i) => p(i, j)));
  ctx.stroke();
}
