/** 命中测试与框选。半径是原版实测的物理像素数（页面坐标 1 单位 = 1 物理像素）。 */
import { isLine, type Shape } from './engine';
import { warpHit } from './warp';
import * as G from './geom';
import type { Pt } from './geom';
import type { Id, Obj, Page } from './model';
import { classOf } from './construct';
import type { Results } from './engine';

export type Power = 'low' | 'mid' | 'high';
const R = {
  low: { point: 10, line: 5, circleOut: 6, circleIn: 7 },
  mid: { point: 15, line: 9, circleOut: 10, circleIn: 11 },
  high: { point: 21, line: 15, circleOut: 16, circleIn: 17 },
};
/** 页面坐标 → 物理像素的放大倍数（= 屏幕缩放）。页面坐标是 96 dpi 的逻辑像素（和原版文件一致），命中半径按物理像素定义，所以要除以它。 */
export const view = { zoom: 1 };
export const hitRadii = (p: Power) => { const r = R[p], k = 1 / view.zoom; return { point: r.point * k, line: r.line * k, circleOut: r.circleOut * k, circleIn: r.circleIn * k }; };

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export const normRect = (a: Pt, b: Pt): Rect => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });

/** 文本、按钮、图片等盒形对象的外框。 */
export function boxOf(o: Obj, r: Shape | undefined): Rect | undefined {
  if (!r) return undefined;
  if (r.k === 'box') return { x0: r.at.x, y0: r.at.y, x1: r.at.x + r.w, y1: r.at.y + r.h };
  if (o.at && (r.k === 'num' || r.k === 'coords' || r.k === 'text' || r.k === 'table' || r.k === 'func')) {
    const scale = Math.max(1, (o.font?.size ?? (r.k === 'table' ? 14 : 18)) / (r.k === 'table' ? 14 : 18));
    // 表格的尺寸与 render.ts 的 drawTable 一致（没有画布时按每字符约 7.9 像素估算列宽）。
    const tableW = r.k === 'table' ? Array.from({ length: Math.max(1, r.cols.length) }, (_, i) => Math.max(r.cols[i]?.name.length ?? 0, ...r.rows.map(row => (Number.isFinite(row[i]) ? (r.intFirst && i === 0 ? String(row[i]) : Math.abs(row[i]).toFixed(2)) : '∞').length + (row[i] < 0 ? 1 : 0))) * 7.9 * scale + 10 * scale).reduce((a, b) => a + b, 0) : 0;
    const w = r.k === 'table' ? tableW : 150 * scale, h = r.k === 'table' ? (22 + 20 * r.rows.length) * scale : 20 * scale;
    return { x0: o.at.x, y0: o.at.y, x1: o.at.x + w, y1: o.at.y + h };
  }
  return undefined;
}

function distTo(shape: Shape, p: Pt, rad: (typeof R)['low']): number | undefined {
  switch (shape.k) {
    case 'pt': { const d = G.dist(shape.p, p); return d <= rad.point ? d : undefined; }
    case 'line': { const d = G.distToStraight(shape.s, p); return d <= rad.line ? d : undefined; }
    case 'circle': { const d = G.dist(shape.c.c, p) - shape.c.r; return d >= 0 ? (d <= rad.circleOut ? d : undefined) : -d <= rad.circleIn ? -d : undefined; }
    case 'arc': {
      const ang = G.angleOf(shape.c, p), inside = (shape.sweep < 0 ? G.sweep(ang, shape.a0) : G.sweep(shape.a0, ang)) <= Math.abs(shape.sweep);
      const d = Math.abs(G.dist(shape.c, p) - shape.r);
      if (inside) return d <= rad.circleOut ? d : undefined;
      const e = Math.min(G.dist(p, shape.from), G.dist(p, shape.to));
      return e <= rad.line ? e : undefined;
    }
    case 'paths': {
      let best = Infinity;
      for (const path of shape.paths) for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, G.distToStraight({ a: path[i], b: path[i + 1], ext: 'segment' }, p));
      return best <= rad.line ? best : undefined;
    }
    default: return undefined;
  }
}

