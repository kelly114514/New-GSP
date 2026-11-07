/** 几何与数学求值：按对象创建顺序（即依赖顺序）逐个计算，支持脏节点增量重算。 */
import * as G from './geom';
import type { Pt, Straight, Circ } from './geom';
import { byId, type Def, type Id, type Num, type Obj, type Page, parentsOf, descendants } from './model';
import { CM, derive, evalExpr, q, usesX, type Expr, type Q } from './expr';
import { parameterColor } from './color';
import { imageBox, imageCorners } from './image';

export type Shape =
  | { k: 'pt'; p: Pt }
  | { k: 'line'; s: Straight; axisOrigin?: Pt; axisUnit?: Pt }
  | { k: 'circle'; c: Circ }
  | { k: 'arc'; c: Pt; r: number; a0: number; sweep: number; from: Pt; to: Pt }
  | { k: 'poly'; pts: Pt[] }
  | { k: 'disk'; c: Pt; r: number }
  | { k: 'sector'; c: Pt; r: number; a0: number; sweep: number; segment: boolean }
  | { k: 'num'; q: Q }
  | { k: 'coords'; x: number; y: number }
  | { k: 'text'; text: string; eq?: { kind: 'line'; vertical: boolean; m: number; b: number; x: number } | { kind: 'circle'; cx: number; cy: number; r: number } }
  | { k: 'paths'; paths: Pt[][]; colors?: (string | undefined)[][] }
  | { k: 'sys'; origin: Pt; ux: Pt; uy: Pt }
  | { k: 'func' }
  | { k: 'table'; cols: { name: string; unit: string }[]; rows: number[][]; intFirst?: boolean }
  | { k: 'box'; at: Pt; w: number; h: number; image?: { data: string; mime: string; corners: Pt[]; clip?: Pt[] }; textValues?: (Extract<Shape, { k: 'num' | 'coords' }> | undefined)[] }
  | { k: 'multi'; items: Shape[]; colors?: (string | undefined)[] } // 迭代象、非点对象轨迹
  | { k: 'iter'; states: Result[][]; chain?: Result[][] };                    // 迭代对象本身：要显示的各层状态（每个状态是各前像的取值）
export type Status = 'ok' | 'undefined' | 'missing' | 'unsupported';
export interface Result { shape?: Shape; status: Status; color?: string }
export type Results = Map<Id, Result>;
export interface EvalCtx {
  /** 当前页面显示区域（页面坐标），函数图像据此取样。 */
  view?: { x0: number; y0: number; x1: number; y1: number };
  /** 动画运行时状态：不写入文档定义，暂停或关闭文档后即丢弃。 */
  tOverride?: Map<Id, number>;
  valOverride?: Map<Id, number>;
  posOverride?: Map<Id, Pt>;
}

const OK = (shape: Shape): Result => ({ shape, status: 'ok' });
const UNDEF: Result = { status: 'undefined' };
const MISSING: Result = { status: 'missing' };

export const isPt = (s?: Shape): s is Extract<Shape, { k: 'pt' }> => s?.k === 'pt';
export const isLine = (s?: Shape): s is Extract<Shape, { k: 'line' }> => s?.k === 'line';
export const isCirc = (s?: Shape): s is Extract<Shape, { k: 'circle' }> => s?.k === 'circle';

export function evaluatePage(page: Page, changed?: Iterable<Id>, prev?: Results, ctx: EvalCtx = {}): Results {
  const map = new Map(page.objects.map(o => [o.id, o]));
  const dirty = changed && prev ? new Set<Id>([...changed, ...descendants(page, changed)]) : undefined;
  const results: Results = prev && dirty ? new Map(prev) : new Map();
  const visiting = new Set<Id>();
  const get = (id: Id): Result => {
    const cached = results.get(id);
    if (cached && !dirty?.has(id)) return cached;
    const o = map.get(id);
    if (!o) return MISSING;
    if (visiting.has(id)) return UNDEF;
    visiting.add(id);
    const r = evalObject(o, get, page, ctx, results);
    visiting.delete(id);
    dirty?.delete(id);
    results.set(id, r);
    return r;
  };
  for (const o of page.objects) get(o.id);
  return results;
}

/** 计算对象 id 的求值依赖函数（驱动点被替换后用于轨迹取样）。 */
type Get = (id: Id) => Result;

function sh(get: Get, id: Id): Shape | undefined { return get(id).shape; }
function pointOf(get: Get, id: Id): Pt | undefined { const s = sh(get, id); return isPt(s) ? s.p : undefined; }
function straightOf(get: Get, id: Id): Straight | undefined { const s = sh(get, id); return isLine(s) ? s.s : undefined; }
function circleOf(get: Get, id: Id): Circ | undefined {
  const s = sh(get, id);
  if (isCirc(s)) return s.c;
  if (s?.k === 'arc') return { c: s.c, r: s.r };
  return undefined;
}
/** 数值型对象（度量、参数、计算）的值。 */
export function qOf(get: Get, id: Id): Q | undefined { const s = sh(get, id); return s?.k === 'num' ? s.q : undefined; }
function numOf(get: Get, n: Num, scale = 1): number | undefined {
  if ('fixed' in n) return n.fixed;
  if ('pts' in n) { const [a, v, b] = n.pts.map(i => pointOf(get, i)); return a && v && b ? angleMeasure(a, v, b) : undefined; }
  const v = qOf(get, n.m)?.v; return v === undefined ? undefined : v * scale;
}

export function arcShape(c: Pt, r: number, a0: number, sweep: number): Shape {
  return { k: 'arc', c, r, a0, sweep, from: { x: c.x + r * Math.cos(a0), y: c.y - r * Math.sin(a0) }, to: { x: c.x + r * Math.cos(a0 + sweep), y: c.y - r * Math.sin(a0 + sweep) } };
}

/** 角度度量：从边 b→a 逆时针转到 b→c，取 0..360 度。 */
export function angleMeasure(a: Pt, v: Pt, b: Pt): number | undefined {
  if (G.dist(a, v) < G.EPS || G.dist(b, v) < G.EPS) return undefined;
  return (G.sweep(G.angleOf(v, a), G.angleOf(v, b)) * 180) / Math.PI;
}

export function systemUnit(s: Extract<Shape, { k: 'sys' }>) { return s; }
export function toSys(sys: Extract<Shape, { k: 'sys' }>, p: Pt): { x: number; y: number } | undefined {
  const d = G.sub(p, sys.origin), ux = sys.ux, uy = sys.uy, det = G.cross(ux, uy);
  if (Math.abs(det) < G.EPS) return undefined;
  return { x: G.cross(d, uy) / det, y: G.cross(ux, d) / det };
}
export function fromSys(sys: Extract<Shape, { k: 'sys' }>, x: number, y: number): Pt {
  return { x: sys.origin.x + sys.ux.x * x + sys.uy.x * y, y: sys.origin.y + sys.ux.y * x + sys.uy.y * y };
}

/** 路径上的点：参数到坐标。 */
export function pathPointAt(path: Shape | undefined, t: number): Pt | undefined {
  if (!path) return undefined;
  switch (path.k) {
    case 'line': return G.pointAt(path.s, G.clampParam(path.s.ext, t));
    case 'circle': return { x: path.c.c.x + path.c.r * Math.cos(t), y: path.c.c.y - path.c.r * Math.sin(t) };
    case 'arc': { const u = Math.min(1, Math.max(0, t)); const a = path.a0 + path.sweep * u; return { x: path.c.x + path.r * Math.cos(a), y: path.c.y - path.r * Math.sin(a) }; }
    case 'poly': return polyPerimeterPoint(path.pts, t);
    case 'disk': return { x: path.c.x + path.r * Math.cos(t), y: path.c.y - path.r * Math.sin(t) };
    case 'sector': { const u = Math.min(1, Math.max(0, t)); const a = path.a0 + path.sweep * u; return { x: path.c.x + path.r * Math.cos(a), y: path.c.y - path.r * Math.sin(a) }; }
    case 'paths': { const pts = path.paths.flat(); if (!pts.length) return undefined; const i = Math.min(pts.length - 1, Math.max(0, Math.round(t * (pts.length - 1)))); return pts[i]; }
  }
  return undefined;
}

