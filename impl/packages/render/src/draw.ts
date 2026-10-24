import type { XY } from '@gsp-plus/core';
import type { DrawItem, PageDrawList } from './scene.ts';
import { screenToWorld, worldToScreen } from './view.ts';
import type { View } from './view.ts';
export const POINT_RADIUS = 4;
export const LINE_WIDTH = 1.5;
export const SELECT_COLOR = '#2f80ed';
export const LABEL_COLOR = '#1f2933';
export const LABEL_FONT = '12px "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif';
export interface DrawOptions { selectedIndex?: number | null | undefined; width?: number; height?: number }

/** Parametric clipping includes the visible segment, whole line, or forward ray. */
export function clipLinear(a: XY, b: XY, kind: 'segment' | 'line' | 'ray', width: number, height: number): [XY, XY] | null {
  let lo = kind === 'line' ? -Infinity : 0;
  let hi = kind === 'segment' ? 1 : Infinity;
  const d: XY = [b[0] - a[0], b[1] - a[1]];
  for (const [origin, delta, max] of [[a[0], d[0], width], [a[1], d[1], height]]) {
    if (delta === 0) { if (origin! < 0 || origin! > max!) return null; continue; }
    const x = -origin! / delta!, y = (max! - origin!) / delta!;
    lo = Math.max(lo, Math.min(x, y)); hi = Math.min(hi, Math.max(x, y));
  }
  if (lo > hi) return null;
  return [[a[0] + lo * d[0], a[1] + lo * d[1]], [a[0] + hi * d[0], a[1] + hi * d[1]]];
}
function screenXY(view: View, p: XY): XY { const q = worldToScreen(view, ...p); return [q.x, q.y]; }
function anchor(item: DrawItem): XY {
  if (item.kind === 'point') return [item.geometry.x, item.geometry.y];
  if (item.kind === 'segment' || item.kind === 'line' || item.kind === 'ray') return [(item.geometry.a[0] + item.geometry.b[0]) / 2, (item.geometry.a[1] + item.geometry.b[1]) / 2];
  if (item.kind === 'polygon') return item.geometry.vertices[0] ?? [0, 0];
  if (item.kind === 'arc' && item.geometry.start !== undefined && item.geometry.end !== undefined) return [(item.geometry.start[0] + item.geometry.end[0]) / 2, (item.geometry.start[1] + item.geometry.end[1]) / 2];
  return [item.geometry.center[0] + item.geometry.radius, item.geometry.center[1]];
}
function trace(ctx: CanvasRenderingContext2D, item: DrawItem, view: View, width: number, height: number): boolean {
  ctx.beginPath();
  if (item.kind === 'point') {
    const p = worldToScreen(view, item.geometry.x, item.geometry.y);
    ctx.arc(p.x, p.y, item.style.pointRadius * view.scale, 0, Math.PI * 2);
  } else if (item.kind === 'segment' || item.kind === 'line' || item.kind === 'ray') {
    const segment = clipLinear(screenXY(view, item.geometry.a), screenXY(view, item.geometry.b), item.kind, width, height);
    if (segment === null) return false;
    ctx.moveTo(...segment[0]); ctx.lineTo(...segment[1]);
  } else if (item.kind === 'polygon') {
    for (const [i, p] of item.geometry.vertices.entries()) { const q = screenXY(view, p); if (i === 0) ctx.moveTo(...q); else ctx.lineTo(...q); }
    ctx.closePath();
  } else {
    const c = screenXY(view, item.geometry.center), r = item.geometry.radius * view.scale;
    if (item.kind === 'circle' || item.kind === 'disk') ctx.arc(...c, r, 0, Math.PI * 2);
    else {
      // Kernel angles are math angles (y up, counter-clockwise positive); canvas angles run clockwise on a y-down page.
      const start = item.geometry.startAngle ?? 0, sweep = item.geometry.sweepAngle ?? 0;
      if (item.kind === 'sector') ctx.moveTo(...c);
      ctx.arc(...c, r, -start, -(start + sweep), sweep > 0);
      if (item.kind !== 'arc') ctx.closePath();
    }
  }
  return true;
}
function filled(item: DrawItem): boolean { return item.kind === 'point' || item.kind === 'polygon' || item.kind === 'disk' || item.kind === 'sector' || item.kind === 'circular-segment'; }
export function drawPageScene(ctx: CanvasRenderingContext2D, list: PageDrawList, view: View, options: DrawOptions = {}): void {
  const width = options.width ?? ctx.canvas?.width ?? 10000, height = options.height ?? ctx.canvas?.height ?? 10000;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Regions first, then curves, then points; labels stay readable above all geometry.
  const ordered = [...list.items].sort((a, b) => Number(a.kind === 'point') * 2 - Number(b.kind === 'point') * 2 || Number(!filled(a)) - Number(!filled(b)));
  for (const item of ordered) {
    ctx.save();
    if (item.index === options.selectedIndex && trace(ctx, item, view, width, height)) {
      ctx.strokeStyle = SELECT_COLOR; ctx.lineWidth = item.style.lineWidth * view.scale + 5; ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = item.color; ctx.strokeStyle = item.color; ctx.lineWidth = item.style.lineWidth * view.scale;
    if (trace(ctx, item, view, width, height)) {
      if (filled(item)) ctx.fill(); else ctx.stroke();
      if (item.kind === 'point' && item.style.pointStrokeColor !== null) {
        ctx.strokeStyle = item.style.pointStrokeColor;
        ctx.lineWidth = item.style.pointStrokeWidth * view.scale;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.font = LABEL_FONT; ctx.fillStyle = LABEL_COLOR; ctx.textBaseline = 'alphabetic';
  for (const item of list.items) {
    if (item.label === undefined) continue;
    const p = screenXY(view, anchor(item));
    ctx.fillText(item.label, p[0] + POINT_RADIUS + 4, p[1] - POINT_RADIUS - 2);
  }
  ctx.restore();
}
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function inPolygon(p: XY, vertices: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]!, b = vertices[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function angularDistance(a: number, start: number, sweep: number): number {
  const tau = 2 * Math.PI;
  return sweep >= 0 ? ((a - start) % tau + tau) % tau : ((start - a) % tau + tau) % tau;
}
export function hitTest(list: PageDrawList, view: View, sx: number, sy: number, tolerance = 6): number | null {
  let best: number | null = null, bestDistance = Infinity;
  // Separate priority tiers so a filled region never steals a point/curve hit.
  for (const tier of [0, 1, 2]) {
    for (const item of list.items) {
      if ((item.kind === 'point' ? 0 : filled(item) ? 2 : 1) !== tier) continue;
      let d = Infinity;
      if (item.kind === 'point') { const p = screenXY(view, [item.geometry.x, item.geometry.y]); d = Math.hypot(p[0] - sx, p[1] - sy); }
      else if (item.kind === 'segment' || item.kind === 'line' || item.kind === 'ray') {
        const a = screenXY(view, item.geometry.a), b = screenXY(view, item.geometry.b), dx = b[0] - a[0], dy = b[1] - a[1];
        let t = ((sx - a[0]) * dx + (sy - a[1]) * dy) / (dx * dx + dy * dy);
        if (item.kind !== 'line') t = Math.max(0, t); if (item.kind === 'segment') t = Math.min(1, t);
        d = Math.hypot(sx - a[0] - t * dx, sy - a[1] - t * dy);
      } else if (item.kind === 'polygon') {
        const p = screenToWorld(view, sx, sy); if (inPolygon([p.x, p.y], item.geometry.vertices)) d = 0;
        for (const [i, a] of item.geometry.vertices.entries()) { const b = item.geometry.vertices[(i + 1) % item.geometry.vertices.length]!; d = Math.min(d, distanceToSegment(sx, sy, ...screenXY(view, a), ...screenXY(view, b))); }
      } else {
        const c = screenXY(view, item.geometry.center), r = item.geometry.radius * view.scale, radial = Math.hypot(sx - c[0], sy - c[1]);
        if (item.kind === 'circle') d = Math.abs(radial - r);
        else if (item.kind === 'disk') d = Math.max(0, radial - r);
        else {
          const start = item.geometry.startAngle ?? 0, sweep = item.geometry.sweepAngle ?? 0, angle = Math.atan2(c[1] - sy, sx - c[0]);
          const onSweep = angularDistance(angle, start, sweep) <= Math.abs(sweep);
          if (item.kind === 'arc') {
            d = onSweep ? Math.abs(radial - r) : Math.min(...[start, start + sweep].map((a) => Math.hypot(sx - c[0] - r * Math.cos(a), sy - c[1] + r * Math.sin(a))));
          } else {
            // Filled arc regions use a sampled outline consistently for picking.
            const vertices: XY[] = item.kind === 'sector' ? [c] : [];
            const steps = Math.max(8, Math.ceil(Math.abs(sweep) * 24));
            for (let i = 0; i <= steps; i++) vertices.push([c[0] + r * Math.cos(start + sweep * i / steps), c[1] - r * Math.sin(start + sweep * i / steps)]);
            if (inPolygon([sx, sy], vertices)) d = 0;
          }
        }
      }
      const threshold = item.kind === 'point' ? Math.max(tolerance, (item.style.pointRadius + item.style.pointStrokeWidth / 2) * view.scale) : Math.max(tolerance, item.style.lineWidth * view.scale / 2);
      if (d <= threshold && d < bestDistance) { best = item.index; bestDistance = d; }
    }
    if (best !== null) return best;
  }
  return null;
}