function insideRegion(shape: Shape, p: Pt): boolean {
  switch (shape.k) {
    case 'poly': return G.inPolygon(p, shape.pts);
    case 'disk': return G.dist(shape.c, p) <= shape.r;
    case 'sector': {
      const d = G.dist(shape.c, p);
      if (d > shape.r) return false;
      const angle = G.angleOf(shape.c, p);
      return (shape.sweep < 0 ? G.sweep(angle, shape.a0) : G.sweep(shape.a0, angle)) <= Math.abs(shape.sweep);
    }
    default: return false;
  }
}

/** 返回点击处所有命中的对象，按优先级排序：点 > 线/圆/弧/轨迹 > 区域 > 文字盒。 */
export function hitAll(page: Page, results: Results, p: Pt, power: Power, opts: { skip?: Set<Id>; classes?: string[] } = {}): Id[] {
  const rad = hitRadii(power);
  const pts: { id: Id; d: number }[] = [], paths: { id: Id; d: number }[] = [], regions: Id[] = [], boxes: Id[] = [];
  for (const o of page.objects) {
    if (o.hidden || o.unselectable || opts.skip?.has(o.id)) continue;
    if (opts.classes && !opts.classes.includes(classOf(o))) continue;
    const r = results.get(o.id);
    if (!r?.shape || r.status !== 'ok') continue;
    const s = r.shape;
    let pointDist = Infinity, pathDist = Infinity, inRegion = false, inBox = false;
    const flat = (x: Shape): Shape[] => (x.k === 'multi' ? x.items.flatMap(flat) : [x]);
    for (const it of flat(s)) {
      // 每个迭代象是一个可选对象。比较最近的子图形，避免把同一 ID 反复送去求交。
      if (it.k === 'pt') pointDist = Math.min(pointDist, distTo(it, p, rad) ?? Infinity);
      else if (it.k === 'line' || it.k === 'circle' || it.k === 'arc' || it.k === 'paths') pathDist = Math.min(pathDist, distTo(it, p, rad) ?? Infinity);
      else if (it.k === 'poly' || it.k === 'disk' || it.k === 'sector') inRegion ||= insideRegion(it, p);
      else if (s.k === 'multi' && it.k === 'box') inBox ||= p.x >= it.at.x && p.x <= it.at.x + it.w && p.y >= it.at.y && p.y <= it.at.y + it.h;
    }
    if (pointDist < Infinity) { pts.push({ id: o.id, d: pointDist }); continue; }
    if (pathDist < Infinity) { paths.push({ id: o.id, d: pathDist }); continue; }
    if (inBox) { boxes.push(o.id); continue; }
    if (inRegion) { regions.push(o.id); continue; }
    const b = boxOf(o, s);
    if (s.k === 'box' && s.image && (!G.inPolygon(p, s.image.corners) || s.image.clips?.some(clip => !G.inPolygon(p, clip)) || (s.image.mesh && !warpHit(s.image.mesh, p)))) continue;
    if (b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) boxes.push(o.id);
  }
  // 后创建的对象在上面：同一优先级内先看距离，再看创建顺序（后者优先）
  // 悬停时每帧都走这里，多数时候没有候选或只有一个，不必为排序建表。
  if (pts.length + paths.length + regions.length + boxes.length <= 1) return [...pts.map(x => x.id), ...paths.map(x => x.id), ...boxes, ...regions];
  const order = new Map(page.objects.map((o, i) => [o.id, i]));
  pts.sort((a, b) => a.d - b.d || order.get(b.id)! - order.get(a.id)!);
  paths.sort((a, b) => a.d - b.d || order.get(b.id)! - order.get(a.id)!);
  regions.sort((a, b) => order.get(b)! - order.get(a)!);
  boxes.sort((a, b) => order.get(b)! - order.get(a)!);
  return [...pts.map(x => x.id), ...paths.map(x => x.id), ...boxes, ...regions];
}