export function polyPerimeterPoint(pts: Pt[], t: number): Pt | undefined {
  if (pts.length < 2) return undefined;
  const total = G.polygonPerimeter(pts);
  if (total < G.EPS) return pts[0];
  let want = (((t % 1) + 1) % 1) * total;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = G.dist(a, b);
    if (want <= l) return G.add(a, G.mul(G.sub(b, a), l < G.EPS ? 0 : want / l));
    want -= l;
  }
  return pts[0];
}

/** 把点投影到路径，返回参数与最近点；用于约束拖动与"在路径上放点"。 */
/** 路径是不是某个坐标系的坐标轴。 */
export function isAxisLine(page: Page, id: Id): boolean { return page.objects.some(o => o.def.k === 'sys' && (o.def.axisX === id || o.def.axisY === id)); }
/** 把点投影到路径上，给出“路径上的点”的定义字段：坐标轴上用页面像素（abs），其它路径与 projectToPath 相同。 */
export function projectOnPath(page: Page, results: Results, pathId: Id, p: Pt): { t: number; p: Pt; abs?: true } | undefined {
  const shape = results.get(pathId)?.shape, pr = projectToPath(shape, p);
  if (!pr) return undefined;
  if (shape?.k === 'line' && isAxisLine(page, pathId)) {
    const a = shape.s.a, b = shape.s.b, len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0) return { t: ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len, p: pr.p, abs: true };
  }
  return pr;
}

export function projectToPath(path: Shape | undefined, p: Pt): { t: number; p: Pt } | undefined {
  if (!path) return undefined;
  switch (path.k) {
    case 'line': { const t = G.projectParam(path.s, p); if (t === undefined) return undefined; const tc = G.clampParam(path.s.ext, t); return { t: tc, p: G.pointAt(path.s, tc) }; }
    case 'circle': case 'disk': {
      const c = path.k === 'circle' ? path.c.c : path.c, r = path.k === 'circle' ? path.c.r : path.r;
      const t = G.angleOf(c, p);
      return { t, p: { x: c.x + r * Math.cos(t), y: c.y - r * Math.sin(t) } };
    }
    case 'arc': case 'sector': {
      const c = path.k === 'arc' ? path.c : path.c, r = path.r, ang = G.angleOf(c, p), off = G.sweep(path.a0, ang);
      const u = path.sweep < G.EPS ? 0 : off <= path.sweep ? off / path.sweep : off - path.sweep < G.TAU - off ? 1 : 0;
      const a = path.a0 + path.sweep * u;
      return { t: u, p: { x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) } };
    }
    case 'poly': {
      const pts = path.pts, total = G.polygonPerimeter(pts);
      let best: { t: number; p: Pt; d: number } | undefined, acc = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], seg = { a, b, ext: 'segment' as const }, tt = G.projectParam(seg, p);
        const l = G.dist(a, b);
        if (tt !== undefined) {
          const pp = G.pointAt(seg, G.clampParam('segment', tt)), d = G.dist(pp, p);
          if (!best || d < best.d) best = { t: total < G.EPS ? 0 : (acc + l * G.clampParam('segment', tt)) / total, p: pp, d };
        }
        acc += l;
      }
      return best && { t: best.t, p: best.p };
    }
    case 'paths': {
      const pts = path.paths.flat();
      let bi = -1, bd = Infinity;
      pts.forEach((q2, i) => { const d = G.dist(q2, p); if (d < bd) { bd = d; bi = i; } });
      return bi < 0 ? undefined : { t: pts.length > 1 ? bi / (pts.length - 1) : 0, p: pts[bi] };
    }
  }
  return undefined;
}

export function sampleFunction(f: (x: number) => number | undefined, x0: number, x1: number, n: number, toPt: (x: number, y: number) => Pt, clipY: [number, number]): Pt[][] {
  const paths: Pt[][] = [];
  let cur: Pt[] = [];
  let last: number | undefined;
  const [y0, y1] = clipY;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = f(x);
    if (y === undefined || !Number.isFinite(y)) { if (cur.length > 1) paths.push(cur); cur = []; last = undefined; continue; }
    // 渐近线附近的陡变：跨过很大的 y 跳变时断开，避免错误连线
    // 渐近线：相邻两点异号且都远超出视图高度，或跳变特别大，则断开
    const span = Math.max(1e-9, y1 - y0);
    if (last !== undefined && ((Math.sign(y) !== Math.sign(last) && Math.min(Math.abs(y), Math.abs(last)) > span) || Math.abs(y - last) > Math.max(40 * span, 1e6))) { if (cur.length > 1) paths.push(cur); cur = []; }
    last = y;
    cur.push(toPt(x, y));
  }
  if (cur.length > 1) paths.push(cur);
  return paths;
}

/** 平移/旋转/缩放/反射共同的点映射：f 映射点，scale 是长度比例，flip 表示反向（反射）。 */
interface TMap { f: (p: Pt) => Pt | undefined; scale: number; flip: boolean }

function transformOf(d: Def, get: Get): TMap | undefined {
  switch (d.k) {
    case 'translate': {
      const by = d.by;
      if (by.mode === 'vector') { const a = pointOf(get, by.from), b = pointOf(get, by.to); if (!a || !b) return undefined; const v = G.sub(b, a); return { f: p => G.add(p, v), scale: 1, flip: false }; }
      if (by.mode === 'rect') {
        const dx = by.dxBy !== undefined ? qOf(get, by.dxBy)?.v : by.dx, dy = by.dyBy !== undefined ? qOf(get, by.dyBy)?.v : by.dy;
        if (dx === undefined || dy === undefined) return undefined;
        return { f: p => ({ x: p.x + dx * CM, y: p.y - dy * CM }), scale: 1, flip: false };
      }
      const dist = numOf(get, by.dist), ang = numOf(get, by.angle);
      if (dist === undefined || ang === undefined) return undefined;
      const rad = (ang * Math.PI) / 180;
      return { f: p => ({ x: p.x + dist * CM * Math.cos(rad), y: p.y - dist * CM * Math.sin(rad) }), scale: 1, flip: false };
    }
    case 'rotate': {
      const c = pointOf(get, d.center); if (!c) return undefined;
      let deg: number | undefined;
      if (d.angle.mode === 'fixed') deg = d.angle.deg;
      else if (d.angle.mode === 'value') deg = qOf(get, d.angle.m)?.v;
      else { const a = pointOf(get, d.angle.a), v = pointOf(get, d.angle.v), b = pointOf(get, d.angle.b); deg = a && v && b ? angleMeasure(a, v, b) : undefined; }
      if (deg === undefined) return undefined;
      const rad = (deg * Math.PI) / 180;
      return { f: p => G.rotatePt(p, c, rad), scale: 1, flip: false };
    }
    case 'dilate': {
      const c = pointOf(get, d.center); if (!c) return undefined;
      let k: number | undefined;
      if (d.ratio.mode === 'fixed') k = d.ratio.den === 0 ? undefined : d.ratio.num / d.ratio.den;
      else if (d.ratio.mode === 'value') k = qOf(get, d.ratio.m)?.v;
      else if (d.ratio.c !== undefined) { const pa = pointOf(get, d.ratio.a), pb = pointOf(get, d.ratio.b), pc = pointOf(get, d.ratio.c); const lab = pa && pb && G.dist(pa, pb); k = pa && pc && lab && lab > G.EPS ? G.dist(pa, pc) / lab : undefined; }
      else { const a = straightOf(get, d.ratio.a), b = straightOf(get, d.ratio.b); const lb = b && G.dist(b.a, b.b); k = a && lb && lb > G.EPS ? G.dist(a.a, a.b) / lb : undefined; }
      if (k === undefined || !Number.isFinite(k)) return undefined;
      return { f: p => G.dilatePt(p, c, k!), scale: Math.abs(k), flip: false };
    }
    case 'reflect': {
      const m = straightOf(get, d.mirror); if (!m || G.dist(m.a, m.b) < G.EPS) return undefined;
      return { f: p => G.reflectPt(p, m), scale: 1, flip: true };
    }
    default: return undefined;
  }
}

