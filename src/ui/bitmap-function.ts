import type { Pt } from '../core/geom';
import type { Def } from '../core/model';

/** 将浏览器能打开的其它位图转换成 PNG，供高度函数离线重新求值。 */
export async function bitmapAsPng(data: string, mime: string) {
  const img = new Image(); img.src = `data:${mime};base64,${data}`;
  await img.decode();
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}

export function paintMarker(ctx: CanvasRenderingContext2D, points: readonly Pt[], color: string, width: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

/** 在 96 dpi 页面网格上生成与原版绘图对象同类的透明位图。 */
export function markerDrawing(points: readonly Pt[], color: string, width: number): Extract<Def, { k: 'image' }> | undefined {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const { x, y } of points) {
    l = Math.min(l, x); t = Math.min(t, y);
    r = Math.max(r, x); b = Math.max(b, y);
  }
  const padding = width / 2 + 1;
  const x = Math.floor(l - padding), y = Math.floor(t - padding);
  const w = Math.ceil(r + padding) - x, h = Math.ceil(b + padding) - y;
  if (!(w > 0 && h > 0 && w * h <= 25_000_000)) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.translate(-x, -y);
  paintMarker(ctx, points, color, width);
  const png = canvas.toDataURL('image/png');
  if (!png.startsWith('data:image/png;base64,')) return undefined;
  return { k: 'image', drawing: true, data: png.split(',')[1], mime: 'image/png', at: { x, y }, w, h };
}