/** 框选：任何部分与矩形相交即选中。 */
export function hitRect(page: Page, results: Results, rect: Rect): Id[] {
  const out: Id[] = [];
  for (const o of page.objects) {
    if (o.hidden || o.unselectable) continue;
    const r = results.get(o.id);
    if (!r?.shape || r.status !== 'ok') continue;
    if (shapeHitsRect(o, r.shape, rect)) out.push(o.id);
  }
  return out;
}

function shapeHitsRect(o: Obj, s: Shape, rect: Rect): boolean {
  if (s.k === 'multi') return s.items.some(it => shapeHitsRect(o, it, rect));
  {
    let hit = false;
    switch (s.k) {
      case 'pt': hit = s.p.x >= rect.x0 && s.p.x <= rect.x1 && s.p.y >= rect.y0 && s.p.y <= rect.y1; break;
      case 'line': {
        const { a, b, ext } = s.s;
        const d = G.sub(b, a), far = 1e5, l = G.len(d) || 1;
        const aa = ext === 'line' ? G.add(a, G.mul(d, -far / l)) : a, bb = ext === 'segment' ? b : G.add(a, G.mul(d, far / l));
        hit = G.segmentHitsRect(aa, bb, rect); break;
      }
      case 'circle': hit = G.circleHitsRect(s.c, rect); break;
      case 'arc': {
        if (!G.circleHitsRect({ c: s.c, r: s.r }, rect)) break;
        const n = Math.max(24, Math.ceil(Math.abs(s.sweep) * 24));
        for (let i = 0; i < n && !hit; i++) {
          const a1 = s.a0 + (s.sweep * i) / n, a2 = s.a0 + (s.sweep * (i + 1)) / n;
          hit = G.segmentHitsRect({ x: s.c.x + s.r * Math.cos(a1), y: s.c.y - s.r * Math.sin(a1) }, { x: s.c.x + s.r * Math.cos(a2), y: s.c.y - s.r * Math.sin(a2) }, rect);
        }
        break;
      }
      case 'poly': {
        const c = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
        hit = G.inPolygon(c, s.pts) || s.pts.some(q => q.x >= rect.x0 && q.x <= rect.x1 && q.y >= rect.y0 && q.y <= rect.y1) || s.pts.some((q, i) => G.segmentHitsRect(q, s.pts[(i + 1) % s.pts.length], rect));
        break;
      }
      case 'disk': case 'sector': hit = G.circleHitsRect({ c: s.c, r: s.r }, rect) || (rect.x0 <= s.c.x && s.c.x <= rect.x1 && rect.y0 <= s.c.y && s.c.y <= rect.y1) || (G.dist(s.c, { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }) <= s.r); break;
      case 'paths': hit = s.paths.some(pa => pa.some((q, i) => i + 1 < pa.length && G.segmentHitsRect(q, pa[i + 1], rect))); break;
      default: { const b = boxOf(o, s); hit = !!b && !(b.x1 < rect.x0 || b.x0 > rect.x1 || b.y1 < rect.y0 || b.y0 > rect.y1); }
    }
    return hit;
  }
}

export function nearestPointId(page: Page, results: Results, p: Pt, radius: number, skip?: Set<Id>): Id | undefined {
  let best: Id | undefined, bd = radius + 1e-9;
  for (const o of page.objects) {
    if (o.hidden || skip?.has(o.id) || classOf(o) !== 'point') continue;
    const s = results.get(o.id)?.shape;
    if (s?.k !== 'pt') continue;
    const d = G.dist(s.p, p);
    if (d <= bd) { bd = d; best = o.id; }
  }
  return best;
}

export { isLine };