/** 把一个图形整体做变换；不支持的图形（数值、文本、函数等）返回 undefined。 */
function mapShape(s: Shape, t: TMap): Shape | undefined {
  const all = (pts: Pt[]) => { const out: Pt[] = []; for (const p of pts) { const q = t.f(p); if (!q || !G.finite(q)) return undefined; out.push(q); } return out; };
  switch (s.k) {
    case 'pt': { const r = all([s.p]); return r && { k: 'pt', p: r[0] }; }
    case 'line': { const r = all([s.s.a, s.s.b]); return r && { k: 'line', s: { a: r[0], b: r[1], ext: s.s.ext } }; }
    case 'box': {
      if (!s.image) return undefined;
      const corners = all(s.image.corners), clip = s.image.clip ? all(s.image.clip) : undefined;
      if (!corners || (s.image.clip && !clip)) return undefined;
      return { k: 'box', ...imageBox(corners), image: { ...s.image, corners, clip } };
    }
    case 'poly': { const r = all(s.pts); return r && { k: 'poly', pts: r }; }
    case 'circle': { const r = all([s.c.c]); return r && { k: 'circle', c: { c: r[0], r: s.c.r * t.scale } }; }
    case 'disk': { const r = all([s.c]); return r && { k: 'disk', c: r[0], r: s.r * t.scale }; }
    case 'arc': {
      const r = all([s.c, s.from]); if (!r) return undefined;
      return arcShape(r[0], s.r * t.scale, G.angleOf(r[0], r[1]), t.flip ? -s.sweep : s.sweep);
    }
    case 'sector': {
      const from = { x: s.c.x + s.r * Math.cos(s.a0), y: s.c.y - s.r * Math.sin(s.a0) };
      const r = all([s.c, from]); if (!r) return undefined;
      return { k: 'sector', c: r[0], r: s.r * t.scale, a0: G.angleOf(r[0], r[1]), sweep: t.flip ? -s.sweep : s.sweep, segment: s.segment };
    }
    default: return undefined;
  }
}

/** 迭代的次数上限和状态总数上限：防止深度很大时卡死（原版也有上限，具体数值未知）。 */
const ITER_MAX_DEPTH = 20, ITER_MAX_STATES = 60000;

type IterDef = Extract<Def, { k: 'iterate' }>;
const stateGetters = new WeakMap<Result[], Get>();

/** 在某个状态（前像的取值）下求任意对象的值：前像用状态里的值，body 里的对象重新算，其余对象沿用原值。 */
function underState(d: IterDef, state: Result[], get: Get, page: Page, ctx: EvalCtx, results: Results): Get {
  const cached = stateGetters.get(state);
  if (cached) return cached;
  const bodySet = new Set(d.body);
  const subst = new Map<Id, Result>(d.pre.map((id, i) => [id, state[i]]));
  const memo = new Map<Id, Result>(), visiting = new Set<Id>();
  const g: Get = id => {
    const s = subst.get(id); if (s) return s;
    if (!bodySet.has(id)) return get(id);
    const m = memo.get(id); if (m) return m;
    const ob = byId(page, id); if (!ob) return MISSING;
    if (visiting.has(id)) return UNDEF;
    visiting.add(id); const r = evalObject(ob, g, page, ctx, results); visiting.delete(id);
    memo.set(id, r); return r;
  };
  stateGetters.set(state, g);
  return g;
}

/** 求值 iterate：逐层把前像换成映射的初象，记下要显示的各层状态；每个迭代象再在这些状态下求自己的原象。 */
function evalIterate(_o: Obj, d: IterDef, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const dv = 'param' in d.depth ? qOf(get, d.depth.param)?.v : d.depth.fixed;
  if (dv === undefined || !Number.isFinite(dv)) return UNDEF;
  const depth = Math.max(0, Math.min(ITER_MAX_DEPTH, Math.round(dv)));
  const pre = d.pre.map(id => get(id));
  const bad = pre.find(r => r.status !== 'ok' || !r.shape);
  if (bad) return bad.status === 'missing' || bad.status === 'unsupported' ? MISSING : UNDEF;
  let states: Result[][] = [pre], total = 0, capped = false;
  const shown: Result[][] = [], chain: Result[][] = [];
  for (let level = 0; level <= depth && states.length; level++) {
    if (d.maps.length === 1 && states.length === 1) chain.push(states[0]);
    if (level >= 1 && (!d.finalOnly || level === depth || capped)) shown.push(...states);
    if (level === depth || capped) break;
    const next: Result[][] = [];
    outer: for (const st of states) {
      const g = underState(d, st, get, page, ctx, results);
      for (const mp of d.maps) {
        const ns = mp.map(id => g(id));
        if (ns.every(r => r.status === 'ok' && r.shape)) { next.push(ns); if (++total >= ITER_MAX_STATES) { capped = true; break outer; } }
      }
    }
    states = next;
  }
  return OK({ k: 'iter', states: shown, ...(d.maps.length === 1 ? { chain } : {}) });
}

/** 迭代数据表：每一层状态一行，[序号, 各数值初象的值]。 */
function evalIterTable(d: Extract<Def, { k: 'itertable' }>, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const it = get(d.iter), s = it.shape, io = byId(page, d.iter);
  if (s?.k !== 'iter' || !s.chain || io?.def.k !== 'iterate') return it.status === 'missing' ? MISSING : UNDEF;
  const rows = s.chain.map((st, k) => { const g = underState(io.def as IterDef, st, get, page, ctx, results); return [k, ...d.cols.map(c => { const r = g(c).shape; return r?.k === 'num' ? r.q.v : NaN; })]; });
  return OK({ k: 'table', cols: [{ name: '', unit: 'none' }, ...d.cols.map(() => ({ name: '', unit: 'none' }))], rows, intFirst: true });
}

/** 迭代象：迭代 iter 的每个显示状态下，src 的值。 */
function evalIterImage(d: Extract<Def, { k: 'iterimg' }>, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const it = get(d.iter), s = it.shape, io = byId(page, d.iter);
  if (s?.k !== 'iter' || io?.def.k !== 'iterate') return it.status === 'missing' ? MISSING : UNDEF;
  const source = byId(page, d.src)?.def, items: Shape[] = [], colors: (string | undefined)[] = [];
  for (const st of s.states) {
    const valueAt = underState(io.def, st, get, page, ctx, results);
    const r = valueAt(d.src);
    if (r.status !== 'ok' || !r.shape || r.shape.k === 'num') continue;
    if (r.shape.k === 'box' && source?.k === 'text' && source.refs?.length) {
      const textValues = source.refs.map(id => {
        const shape = valueAt(id).shape;
        return shape?.k === 'num' || shape?.k === 'coords' ? shape : undefined;
      });
      items.push({ ...r.shape, textValues });
    } else items.push(r.shape);
    colors.push(r.color);
  }
  return items.length ? OK({ k: 'multi', items, ...(colors.some(Boolean) ? { colors } : {}) }) : UNDEF;
}

function evalObject(o: Obj, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const d = o.def;
  const moving = ctx.posOverride?.get(o.id);
  if (moving) return OK({ k: 'pt', p: moving });
  // 迭代和迭代象不要求所有父对象当前都有定义：前像换成别的值之后，某些对象才有定义
  if (d.k === 'iterate') return evalIterate(o, d, get, page, ctx, results);
  if (d.k === 'iterimg') return evalIterImage(d, get, page, ctx, results);
  if (d.k === 'itertable') return evalIterTable(d, get, page, ctx, results);
  // 轨迹在路径上重新求值，当前驱动位置的无定义不影响其它样本。
  if (d.k === 'locus') return evalLocus(d, o, page, get, results, ctx);
  if (d.k === 'iterpt') { const m = get(d.img).shape; const last = m?.k === 'multi' ? m.items[m.items.length - 1] : undefined; return last?.k === 'pt' ? OK(last) : UNDEF; }
  if (d.k === 'custom-point') {
    const source = get(d.src);
    if (source.shape?.k !== 'pt') return UNDEF;
    return underState({ k: 'iterate', pre: [d.pre], maps: [[d.img]], body: [...new Set([...d.body, d.img])], depth: { fixed: 1 } }, [source], get, page, ctx, results)(d.img);
  }
  const par = parentsOf(d);
  // 父对象缺结果：保留定义，等待条件恢复
  for (const id of par) { const r = get(id); if (r.status === 'missing' || r.status === 'unsupported') return MISSING; if (r.status !== 'ok') return r.status === 'undefined' ? UNDEF : MISSING; }
  switch (d.k) {
    case 'free': { const p = ctx.posOverride?.get(o.id) ?? { x: d.x, y: d.y }; return Number.isFinite(p.x) && Number.isFinite(p.y) ? OK({ k: 'pt', p }) : UNDEF; }
    case 'onpath': {
      const shape = sh(get, d.path), t = ctx.tOverride?.get(o.id) ?? d.t;
      if (d.abs && shape?.k === 'line') { const a = shape.s.a, b = shape.s.b, len = Math.hypot(b.x - a.x, b.y - a.y); return len > 0 ? OK({ k: 'pt', p: { x: a.x + ((b.x - a.x) / len) * t, y: a.y + ((b.y - a.y) / len) * t } }) : UNDEF; }
      const p = pathPointAt(shape, t); return p ? OK({ k: 'pt', p }) : UNDEF;
    }
    case 'combine': { const path = sh(get, d.path), p = pointOf(get, d.src); const pr = p && projectToPath(path, p); return pr ? OK({ k: 'pt', p: pr.p }) : UNDEF; }
    case 'mid': { const s = straightOf(get, d.seg); return s ? OK({ k: 'pt', p: G.mid(s.a, s.b) }) : UNDEF; }
    case 'inter': return evalIntersection(d, get);
    case 'translate': case 'rotate': case 'dilate': case 'reflect': {
      const src = sh(get, d.src); if (!src) return UNDEF;
      const tm = transformOf(d, get); if (!tm) return UNDEF;
      const out = mapShape(src, tm);
      return out ? OK(out) : UNDEF;
    }
    case 'axispt': { const sys = sh(get, d.sys), v = qOf(get, d.value); return sys?.k === 'sys' && v ? OK({ k: 'pt', p: d.axis === 'x' ? fromSys(sys, v.v, 0) : fromSys(sys, 0, v.v) }) : UNDEF; }
    case 'plotfix': { const sys = sh(get, d.sys); return sys?.k === 'sys' ? OK({ k: 'pt', p: fromSys(sys, d.x, d.y) }) : UNDEF; }
    case 'plotxy': {
      const sys = sh(get, d.sys), x = qOf(get, d.x), y = qOf(get, d.y);
      if (sys?.k !== 'sys' || !x || !y) return UNDEF;
      const a = y.u === 'angle' ? y.v * Math.PI / 180 : y.v;
      return OK({ k: 'pt', p: d.polar ? fromSys(sys, x.v * Math.cos(a), x.v * Math.sin(a)) : fromSys(sys, x.v, y.v) });
    }
    case 'colorize': {
      const r = get(d.src), values = d.params.map(id => qOf(get, id)?.v ?? NaN), color = parameterColor(d, values);
      return color && r.status === 'ok' ? { ...r, color } : UNDEF;
    }
    case 'axis-line': {
      const circle = d.mode === 'circle' ? circleOf(get, d.unit) : undefined;
      const origin = circle?.c ?? (d.origin !== undefined ? pointOf(get, d.origin) : undefined);
      const seg = straightOf(get, d.unit), value = qOf(get, d.unit);
      const scale = circle?.r ?? (seg ? G.dist(seg.a, seg.b) : value ? value.v * CM : NaN);
      if (!origin || !Number.isFinite(scale) || scale <= 0) return UNDEF;
      const v = d.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: -1 };
      return OK({ k: 'line', s: { a: origin, b: G.add(origin, G.mul(v, scale)), ext: 'line' }, axisOrigin: origin, axisUnit: G.mul(v, scale) });
    }
    case 'axis-unit': {
      const axis = sh(get, d.axis);
      if (axis?.k !== 'line') return UNDEF;
      const origin = (d.origin !== undefined ? pointOf(get, d.origin) : undefined) ?? axis.axisOrigin ?? axis.s.a;
      const distance = d.distance ?? (axis.axisUnit ? G.len(axis.axisUnit) : G.dist(axis.s.a, axis.s.b));
      return OK({ k: 'pt', p: d.direction === 'x' ? { x: origin.x + distance, y: origin.y } : { x: origin.x, y: origin.y - distance } });
    }
    case 'pointval': {
      const pdef = byId(page, d.path)?.def, v0 = d.value !== undefined ? qOf(get, d.value) : d.fixed !== undefined ? q(d.fixed) : undefined;
      if (pdef?.k === 'plot') {         // 函数图像上的点：值是横坐标，纵坐标由函数给出
        const sys = sh(get, pdef.sys), y = v0 && callFunc(get, page, pdef.func, q(v0.v));
        return sys?.k === 'sys' && v0 && y ? OK({ k: 'pt', p: fromSys(sys, v0.v, y.v) }) : UNDEF;
      }
      const path = sh(get, d.path), v = v0; if (!path || !v) return UNDEF;
      const t = path.k === 'line' && path.s.ext === 'segment' ? v.v : v.v;
      const p = pathPointAt(path, path.k === 'circle' ? t * G.TAU : t); return p ? OK({ k: 'pt', p }) : UNDEF;
    }
    case 'seg': case 'ray': case 'line': {
      const a = pointOf(get, d.a), b = pointOf(get, d.b);
      return a && b && G.finite(a) && G.finite(b) ? OK({ k: 'line', s: { a, b, ext: d.k === 'seg' ? 'segment' : d.k } }) : UNDEF;
    }
    case 'parallel': case 'perp': {
      const p = pointOf(get, d.pt), l = straightOf(get, d.line); if (!p || !l) return UNDEF;
      let v = G.sub(l.b, l.a); if (G.len(v) < G.EPS) return UNDEF;
      if (d.k === 'perp') v = { x: -v.y, y: v.x };
      return OK({ k: 'line', s: { a: p, b: G.add(p, v), ext: 'line' } });
    }
    case 'bisect': {
      const a = pointOf(get, d.a), v = pointOf(get, d.v), b = pointOf(get, d.b); if (!a || !v || !b) return UNDEF;
      const ua = G.unit(G.sub(a, v)), ub = G.unit(G.sub(b, v)); if (!ua || !ub) return UNDEF;
      let dir = G.add(ua, ub);
      if (G.len(dir) < 1e-9) dir = { x: -ua.y, y: ua.x };      // 平角：取垂直方向（逆时针一侧）
      return OK({ k: 'line', s: { a: v, b: G.add(v, dir), ext: 'ray' } });
    }
    case 'circle': { const c = pointOf(get, d.c), p = pointOf(get, d.p); return c && p ? OK({ k: 'circle', c: { c, r: G.dist(c, p) } }) : UNDEF; }
    case 'circle-seg': {
      // 以圆心和半径绘圆：半径可以是线段，也可以是距离度量值/计算结果（单位厘米）
      const c = pointOf(get, d.c), s = straightOf(get, d.seg), rv = sh(get, d.seg);
      const r = s ? G.dist(s.a, s.b) : rv?.k === 'num' ? rv.q.v * CM : undefined;
      return c && r !== undefined && Number.isFinite(r) && r >= 0 ? OK({ k: 'circle', c: { c, r } }) : UNDEF;
    }
    case 'arc-circle': {
      const c = circleOf(get, d.circle), a = pointOf(get, d.a), b = pointOf(get, d.b); if (!c || !a || !b) return UNDEF;
      const a0 = G.angleOf(c.c, a), sweep = G.sweep(a0, G.angleOf(c.c, b));
      return OK(arcShape(c.c, c.r, a0, sweep));
    }
    case 'arc3': {
      const a = pointOf(get, d.a), b = pointOf(get, d.b), c = pointOf(get, d.c); if (!a || !b || !c) return UNDEF;
      const circ = G.circleThrough3(a, b, c); if (!circ) return UNDEF;
      const aa = G.angleOf(circ.c, a), ab = G.angleOf(circ.c, b), ac = G.angleOf(circ.c, c);
      const ccw = G.sweep(aa, ab) < G.sweep(aa, ac);
      return OK(ccw ? arcShape(circ.c, circ.r, aa, G.sweep(aa, ac)) : arcShape(circ.c, circ.r, ac, G.sweep(ac, aa)));
    }
    case 'arc-center': {
      const c = pointOf(get, d.c), a = pointOf(get, d.a), b = pointOf(get, d.b);
      if (!c || !a || !b || G.dist(c, a) < G.EPS || G.dist(c, b) < G.EPS) return UNDEF;
      const a0 = G.angleOf(c, a);
      return OK(arcShape(c, G.dist(c, a), a0, G.sweep(a0, G.angleOf(c, b))));
    }
    case 'angle-mark': {
      const a = pointOf(get, d.a), v = pointOf(get, d.v), b = pointOf(get, d.b);
      const u = a && v && G.unit(G.sub(a, v)), w = b && v && G.unit(G.sub(b, v));
      if (!v || !u || !w) return UNDEF;
      const size = 12;
      if (Math.abs(G.dot(u, w)) < 1e-7) return OK({ k: 'paths', paths: [[G.add(v, G.mul(u, size)), G.add(v, G.mul(G.add(u, w), size)), G.add(v, G.mul(w, size))]] });
      const a0 = G.angleOf(v, a!), sweep = G.sweep(a0, G.angleOf(v, b!));
      return OK({ k: 'paths', paths: Array.from({ length: Math.max(1, d.count) }, (_, j) => Array.from({ length: 25 }, (_, i) => ({ x: v.x + (size + 4 * j) * Math.cos(a0 + sweep * i / 24), y: v.y - (size + 4 * j) * Math.sin(a0 + sweep * i / 24) }))) });
    }
    case 'poly': { const pts = d.pts.map(id => pointOf(get, id)); return pts.every(Boolean) && pts.length >= 3 ? OK({ k: 'poly', pts: pts as Pt[] }) : UNDEF; }
    case 'circle-int': { const c = circleOf(get, d.circle); return c ? OK({ k: 'disk', c: c.c, r: c.r }) : UNDEF; }
    case 'arc-int': { const s = sh(get, d.arc); return s?.k === 'arc' ? OK({ k: 'sector', c: s.c, r: s.r, a0: s.a0, sweep: s.sweep, segment: d.mode === 'segment' }) : UNDEF; }
    case 'plot': return evalPlot(d, get, page, ctx);
    case 'pcurve': return evalPcurve(d, get, page);
    case 'measure': return evalMeasure(d, get);
    case 'param': return OK({ k: 'num', q: q(ctx.valOverride?.get(o.id) ?? d.value, d.unit) });
    case 'calc': {
      const v = evalExpr(d.expr, { ref: id => qOf(get, id), call: (f, a) => callFunc(get, page, f, a) });
      return v ? OK({ k: 'num', q: d.unit !== 'none' && v.u === 'none' ? q(v.v, d.unit) : v }) : UNDEF;
    }
    case 'func': return functionExpression(page, o.id) ? OK({ k: 'func' }) : UNDEF;
    case 'picfunc': { const source = sh(get, d.stroke); return sh(get, d.sys)?.k === 'sys' && (byId(page, d.stroke)?.def.k === 'stroke' || (source?.k === 'box' && source.image && d.profile?.length)) ? OK({ k: 'func' }) : UNDEF; }
    case 'table': {
      const cols = d.cols.map(id => ({ name: byId(page, id)?.label ?? '', unit: qOf(get, id)?.u ?? 'none' }));
      return OK({ k: 'table', cols, rows: d.rows });
    }
    case 'sys': {
      const origin = pointOf(get, d.origin), ux = pointOf(get, d.unitX), uy = pointOf(get, d.unitY);
      const ax = sh(get, d.axisX), ay = sh(get, d.axisY);
      if (ax?.k === 'line' && ay?.k === 'line') {
        const org = origin ?? ax.axisOrigin ?? ay.axisOrigin ?? G.intersectStraights(ax.s, ay.s);
        if (org) return OK({ k: 'sys', origin: org, ux: ax.axisUnit ?? (ux ? G.sub(ux, org) : G.sub(ax.s.b, ax.s.a)), uy: ay.axisUnit ?? (uy ? G.sub(uy, org) : G.sub(ay.s.b, ay.s.a)) });
      }
      return origin && ux && uy ? OK({ k: 'sys', origin, ux: G.sub(ux, origin), uy: G.sub(uy, origin) }) : UNDEF;
    }
    case 'text': {
      if (d.anchor !== undefined && d.off) { const ap = pointOf(get, d.anchor); return ap ? OK({ k: 'box', at: { x: ap.x + d.off.x, y: ap.y + d.off.y }, w: d.w, h: d.h }) : UNDEF; }
      return OK({ k: 'box', at: d.at, w: d.w, h: d.h });
    }
    case 'button': return OK({ k: 'box', at: d.at, w: d.w, h: d.h });
    case 'image': {
      const corners = imageCorners(d), clip = d.clip !== undefined ? sh(get, d.clip) : undefined;
      if (corners.some(p => !G.finite(p)) || (d.clip !== undefined && clip?.k !== 'poly')) return UNDEF;
      return OK({ k: 'box', ...imageBox(corners), image: { data: d.data, mime: d.mime, corners, ...(clip?.k === 'poly' ? { clip: clip.pts } : {}) } });
    }
    case 'stroke': return OK({ k: 'paths', paths: [d.pts] });
    case 'unknown': return { status: 'unsupported' };
  }
}

/** 页面上某个函数（含绘图函数）在 x 处的值（声音按钮等不经过求值缓存的用法）。 */
export function evalFunction(page: Page, results: Results, id: Id, x: number): number | undefined {
  return callFunc(id2 => results.get(id2) ?? UNDEF, page, id, q(x))?.v;
}

/** 绘图函数在 x 处的值：笔迹折线在坐标系里与竖线 x 相交处 y 的平均；x 超出笔迹范围时无定义。 */
function picValue(get: Get, page: Page, d: Extract<Def, { k: 'picfunc' }>, x: number): Q | undefined {
  const sys = sh(get, d.sys), source = byId(page, d.stroke);
  if (sys?.k !== 'sys') return undefined;
  let paths: Pt[][];
  if (source?.def.k === 'stroke') paths = [source.def.pts];
  else {
    const shape = sh(get, d.stroke);
    if (shape?.k !== 'box' || !shape.image || !d.profile) return undefined;
    const [p, px, , py] = shape.image.corners;
    paths = d.profile.map(path => path.map(q => ({ x: p.x + q.x * (px.x - p.x) + q.y * (py.x - p.x), y: p.y + q.x * (px.y - p.y) + q.y * (py.y - p.y) })));
    if (shape.image.clip) paths = paths.flatMap(path => { const pieces: Pt[][] = []; let part: Pt[] = []; for (const p of path) { if (G.inPolygon(p, shape.image!.clip!)) part.push(p); else if (part.length) { pieces.push(part); part = []; } } if (part.length) pieces.push(part); return pieces; });
  }
  let sum = 0, n = 0;
  for (const path of paths) {
    const pts = path.map(p => toSys(sys, p)).filter((p): p is Pt => !!p);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.x === b.x || x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue;
      sum += a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x); n++;
    }
  }
  return n ? q(sum / n) : undefined;
}

/** 用户函数的值。 */
const derivativeCache = new WeakMap<Def, { source: Expr; expr: Expr | undefined }>();
/** 来源关系优先于显示用缓存，编辑原函数后导函数与高阶导函数立即跟随。 */
export function functionExpression(page: Page, id: Id, visiting = new Set<Id>()): Expr | undefined {
  const f = byId(page, id);
  if (f?.def.k !== 'func' || visiting.has(id)) return undefined;
  if (f.def.derivativeOf === undefined) return f.def.expr;
  visiting.add(id);
  const source = functionExpression(page, f.def.derivativeOf, visiting);
  visiting.delete(id);
  if (!source) return undefined;
  const cached = derivativeCache.get(f.def);
  if (cached?.source === source) return cached.expr;
  const expr = derive(source); derivativeCache.set(f.def, { source, expr }); return expr;
}

function callFunc(get: Get, page: Page, id: Id, arg: Q, stack = new Set<Id>()): Q | undefined {
  const f = byId(page, id);
  if (f?.def.k === 'picfunc') return picValue(get, page, f.def, arg.v);
  if (!f || f.def.k !== 'func') return undefined;
  const expr = functionExpression(page, id);
  if (!expr || stack.has(id)) return undefined;
  stack.add(id);
  try { return evalExpr(expr, { ref: r => qOf(get, r), x: arg, call: (g2, a2) => callFunc(get, page, g2, a2, stack) }); }
  finally { stack.delete(id); }
}

function evalIntersection(d: Extract<Def, { k: 'inter' }>, get: Get): Result {
  const a = sh(get, d.a), b = sh(get, d.b);
  const asStraight = (s?: Shape): Straight | undefined => isLine(s) ? s.s : undefined;
  const asCirc = (s?: Shape): Circ | undefined => (isCirc(s) ? s.c : s?.k === 'arc' ? { c: s.c, r: s.r } : undefined);
  const sa = asStraight(a), sb = asStraight(b), ca = asCirc(a), cb = asCirc(b);
  const onArc = (s: Shape | undefined, p: Pt) => {
    if (s?.k !== 'arc') return true;
    const angle = G.angleOf(s.c, p);
    const offset = s.sweep < 0 ? G.sweep(angle, s.a0) : G.sweep(s.a0, angle);
    return offset <= Math.abs(s.sweep) + 1e-9 || offset >= G.TAU - 1e-9;
  };
  let pts: Pt[] = [];
  const polygon = a?.k === 'poly' ? a : b?.k === 'poly' ? b : undefined, boundaryLine = a?.k === 'poly' ? sb : sa;
  if (polygon && boundaryLine) {
    for (let i = 0; i < polygon.pts.length; i++) {
      const p = G.intersectStraights(boundaryLine, { a: polygon.pts[i], b: polygon.pts[(i + 1) % polygon.pts.length], ext: 'segment' });
      if (p && (G.projectParam(boundaryLine, p) ?? -1) > 1e-14 && !pts.some(q => G.dist(q, p) < G.EPS)) pts.push(p);
    }
    pts.sort((p, q) => (G.projectParam(boundaryLine, p) ?? 0) - (G.projectParam(boundaryLine, q) ?? 0));
    return pts[d.branch] ? OK({ k: 'pt', p: pts[d.branch] }) : UNDEF;
  }
  // 方法 98 也出现在圆与轨迹的交点中，例如从圆锥曲线上截取两点。
  const pl = a?.k === 'paths' ? a : b?.k === 'paths' ? b : undefined;
  const st = pl === a ? sb : sa, circle = pl === a ? cb : ca, other = pl === a ? b : a;
  if (pl && (st || circle)) {
    for (const path of pl.paths) for (let i = 0; i + 1 < path.length; i++) {
      const segment: Straight = { a: path[i], b: path[i + 1], ext: 'segment' };
      const q = st && G.intersectStraights(segment, st);
      const hits = circle ? G.intersectStraightCircle(segment, circle) : q ? [q] : [];
      for (const hit of hits) {
        if (!onArc(other, hit) || pts.some(p => G.dist(p, hit) < G.EPS)) continue;
        if (pts.length === d.branch) return OK({ k: 'pt', p: hit });
        pts.push(hit);
      }
    }
    return UNDEF;
  }
  // 分支号指的是整条直线/整个圆的第几个交点（射线、线段、弧的范围放在选定之后再检查），
  // 所以射线从圆心出发时，朝前的那个交点是 1 号而不是 0 号。
  let ok = (_p: Pt) => true;
  if (sa && sb) { const p = G.intersectStraights(sa, sb); pts = p ? [p] : []; }
  else if (sa && cb) { const raw = G.intersectLineCircleRaw(sa, cb); pts = raw.map(x => x.p); ok = p => G.paramOk(sa.ext, raw[pts.indexOf(p)].t); }
  else if (sb && ca) { const raw = G.intersectLineCircleRaw(sb, ca); pts = raw.map(x => x.p); ok = p => G.paramOk(sb.ext, raw[pts.indexOf(p)].t); }
  else if (ca && cb) pts = G.intersectCircles(ca, cb);
  const valid = (p: Pt | undefined): p is Pt => !!p && ok(p) && onArc(a, p) && onArc(b, p);
  const preferred = pts[d.branch];
  if (valid(preferred)) return OK({ k: 'pt', p: preferred });
  const alternate = d.alternate ? pts[1 - d.branch] : undefined;
  return valid(alternate) ? OK({ k: 'pt', p: alternate }) : UNDEF;
}

function evalLocus(d: Extract<Def, { k: 'locus' }>, o: Obj, page: Page, get: Get, results: Results, ctx: EvalCtx): Result {
  const drv = byId(page, d.driver);
  if (!drv || !byId(page, d.out)) return MISSING;
  const pathId = d.path ?? (drv.def.k === 'onpath' ? drv.def.path : undefined);
  if (pathId === undefined) return UNDEF;
  const pathResult = get(pathId), path = pathResult.shape;
  if (!path) return pathResult.status === 'missing' || pathResult.status === 'unsupported' ? MISSING : UNDEF;
  // 被驱动点依赖的对象链（按创建顺序）
  const driven = descendants(page, [d.driver]), needed = dependsChain(page, d.out);
  const chain = page.objects.filter(x => x.id === d.driver || (driven.has(x.id) && x.id !== o.id && needed.has(x.id)));
  const total = Math.max(40, Math.min(5000, Number.isFinite(d.samples) ? Math.round(d.samples) : 500));
  const circleLike = path.k === 'circle' || path.k === 'disk';
  const lo = path.k === 'line' && path.s.ext === 'line' ? -3 : 0;
  const hi = path.k === 'line' && path.s.ext !== 'segment' ? 3 : 1;
  const paths: Pt[][] = [[]], colors: (string | undefined)[][] = [[]];
  const items: Shape[] = [], itemColors: (string | undefined)[] = [];
  // 常见的线段—中点链可预先绑定依赖，采样时不必反复分配结果映射。
  // 只接受严格按依赖顺序排列、输入均为有效点的链；其他构造继续走通用求值。
  type FastValue = Pt | [Pt, Pt];
  const slots = new Map<Id, number>([[d.driver, 0]]), initial: FastValue[] = [{ x: 0, y: 0 }];
  const kinds: ('point' | 'segment')[] = ['point'];
  const steps: ({ kind: 'seg'; a: number; b: number } | { kind: 'mid'; seg: number })[] = [];
  const pointSlot = (id: Id): number | undefined => {
    const known = slots.get(id); if (known !== undefined) return kinds[known] === 'point' ? known : undefined;
    const r = get(id); if (r.status !== 'ok' || r.shape?.k !== 'pt' || !G.finite(r.shape.p) || driven.has(id)) return undefined;
    const slot = initial.length; initial.push(r.shape.p); kinds.push('point'); slots.set(id, slot); return slot;
  };
  let fast = true;
  for (const x of chain) {
    if (x.id === d.driver) continue;
    if (x.def.k === 'seg') {
      const a = pointSlot(x.def.a), b = pointSlot(x.def.b);
      if (a === undefined || b === undefined) { fast = false; break; }
      slots.set(x.id, initial.length); initial.push([{ x: 0, y: 0 }, { x: 0, y: 0 }]); kinds.push('segment'); steps.push({ kind: 'seg', a, b });
    } else if (x.def.k === 'mid') {
      const seg = slots.get(x.def.seg);
      if (seg === undefined || kinds[seg] !== 'segment') { fast = false; break; }
      slots.set(x.id, initial.length); initial.push({ x: 0, y: 0 }); kinds.push('point'); steps.push({ kind: 'mid', seg });
    } else { fast = false; break; }
  }
  const outSlot = slots.get(d.out);
  if (fast && outSlot !== undefined && !Array.isArray(initial[outSlot])) {
    const values = initial.slice();
    for (let i = 0; i <= total; i++) {
      const u = i / total, t = circleLike ? u * G.TAU : lo + (hi - lo) * u;
      const p = pathPointAt(path, t); if (!p) continue;
      if (!G.finite(p)) { fast = false; break; }
      values[0] = p;
      let pos = 1;
      // 常量槽与步骤槽交错排列，直接按预绑定索引写回。
      for (const x of chain) {
        if (x.id === d.driver) continue;
        const step = steps[pos++ - 1], target = slots.get(x.id)!;
        if (step.kind === 'seg') {
          const a = values[step.a] as Pt, b = values[step.b] as Pt;
          if (!G.finite(a) || !G.finite(b)) { fast = false; break; }
          values[target] = [a, b];
        }
        else { const s = values[step.seg] as [Pt, Pt]; values[target] = G.mid(s[0], s[1]); }
      }
      if (!fast) break;
      paths[0].push(values[outSlot] as Pt);
    }
    if (fast) return paths[0].length > 1 ? OK({ k: 'paths', paths }) : UNDEF;
    paths[0] = [];
  }
  for (let i = 0; i <= total; i++) {
    const u = i / total;
    const t = circleLike ? u * G.TAU : lo + (hi - lo) * u;
    const local: Results = new Map(results);
    for (const x of chain) local.delete(x.id);
    const override = pathPointAt(path, t);
    if (!override) continue;
    local.set(d.driver, OK({ k: 'pt', p: override }));
    const visiting = new Set<Id>();
    const lget: Get = id => {
      const have = local.get(id);
      if (have) return have;
      const obj = byId(page, id); if (!obj) return MISSING;
      if (visiting.has(id)) return UNDEF;
      visiting.add(id);
      const r = evalObject(obj, lget, page, ctx, local);
      visiting.delete(id);
      local.set(id, r);
      return r;
    };
    const r = lget(d.out);
    const shape = r.shape;
    if (isPt(shape)) { paths[paths.length - 1].push(shape.p); colors[colors.length - 1].push(r.color); }
    else if (shape && (shape.k === 'line' || shape.k === 'circle' || shape.k === 'arc' || shape.k === 'poly' || shape.k === 'disk' || shape.k === 'sector')) {
      items.push(shape);
      itemColors.push(r.color);
    }
    else if (paths[paths.length - 1].length) { paths.push([]); colors.push([]); }
    if (r.status === 'missing' || r.status === 'unsupported') return MISSING;
  }
  if (items.length) return OK({ k: 'multi', items, ...(itemColors.some(Boolean) ? { colors: itemColors } : {}) });
  return paths.some(p => p.length > 1) ? OK({ k: 'paths', paths, ...(colors.some(p => p.some(Boolean)) ? { colors } : {}) }) : UNDEF;
}
function dependsChain(page: Page, id: Id): Set<Id> {
  const out = new Set<Id>([id]);
  const map = new Map(page.objects.map(o => [o.id, o]));
  const walk = (x: Id) => { for (const p of parentsOf(map.get(x)?.def ?? { k: 'unknown', note: '' })) if (!out.has(p)) { out.add(p); walk(p); } };
  walk(id);
  return out;
}

function evalPlot(d: Extract<Def, { k: 'plot' }>, get: Get, page: Page, ctx: EvalCtx): Result {
  const sysShape = sh(get, d.sys);
  if (sysShape?.k !== 'sys' || get(d.func).status !== 'ok') return UNDEF;
  const view = ctx.view ?? { x0: 0, y0: 0, x1: 1200, y1: 800 };
  const corners = [{ x: view.x0, y: view.y0 }, { x: view.x1, y: view.y0 }, { x: view.x0, y: view.y1 }, { x: view.x1, y: view.y1 }].map(c => toSys(sysShape, c)).filter(Boolean) as { x: number; y: number }[];
  if (!corners.length) return UNDEF;
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  const fd = byId(page, d.func)?.def, form = fd?.k === 'func' ? fd.form : undefined;
  const value = (x: number) => callFunc(get, page, d.func, q(x))?.v;
  if (form === 'x=f(y)') {
    const m = Math.max(200, Math.min(4000, d.samples));
    return OK({ k: 'paths', paths: sampleFunction(value, Math.min(...ys), Math.max(...ys), m, (y, x) => fromSys(sysShape, x, y), [Math.min(...xs), Math.max(...xs)]) });
  }
  if (form === 'r=f(t)' || form === 't=f(r)') {
    // 极坐标：角度按度；r=f(θ) 扫一整圈，θ=f(r) 的 r 扫到视图最远的角
    const far = Math.max(...corners.map(c => Math.hypot(c.x, c.y)));
    const m = Math.max(360, Math.min(4000, d.samples)), paths: G.Pt[][] = []; let cur: G.Pt[] = [];
    for (let i = 0; i <= m; i++) {
      const u = form === 'r=f(t)' ? (i / m) * 360 : (i / m) * far, w = value(u);
      if (w === undefined) { if (cur.length > 1) paths.push(cur); cur = []; continue; }
      const r = form === 'r=f(t)' ? w : u, a = ((form === 'r=f(t)' ? u : w) * Math.PI) / 180;
      cur.push(fromSys(sysShape, r * Math.cos(a), r * Math.sin(a)));
    }
    if (cur.length > 1) paths.push(cur);
    return OK({ k: 'paths', paths });
  }
  const lo = d.lo ?? Math.min(...xs), hi = d.hi ?? Math.max(...xs);
  const n = Math.max(200, Math.min(4000, Math.round(d.samples * Math.max(1, (view.x1 - view.x0) / 600))));
  const paths = sampleFunction(x => callFunc(get, page, d.func, q(x))?.v, lo, hi, n, (x, y) => fromSys(sysShape, x, y), [Math.min(...ys), Math.max(...ys)]);
  return OK({ k: 'paths', paths });
}

function evalPcurve(d: Extract<Def, { k: 'pcurve' }>, get: Get, page: Page): Result {
  const sys = sh(get, d.sys);
  if (sys?.k !== 'sys' || get(d.fx).status !== 'ok' || get(d.fy).status !== 'ok') return UNDEF;
  const n = Math.max(2, Math.min(5000, d.samples)), paths: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = d.lo + ((d.hi - d.lo) * i) / n, a = callFunc(get, page, d.fx, q(t)), b = callFunc(get, page, d.fy, q(t));
    if (!a || !b || !Number.isFinite(a.v) || !Number.isFinite(b.v)) { if (cur.length > 1) paths.push(cur); cur = []; continue; }
    if (d.polar) { const ang = b.u === 'angle' ? (b.v * Math.PI) / 180 : b.v; cur.push(fromSys(sys, a.v * Math.cos(ang), a.v * Math.sin(ang))); }
    else cur.push(fromSys(sys, a.v, b.v));
  }
  if (cur.length > 1) paths.push(cur);
  return paths.length ? OK({ k: 'paths', paths }) : UNDEF;
}

function evalMeasure(d: Extract<Def, { k: 'measure' }>, get: Get): Result {
  const num = (v: number | undefined, u: Q['u'] = 'none'): Result => (v === undefined || !Number.isFinite(v) ? UNDEF : OK({ k: 'num', q: q(v, u) }));
  const [r0, r1, r2] = d.refs;
  const cm = (px: number) => px / CM;
  switch (d.m) {
    case 'length': { const s = straightOf(get, r0); return num(s && cm(G.dist(s.a, s.b)), 'distance'); }
    case 'distance': {
      const a = pointOf(get, r0); if (!a) return UNDEF;
      const b = pointOf(get, r1);
      if (b) return num(cm(G.dist(a, b)), 'distance');
      const l = straightOf(get, r1); return num(l && cm(G.dist(a, G.pointAt(l, G.projectParam({ ...l, ext: 'line' }, a) ?? 0))), 'distance');
    }
    case 'perimeter': { const s = sh(get, r0); return s?.k === 'poly' ? num(cm(G.polygonPerimeter(s.pts)), 'distance') : s?.k === 'disk' ? num(cm(G.TAU * s.r), 'distance') : s?.k === 'sector' ? num(cm(s.r * (2 + s.sweep)), 'distance') : UNDEF; }
    case 'circumference': { const c = circleOf(get, r0); return num(c && cm(G.TAU * c.r), 'distance'); }
    case 'angle': { const a = pointOf(get, r0), v = pointOf(get, r1), b = pointOf(get, r2); return num(a && v && b ? angleMeasure(a, v, b) : undefined, 'angle'); }
    case 'area': {
      const s = sh(get, r0);
      if (s?.k === 'poly') return num(G.polygonArea(s.pts) / (CM * CM), 'none');
      if (s?.k === 'disk') return num((Math.PI * s.r * s.r) / (CM * CM));
      if (s?.k === 'circle') return num((Math.PI * s.c.r * s.c.r) / (CM * CM));
      if (s?.k === 'sector') return num((s.r * s.r * (s.segment ? s.sweep - Math.sin(s.sweep) : s.sweep)) / 2 / (CM * CM));
      return UNDEF;
    }
    case 'arcangle': case 'arclength': {
      let sweepA: number | undefined, r: number | undefined;
      if (d.refs.length === 3) { const c = circleOf(get, r0), a = pointOf(get, r1), b = pointOf(get, r2); if (c && a && b) { sweepA = G.sweep(G.angleOf(c.c, a), G.angleOf(c.c, b)); r = c.r; } }
      else { const s = sh(get, r0); if (s?.k === 'arc') { sweepA = s.sweep; r = s.r; } }
      if (sweepA === undefined || r === undefined) return UNDEF;
      return d.m === 'arcangle' ? num((sweepA * 180) / Math.PI, 'angle') : num(cm(r * sweepA), 'distance');
    }
    case 'radius': { const c = circleOf(get, r0); return num(c && cm(c.r), 'distance'); }
    case 'ratio': {
      if (d.refs.length === 3) { const pa = pointOf(get, r0), pb = pointOf(get, r1), pc = pointOf(get, r2); const lab = pa && pb && G.dist(pa, pb); return num(pa && pc && lab && lab > G.EPS ? G.dist(pa, pc) / lab : undefined); }   // 三点：|AC| / |AB|
      const a = straightOf(get, r0), b = straightOf(get, r1); const lb = b && G.dist(b.a, b.b); return num(a && lb ? G.dist(a.a, a.b) / lb : undefined); }
    case 'pointvalue': {
      const p = pointOf(get, r0); const path = sh(get, r1); if (!p || !path) return UNDEF;
      const pr = projectToPath(path, p); if (!pr) return UNDEF;
      return num(path.k === 'circle' ? ((((pr.t % G.TAU) + G.TAU) % G.TAU) / G.TAU) : pr.t);
    }
    case 'abscissa': case 'ordinate': {
      const p = pointOf(get, r0), s = sh(get, r1); if (!p || s?.k !== 'sys') return UNDEF;
      const c = toSys(s, p); return num(c && (d.m === 'abscissa' ? c.x : c.y));
    }
    case 'coords': { const p = pointOf(get, r0), s = sh(get, r1); if (!p || s?.k !== 'sys') return UNDEF; const c = toSys(s, p); return c ? OK({ k: 'coords', x: c.x, y: c.y }) : UNDEF; }
    case 'coordradius': case 'coordangle': {
      const p = pointOf(get, r0), s = sh(get, r1), c = p && s?.k === 'sys' ? toSys(s, p) : undefined;
      if (!c) return UNDEF;
      return d.m === 'coordradius' ? num(Math.hypot(c.x, c.y)) : Math.hypot(c.x, c.y) < G.EPS ? UNDEF : num((Math.atan2(c.y, c.x) * 180 / Math.PI + 360) % 360, 'angle');
    }
    case 'coorddist': {
      const a = pointOf(get, r0), b = pointOf(get, r1), s = sh(get, r2); if (!a || !b || s?.k !== 'sys') return UNDEF;
      const ca = toSys(s, a), cb = toSys(s, b); return num(ca && cb && Math.hypot(ca.x - cb.x, ca.y - cb.y));
    }
    case 'slope': {
      const l = straightOf(get, r0), s = sh(get, r1); if (!l || s?.k !== 'sys') return UNDEF;
      const ca = toSys(s, l.a), cb = toSys(s, l.b); if (!ca || !cb || Math.abs(cb.x - ca.x) < 1e-12) return UNDEF;
      return num((cb.y - ca.y) / (cb.x - ca.x));
    }
    case 'equation': {
      const sp = sh(get, r0), s = sh(get, r1); if (s?.k !== 'sys') return UNDEF;
      if (isLine(sp)) {
        const ca = toSys(s, sp.s.a), cb = toSys(s, sp.s.b); if (!ca || !cb) return UNDEF;
        const dx = cb.x - ca.x, dy = cb.y - ca.y;
        if (Math.abs(dx) < 1e-12) return OK({ k: 'text', text: `x = ${fmt(ca.x)}`, eq: { kind: 'line', vertical: true, m: 0, b: 0, x: ca.x } });
        const m = dy / dx, b0 = ca.y - m * ca.x;
        return OK({ k: 'text', text: `y = ${fmt(m)}x ${b0 < 0 ? '-' : '+'} ${fmt(Math.abs(b0))}`, eq: { kind: 'line', vertical: false, m, b: b0, x: 0 } });
      }
      if (isCirc(sp)) {
        const c = toSys(s, sp.c.c); if (!c) return UNDEF;
        const r = sp.c.r / Math.hypot(s.ux.x, s.ux.y);
        return OK({ k: 'text', text: `(x ${c.x < 0 ? '+' : '-'} ${fmt(Math.abs(c.x))})² + (y ${c.y < 0 ? '+' : '-'} ${fmt(Math.abs(c.y))})² = ${fmt(r * r)}`, eq: { kind: 'circle', cx: c.x, cy: c.y, r } });
      }
      return UNDEF;
    }
  }
}
const fmt = (v: number) => v.toFixed(2);

export { usesX };
