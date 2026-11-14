/** 几何与数学求值：按对象创建顺序（即依赖顺序）逐个计算，支持脏节点增量重算。 */
import * as G from './geom';
import type { Pt, Straight, Circ } from './geom';
import { byId, type Def, type DisplayPrefs, type Id, type Num, type Obj, type Page, parentsOf, descendants } from './model';
import { CM, derive, evalExpr, isRadianMode, q, setRadianMode, usesX, type EvalEnv, type Expr, type Q } from './expr';
import { parameterColor } from './color';
import { imageBox, imageCorners } from './image';
import { warpBounds, warpCells, warpGrid, warpVertex, type WarpMesh } from './warp';
import { imageHeightAt, imageHeightPaths, readHeightMask, type HeightMask } from './image-height';
import { compileFuncValue, compileIterBody, iterFast, prepareFast, programValid, runFast, runFastPointInto, runFastStep, type FastProgram } from './iterfast';

export type Shape =
  | { k: 'pt'; p: Pt }
  | { k: 'line'; s: Straight; axisOrigin?: Pt; axisUnit?: Pt }
  | { k: 'circle'; c: Circ }
  | { k: 'arc'; c: Pt; r: number; a0: number; sweep: number; from: Pt; to: Pt; reverse?: true }
  | { k: 'poly'; pts: Pt[] }
  | { k: 'disk'; c: Pt; r: number }
  | { k: 'sector'; c: Pt; r: number; a0: number; sweep: number; segment: boolean }
  | { k: 'num'; q: Q }
  | { k: 'coords'; x: number; y: number }
  | { k: 'text'; text: string; eq?: { kind: 'line'; vertical: boolean; m: number; b: number; x: number } | { kind: 'circle'; cx: number; cy: number; r: number } }
  | { k: 'paths'; paths: Pt[][]; colors?: (string | undefined)[][]; parameters?: number[][] }
  | { k: 'sys'; origin: Pt; ux: Pt; uy: Pt }
  | { k: 'func'; heightPaths?: Pt[][] }
  | { k: 'table'; cols: { name: string; unit: string }[]; rows: number[][]; intFirst?: boolean }
  | { k: 'box'; at: Pt; w: number; h: number; image?: { data: string; mime: string; corners: Pt[]; clips?: Pt[][]; mesh?: WarpMesh }; textValues?: (Extract<Shape, { k: 'num' | 'coords' }> | undefined)[] }
  | { k: 'multi'; items: Shape[]; colors?: (string | undefined)[] } // 迭代象、非点对象轨迹
  | { k: 'iter'; states: Result[][]; chain?: Result[][]; zeroDepth?: true };                    // 迭代对象本身：要显示的各层状态（每个状态是各前像的取值）
export type Status = 'ok' | 'undefined' | 'missing' | 'unsupported';
export interface Result { shape?: Shape; status: Status; color?: string }
export type Results = Map<Id, Result>;
export interface EvalCtx {
  /** 当前页面显示区域（页面坐标），函数图像据此取样。 */
  view?: { x0: number; y0: number; x1: number; y1: number };
  /** 普通度数取无向夹角，有向度和弧度取带方向的夹角。 */
  angleUnit?: DisplayPrefs['angleUnit'];
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

/** 这些对象求值时要读整张结果表（复制后再替换），不能用轨迹共享表。 */
const TABLE_KINDS = new Set<Def['k']>(['iterate', 'iterimg', 'itertable', 'locus', 'custom-point']);
interface LocusShare { table: (Result[] | undefined)[]; fixed: (Result | undefined)[]; driven: boolean[] }
let locusShare: Map<string, LocusShare> | undefined;
/** 本次页面求值的顶层取值函数。迭代状态或外层轨迹样本下求值的轨迹，输入随状态变化，不能共用表。 */
let topGet: Get | undefined;
let reversedAxisPaths = new Set<Id>();

export function evaluatePage(page: Page, changed?: Iterable<Id>, prev?: Results, ctx: EvalCtx = {}): Results {
  return evaluateScoped(page, changed, prev, ctx);
}

/** 仅计算指定对象及其递归依赖；用于读取时恢复附着文字的相对位置。 */
export function evaluateTargets(page: Page, targets: Iterable<Id>, ctx: EvalCtx = {}): Results {
  return evaluateScoped(page, undefined, undefined, ctx, targets);
}

function evaluateScoped(page: Page, changed: Iterable<Id> | undefined, prev: Results | undefined, ctx: EvalCtx, targets?: Iterable<Id>): Results {
  const outerShare = locusShare, outerGet = topGet, outerIter = iterCache, outerAxes = reversedAxisPaths;
  locusShare = new Map();
  iterCache = { getters: new WeakMap(), plans: new WeakMap(), calculations: new WeakMap(), noFast: new WeakSet() };
  reversedAxisPaths = new Set();
  for (const { id, def } of page.objects) {
    if (def.k === 'sys') reversedAxisPaths.add(def.axisY);
    else if (def.k === 'axis-line' && def.axis === 'y') reversedAxisPaths.add(id);
  }
  // 派生线在原版继承参照线的路径方向。对象通常已按依赖排序。
  for (const { id, def } of page.objects) {
    if ((def.k === 'parallel' || def.k === 'perp') && reversedAxisPaths.has(def.line)) reversedAxisPaths.add(id);
  }
  const outerRad = setRadianMode(ctx.angleUnit === 'rad');
  try { return evaluatePageInner(page, changed, prev, ctx, targets); }
  finally { locusShare = outerShare; topGet = outerGet; iterCache = outerIter; reversedAxisPaths = outerAxes; setRadianMode(outerRad); }
}
function evaluatePageInner(page: Page, changed: Iterable<Id> | undefined, prev: Results | undefined, ctx: EvalCtx, targets?: Iterable<Id>): Results {
  const map = new Map(page.objects.map(o => [o.id, o]));
  // changed 可能是一次性迭代器（如 Map.keys()），先展开，否则算后代时已经读空。
  const changedIds = changed && [...changed];
  const dirty = changedIds && prev ? new Set<Id>([...changedIds, ...descendants(page, changedIds)]) : undefined;
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
  topGet = get;
  if (targets !== undefined) { for (const id of targets) get(id); return results; }
  // 隐藏且没有子对象的轨迹不必取样：它不显示，也没有别的对象用它（显示时会重新求值）。
  // 椭圆滚动全解.gsp 第 1 页的隐藏轨迹每个样本都要做 49 层迭代，取样一次要好几秒。
  let parentIds: Set<Id> | undefined;
  for (const o of page.objects) {
    if (o.hidden && o.def.k === 'locus' && (!dirty || dirty.has(o.id) || !results.has(o.id))) {
      parentIds ??= new Set(page.objects.flatMap(x => parentsMemo(x.def)));
      if (!parentIds.has(o.id)) { results.set(o.id, { status: 'ok' }); dirty?.delete(o.id); continue; }
    }
    get(o.id);
  }
  return results;
}

/** 计算对象 id 的求值依赖函数（驱动点被替换后用于轨迹取样）。 */
type Get = (id: Id) => Result;

function sh(get: Get, id: Id): Shape | undefined { return get(id).shape; }
function pointOf(get: Get, id: Id): Pt | undefined { const s = sh(get, id); return isPt(s) ? s.p : undefined; }
/** 三点标记比和比值度量都取 AC 在 AB 方向上的有向比。 */
function signedRatio(a?: Pt, b?: Pt, c?: Pt): number | undefined {
  if (!a || !b || !c) return undefined;
  const ab = G.sub(b, a), lengthSquared = G.dot(ab, ab);
  return lengthSquared > G.EPS * G.EPS ? G.dot(G.sub(c, a), ab) / lengthSquared : undefined;
}
function straightOf(get: Get, id: Id): Straight | undefined { const s = sh(get, id); return isLine(s) ? s.s : undefined; }
function circleOf(get: Get, id: Id): Circ | undefined {
  const s = sh(get, id);
  if (isCirc(s)) return s.c;
  if (s?.k === 'arc') return { c: s.c, r: s.r };
  return undefined;
}
/** 数值型对象（度量、参数、计算）的值。 */
/** 数值对象的值。非零数除以零的计算结果是 ∞（只用于显示和计算链），几何、计数等其他用途一律当作无定义。 */
export function qOf(get: Get, id: Id): Q | undefined { const s = sh(get, id); return s?.k === 'num' && Number.isFinite(s.q.v) ? s.q : undefined; }
function qOfRaw(get: Get, id: Id): Q | undefined { const s = sh(get, id); return s?.k === 'num' ? s.q : undefined; }
/** 当作普通数用的数值（坐标、比、次数…）：角度按文档单位，弧度制文档里是弧度值（环形跑道.gsp 以角度算出的横坐标在原版按弧度绘制）。 */
function plainOf(get: Get, id: Id): number | undefined { const v = qOf(get, id); return v === undefined ? undefined : v.u === 'angle' && isRadianMode() ? (v.v * Math.PI) / 180 : v.v; }
function numOf(get: Get, n: Num, scale = 1): number | undefined {
  if ('fixed' in n) return n.fixed;
  if ('pts' in n) { const [a, v, b] = n.pts.map(i => pointOf(get, i)); return a && v && b ? angleMeasure(a, v, b) : undefined; }
  const v = qOf(get, n.m)?.v; return v === undefined ? undefined : v * scale;
}

export function arcShape(c: Pt, r: number, a0: number, sweep: number, reverse = false): Shape {
  return { k: 'arc', c, r, a0, sweep, from: { x: c.x + r * Math.cos(a0), y: c.y - r * Math.sin(a0) }, to: { x: c.x + r * Math.cos(a0 + sweep), y: c.y - r * Math.sin(a0 + sweep) }, ...(reverse ? { reverse: true } : {}) };
}

/** 角度度量：从边 b→a 逆时针转到 b→c，取 0..360 度。 */
export function angleMeasure(a: Pt, v: Pt, b: Pt): number | undefined {
  if (G.dist(a, v) < G.EPS || G.dist(b, v) < G.EPS) return undefined;
  return (G.sweep(G.angleOf(v, a), G.angleOf(v, b)) * 180) / Math.PI;
}

function markedSweep(d: Extract<Def, { k: 'angle-mark' }>, get: Get): number | undefined {
  const a = pointOf(get, d.a), v = pointOf(get, d.v), b = pointOf(get, d.b);
  const ccw = a && v && b ? angleMeasure(a, v, b) : undefined;
  if (ccw === undefined) return undefined;
  const cw = ccw === 0 ? 0 : ccw - 360;
  switch (d.mode) {
    case 'ccw': return ccw;
    case 'cw': return cw;
    case 'reflex': return ccw <= 180 ? ccw - 360 : ccw;
    default: return ccw <= 180 ? ccw : cw;
  }
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
export function pathPointAt(path: Shape | undefined, t: number, continuous = false): Pt | undefined {
  if (!path) return undefined;
  switch (path.k) {
    case 'line': return G.pointAt(path.s, G.clampParam(path.s.ext, t));
    case 'circle': return { x: path.c.c.x + path.c.r * Math.cos(t), y: path.c.c.y - path.c.r * Math.sin(t) };
    case 'arc': { const u = Math.min(1, Math.max(0, t)); const a = path.a0 + path.sweep * (path.reverse ? 1 - u : u); return { x: path.c.x + path.r * Math.cos(a), y: path.c.y - path.r * Math.sin(a) }; }
    case 'poly': return polyPerimeterPoint(path.pts, t);
    case 'disk': return { x: path.c.x + path.r * Math.cos(t), y: path.c.y - path.r * Math.sin(t) };
    case 'sector': { const u = Math.min(1, Math.max(0, t)); const a = path.a0 + path.sweep * u; return { x: path.c.x + path.r * Math.cos(a), y: path.c.y - path.r * Math.sin(a) }; }
    case 'paths': {
      const count = path.paths.reduce((n, part) => n + part.length, 0);
      const index = t * (count - 1);
      let i = Math.min(count - 1, Math.max(0, continuous ? index : Math.round(index)));
      if (i < 0) return undefined;
      for (const part of path.paths) {
        if (i < part.length) {
          const j = Math.floor(i), a = part[j], b = part[j + 1];
          return i === j ? a : b ? G.pointAt({ a, b, ext: 'segment' }, i - j) : undefined;
        }
        i -= part.length;
      }
      return undefined;
    }
  }
  return undefined;
}

export function polyPerimeterPoint(pts: Pt[], t: number): Pt | undefined {
  const { edge, t: u } = polygonEdgeAt(pts, t);
  return polygonEdgePoint(pts, edge, u);
}

export function polygonEdgeAt(pts: Pt[], t: number): { edge: number; t: number } {
  const total = G.polygonPerimeter(pts);
  if (total < G.EPS) return { edge: 0, t: 0 };
  let want = (((t % 1) + 1) % 1) * total;
  for (let edge = 0; edge < pts.length; edge++) {
    const length = G.dist(pts[edge], pts[(edge + 1) % pts.length]);
    if (want <= length) return { edge, t: length < G.EPS ? 0 : want / length };
    want -= length;
  }
  return { edge: 0, t: 0 };
}

function polygonEdgePoint(pts: Pt[], edge: number, t: number): Pt | undefined {
  if (pts.length < 2) return undefined;
  const a = pts[edge], b = pts[(edge + 1) % pts.length];
  return a && b ? G.add(a, G.mul(G.sub(b, a), t)) : undefined;
}

/** 运动的临时参数仍按周长比例计算，以便按页面距离控制速度。 */
export function motionPathParameter(d: Extract<Def, { k: 'onpath' }>, shape: Shape | undefined): number {
  if (d.edge === undefined || shape?.k !== 'poly' || !shape.pts[d.edge]) return d.t;
  const pts = shape.pts;
  const total = G.polygonPerimeter(pts);
  if (total < G.EPS) return 0;
  let length = 0;
  for (let i = 0; i < d.edge; i++) length += G.dist(pts[i], pts[i + 1]);
  return (length + d.t * G.dist(pts[d.edge], pts[(d.edge + 1) % pts.length])) / total;
}

/** 把点投影到路径，返回参数与最近点；用于约束拖动与"在路径上放点"。 */
/** 路径是不是某个坐标系的坐标轴。 */
export function isAxisLine(page: Page, id: Id): boolean { return page.objects.some(o => o.def.k === 'sys' && (o.def.axisX === id || o.def.axisY === id)); }
export function pathUsesPixelDistance(page: Page, id: Id): boolean {
  const def = byId(page, id)?.def, kind = def?.k;
  // 以坐标轴为参照线的垂线/平行线同样按像素计（原版单位 200 像素）。
  if (def && (def.k === 'parallel' || def.k === 'perp') && (byId(page, def.line)?.def.k === 'axis-line' || isAxisLine(page, def.line))) return true;
  return kind === 'bisect' || kind === 'axis-line' || isAxisLine(page, id);
}

/** 新建点使用路径的默认单位，已有点按文档里存的单位投影。 */
export function projectOnPath(page: Page, results: Results, pathId: Id, p: Pt, absolute = pathUsesPixelDistance(page, pathId)): { t: number; p: Pt; abs?: true; side?: { edge: number; t: number } } | undefined {
  const shape = results.get(pathId)?.shape, def = byId(page, pathId)?.def;
  if (shape?.k === 'paths' && (def?.k === 'pcurve' || (def?.k === 'locus' && def.colored))) {
    const pr = projectToSampledSegments(shape, p);
    if (!pr || def.k !== 'pcurve') return pr;
    const point = evalPcurvePoint(def, id => results.get(id) ?? MISSING, page, pr.t);
    return point && { t: pr.t, p: point };
  }
  const pr = projectToPath(shape, p);
  if (!pr) return undefined;
  if (shape?.k === 'line' && absolute) return { ...pr, t: pr.t * G.dist(shape.s.a, shape.s.b), abs: true };
  return pr;
}

function projectToSampledSegments(path: Extract<Shape, { k: 'paths' }>, p: Pt): { t: number; p: Pt } | undefined {
  const count = path.paths.reduce((n, part) => n + part.length, 0);
  let best: { t: number; p: Pt } | undefined, distance = Infinity, offset = 0;
  for (const [i, part] of path.paths.entries()) {
    const params = path.parameters?.[i];
    for (let j = 0; j < part.length; j++) {
      const a = part[j], b = part[j + 1] ?? a;
      const seg = { a, b, ext: 'segment' as const };
      const u = G.clampParam('segment', G.projectParam(seg, p) ?? 0);
      const point = G.pointAt(seg, u), d = G.dist(point, p);
      if (d >= distance) continue;
      distance = d;
      const t = params ? params[j] + ((params[j + 1] ?? params[j]) - params[j]) * u : (offset + j + u) / Math.max(1, count - 1);
      best = { t, p: point };
    }
    offset += part.length;
  }
  return best;
}

export function projectToPath(path: Shape | undefined, p: Pt): { t: number; p: Pt; side?: { edge: number; t: number } } | undefined {
  if (!path) return undefined;
  switch (path.k) {
    case 'line': { const t = G.projectParam(path.s, p); if (t === undefined) return undefined; const tc = G.clampParam(path.s.ext, t); return { t: tc, p: G.pointAt(path.s, tc) }; }
    case 'circle': case 'disk': {
      const c = path.k === 'circle' ? path.c.c : path.c, r = path.k === 'circle' ? path.c.r : path.r;
      const t = G.angleOf(c, p);
      return { t, p: { x: c.x + r * Math.cos(t), y: c.y - r * Math.sin(t) } };
    }
    case 'arc': case 'sector': {
      const c = path.c, r = path.r, ang = G.angleOf(c, p);
      const off = path.sweep < 0 ? G.sweep(ang, path.a0) : G.sweep(path.a0, ang), length = Math.abs(path.sweep);
      const u = length < G.EPS ? 0 : off <= length ? off / length : off - length < G.TAU - off ? 1 : 0;
      const a = path.a0 + path.sweep * u;
      return { t: path.k === 'arc' && path.reverse ? 1 - u : u, p: { x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) } };
    }
    case 'poly': {
      const pts = path.pts, total = G.polygonPerimeter(pts);
      let best: { t: number; p: Pt; d: number; side: { edge: number; t: number } } | undefined, acc = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], seg = { a, b, ext: 'segment' as const }, tt = G.projectParam(seg, p);
        const l = G.dist(a, b);
        if (tt !== undefined) {
          const u = G.clampParam('segment', tt), pp = G.pointAt(seg, u), d = G.dist(pp, p);
          if (!best || d < best.d) best = { t: total < G.EPS ? 0 : (acc + l * u) / total, p: pp, d, side: { edge: i, t: u } };
        }
        acc += l;
      }
      return best && { t: best.t, p: best.p, side: best.side };
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

function transformOf(d: Def, get: Get, page: Page): TMap | undefined {
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
      else if (d.angle.mode === 'mark') {
        const mark = byId(page, d.angle.m)?.def;
        if (mark?.k === 'angle-mark') deg = markedSweep(mark, get);
      }
      else { const a = pointOf(get, d.angle.a), v = pointOf(get, d.angle.v), b = pointOf(get, d.angle.b); deg = a && v && b ? angleMeasure(a, v, b) : undefined; }
      if (deg === undefined) return undefined;
      const rad = (deg * Math.PI) / 180;
      return { f: p => G.rotatePt(p, c, rad), scale: 1, flip: false };
    }
    case 'dilate': {
      const c = pointOf(get, d.center); if (!c) return undefined;
      let k: number | undefined;
      if (d.ratio.mode === 'fixed') k = d.ratio.den === 0 ? undefined : d.ratio.num / d.ratio.den;
      else if (d.ratio.mode === 'value') k = plainOf(get, d.ratio.m);
      else if (d.ratio.c !== undefined) k = signedRatio(pointOf(get, d.ratio.a), pointOf(get, d.ratio.b), pointOf(get, d.ratio.c));
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
      const corners = all(s.image.corners), clips = s.image.clips?.map(all);
      if (!corners || clips?.some(clip => !clip)) return undefined;
      const src = s.image.mesh;
      if (src) {
        // 取样变换的结果再做普通变换：逐个格点映射，格点无定义时对应格子不画。
        const pts = new Float64Array(src.pts.length);
        for (let k = 0; k < pts.length; k += 2) { const q = Number.isFinite(src.pts[k]) ? t.f({ x: src.pts[k], y: src.pts[k + 1] }) : undefined; pts[k] = q && G.finite(q) ? q.x : NaN; pts[k + 1] = q && G.finite(q) ? q.y : NaN; }
        const mesh: WarpMesh = { nx: src.nx, ny: src.ny, pts, cells: src.cells.slice() };
        warpCells(mesh, 1, (i, j) => src.cells[j * src.nx + i] === 1);
        const b = warpBounds(mesh);
        if (!b) return undefined;
        const box = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
        return { k: 'box', ...imageBox(box), image: { ...s.image, corners: box, clips: undefined, mesh } };
      }
      return { k: 'box', ...imageBox(corners), image: { ...s.image, corners, clips: clips as Pt[][] | undefined } };
    }
    case 'poly': { const r = all(s.pts); return r && { k: 'poly', pts: r }; }
    case 'circle': { const r = all([s.c.c]); return r && { k: 'circle', c: { c: r[0], r: s.c.r * t.scale } }; }
    case 'disk': { const r = all([s.c]); return r && { k: 'disk', c: r[0], r: s.r * t.scale }; }
    case 'arc': {
      const r = all([s.c, s.from]); if (!r) return undefined;
      return arcShape(r[0], s.r * t.scale, G.angleOf(r[0], r[1]), t.flip ? -s.sweep : s.sweep, s.reverse);
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
// 原版样例 example-36.gsp 以参数 n=120 迭代 119 次，原版绘图区画出全部 119 个矩形，所以次数不能只到 20。
// 单映射层数上限与多映射状态总数上限分开配置；当前都取 10 万。层数上限 10 万（1261/1262 要求 95000、100000 层）；状态总数上限 10 万。第十七轮用整库截图对照定的：
// 1203（5 映射 7 层，共 97,656 个状态）原版画全，旧上限 6 万只画出 58% 的墨量（0.59 → 0.998）；1130（4 映射 8 层，87,381 个）也画全；
// 1135（5 映射 10 层）原版必有上限：6 万墨量 17004、10 万 17494、25 万 18802，原版 18100。放宽到 25 万会让 1135 的求值从 1.3 秒涨到 7 秒，所以取 10 万。
// 此前说的“放宽会栈溢出”出在 shown.push(...states) 的参数展开，已改成逐个追加。
export const ITER_MAX_DEPTH = 100000;
export const ITER_MAX_MULTI_STATES = 100000;

/** 原版在超限时显示最后一个完整层，不画下一层的一部分。 */
function iterationDepth(requested: number, branches: number): number {
  const depth = Math.max(0, Math.min(ITER_MAX_DEPTH, Math.floor(requested + 1e-9)));
  if (branches <= 1) return depth;
  let size = 1, total = 0;
  for (let level = 0; level < depth; level++) {
    size *= branches;
    total += size;
    if (total > ITER_MAX_MULTI_STATES) return level;
  }
  return depth;
}
type IterDef = Extract<Def, { k: 'iterate' }>;
interface IterPlan {
  body: Set<Id>;
  pre: Map<Id, number>;
  dense?: { pre: Int32Array; body: Int32Array };
}
interface IterCache {
  getters: WeakMap<Result[], Get>;
  plans: WeakMap<IterDef, IterPlan>;
  calculations: WeakMap<Get, { page: Page; env: EvalEnv }>;
  noFast: WeakSet<IterDef>;
}
let iterCache: IterCache | undefined;

/** 在某个状态（前像的取值）下求任意对象的值：前像用状态里的值，body 里的对象重新算，其余对象沿用原值。 */
function underState(d: IterDef, state: Result[], get: Get, page: Page, ctx: EvalCtx, results: Results): Get {
  const cached = iterCache?.getters.get(state);
  if (cached) return cached;
  let plan = iterCache?.plans.get(d);
  if (!plan) {
    plan = { body: new Set(d.body), pre: new Map(d.pre.map((id, i) => [id, i])) };
    // 普通课件的 ID 很密集；过大、负数或非整数 ID 继续使用 Map，避免为稀疏 ID 分配大数组。
    let maxId = -1, compact = true;
    for (const id of [...d.pre, ...d.body]) {
      if (!Number.isSafeInteger(id) || id < 0) { compact = false; break; }
      maxId = Math.max(maxId, id);
    }
    if (compact && maxId <= Math.max(1024, (d.pre.length + d.body.length) * 16) && maxId <= 100000) {
      const pre = new Int32Array(maxId + 1).fill(-1), body = new Int32Array(maxId + 1).fill(-1);
      d.pre.forEach((id, i) => { pre[id] = i; });
      d.body.forEach((id, i) => { body[id] = i; });
      plan.dense = { pre, body };
    }
    iterCache?.plans.set(d, plan);
  }
  const { body, pre } = plan;
  const dense = plan.dense, memo = dense ? undefined : new Map<Id, Result>(), slots: Result[] = [];
  const g: Get = dense ? id => {
    const i = dense.pre[id];
    if (i >= 0 && state[i]) return state[i];
    const slot = dense.body[id];
    if (!(slot >= 0)) return get(id);
    const m = slots[slot]; if (m) return m;
    const ob = byId(page, id); if (!ob) return MISSING;
    slots[slot] = UNDEF;
    const r = evalObject(ob, g, page, ctx, results);
    slots[slot] = r;
    return r;
  } : id => {
    const i = pre.get(id);
    if (i !== undefined && state[i]) return state[i];
    if (!body.has(id)) return get(id);
    const m = memo!.get(id); if (m) return m;
    const ob = byId(page, id); if (!ob) return MISSING;
    // 暂存无定义以打断循环依赖。
    memo!.set(id, UNDEF);
    const r = evalObject(ob, g, page, ctx, results);
    memo!.set(id, r);
    return r;
  };
  iterCache?.getters.set(state, g);
  return g;
}

/** 随机取点的参数范围：圆取整圈，直线取 [-3,3]、射线/线段取 [0,3]/[0,1]。 */
function randomRange(path: Shape): { circle: boolean; lo: number; hi: number } {
  return { circle: path.k === 'circle' || path.k === 'disk', lo: path.k === 'line' && path.s.ext === 'line' ? -3 : 0, hi: path.k === 'line' && path.s.ext !== 'segment' ? 3 : 1 };
}

/** 求值 iterate：逐层把前像换成映射的初象，记下要显示的各层状态；每个迭代象再在这些状态下求自己的原象。 */
function evalIterate(d: IterDef, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const dv = 'param' in d.depth ? plainOf(get, d.depth.param) : d.depth.fixed;
  if (dv === undefined || !Number.isFinite(dv)) return UNDEF;
  const depth = iterationDepth(dv, d.maps.length);
  const pre = d.pre.map(id => get(id));
  const bad = pre.find(r => r.status !== 'ok' || !r.shape);
  if (bad) return bad.status === 'missing' || bad.status === 'unsupported' ? MISSING : UNDEF;

  // 多映射的点型迭代也可按数组槽位执行映射，避免每个状态都建立通用 Get 闭包和临时 Map。
  // 仅在完整映射程序均可编译、所有外部依赖有效时启用；任一步不适用就从初始状态回退下方通用实现。
  if (d.maps.length > 1 && !d.random && iterFast.enabled && !ctx.posOverride?.size) {
    const program = fastProgramOf(d, page);
    if (program?.multi?.length === d.maps.length) {
      const bases = program.multi.map(p => prepareFast(p, get));
      if (bases.every((b): b is Float64Array => !!b)) {
        // 最常见的几何 IFS：单个点前像、各映射都产生一个点。状态展开只存平坦坐标，
        // 避免每个候选状态都创建 Result[] 和 Result；仅对最终需要展示的层建立对象。
        if (pre.length === 1 && pre[0].shape?.k === 'pt' && program.multi.every(p => p.pre.length === 1 && p.pre[0].kind === 'pt')) {
          let coords = new Float64Array([pre[0].shape.p.x, pre[0].shape.p.y]), total = 0, capped = false, supported = true;
          const shown: Result[][] = [];
          for (let level = 0; level <= depth && coords.length; level++) {
            const shouldShow = level >= 1 && (!d.finalOnly || level === depth || capped);
            if (shouldShow) for (let i = 0; i < coords.length; i += 2)
              shown.push([{ shape: { k: 'pt', p: { x: coords[i], y: coords[i + 1] } }, status: 'ok' } as Result]);
            if (level === depth || capped) break;
            const capacity = Math.min(coords.length / 2 * program.multi.length, ITER_MAX_MULTI_STATES - total);
            const next = new Float64Array(capacity * 2); let written = 0;
            outer: for (let i = 0; i < coords.length; i += 2) for (let m = 0; m < program.multi.length; m++) {
              if (!runFastPointInto(program.multi[m], bases[m], coords[i], coords[i + 1], next, written * 2)) { supported = false; break outer; }
              written++; if (++total >= ITER_MAX_MULTI_STATES) { capped = true; break outer; }
            }
            if (!supported) break;
            coords = written === capacity ? next : next.slice(0, written * 2);
          }
          if (supported) return OK({ k: 'iter', states: shown, ...(depth === 0 ? { zeroDepth: true as const } : {}) });
        }
        let states: Result[][] = [pre], total = 0, capped = false;
        const shown: Result[][] = [];
        let supported = true;
        for (let level = 0; level <= depth && states.length; level++) {
          if (level >= 1 && (!d.finalOnly || level === depth || capped)) for (const st of states) shown.push(st);
          if (level === depth || capped) break;
          const next: Result[][] = [];
          outer: for (const st of states) for (let m = 0; m < program.multi.length; m++) {
            const ns = runFastStep(program.multi[m], bases[m], st);
            if (!ns) { supported = false; break outer; }
            next.push(ns);
            if (++total >= ITER_MAX_MULTI_STATES) { capped = true; break outer; }
          }
          if (!supported) break;
          states = next;
        }
        if (supported) return OK({ k: 'iter', states: shown, ...(depth === 0 ? { zeroDepth: true as const } : {}) });
      }
    }
  }

  let states: Result[][] = [pre], total = 0, capped = false;
  const shown: Result[][] = [], chain: Result[][] = [];
  // 原版迭代对话框的“到随机位置”：前像中的路径点每一层取路径上的随机位置（IFS-五角繁星的三种作法.gsp、谢氏（随机）.gsp 的随机选择，
  // 原版画出五角繁星和谢尔宾斯基三角形）。随机序列用迭代记录里的种子，结果稳定，但与原版的序列不同。
  const randomPaths = d.pre.map((preId, i) => {
    // 前像是路径点时它取随机位置；前像是自由点而初象（映射目标）是路径点时，随机位置落在初象上（仿射-分形蕨.gsp 的随机选择）。
    let ob = byId(page, preId);
    if (d.random && ob?.def.k !== 'onpath') { const target = byId(page, d.maps[0]?.[i]); if (target?.def.k === 'onpath') ob = target; }
    if (!d.random || ob?.def.k !== 'onpath') return undefined;
    const pathId = ob.def.path, path = sh(get, pathId);
    // 路径依赖迭代里的前像或体内对象时（0813 蒲丰投针：针尖所在圆的圆心由本层同时随机选出的两个点决定），每次随机取点前要在本层的状态下重算路径。
    const live = d.pre.includes(pathId) || d.body.includes(pathId);
    return path ? { path, pathId, live, ...randomRange(path) } : undefined;
  });
  let seed = (d.salt ?? 0x2f5f5538) >>> 0;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let level = 0; level <= depth && states.length; level++) {
    if (d.maps.length === 1 && states.length === 1) chain.push(states[0]);
    // 逐个追加：一层的状态可达数万个，参数展开会让调用栈溢出（1135 放宽状态上限时的栈溢出就出在这里）。
    if (level >= 1 && (!d.finalOnly || level === depth || capped)) for (const st of states) shown.push(st);
    if (level === depth || capped) break;
    const next: Result[][] = [];
    outer: for (const st of states) {
      const g = underState(d, st, get, page, ctx, results);
      for (const mp of d.maps) {
        const ns: Result[] = [];
        for (let i = 0; i < mp.length; i++) {
          const rp = randomPaths[i];
          if (!rp) { ns.push(g(mp[i])); continue; }
          let { path, circle, lo, hi } = rp;
          if (rp.live) {
            // 本层前面已挑好的随机前像替换进状态，再求这个前像的路径。
            const partial = st.map((r, j) => (j < i && randomPaths[j] ? ns[j] : r));
            const live = sh(underState(d, partial, get, page, ctx, results), rp.pathId);
            if (live) ({ path, circle, lo, hi } = { path: live, ...randomRange(live) });
          }
          const u = rnd(), p = pathPointAt(path, circle ? u * G.TAU : lo + (hi - lo) * u);
          ns.push(p ? OK({ k: 'pt', p }) : UNDEF);
        }
        if (ns.every(r => r.status === 'ok' && r.shape)) { next.push(ns); if (++total >= ITER_MAX_MULTI_STATES) { capped = true; break outer; } }
      }
    }
    states = next;
  }
  return OK({ k: 'iter', states: shown, ...(d.maps.length === 1 ? { chain } : {}), ...(depth === 0 ? { zeroDepth: true as const } : {}) });
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
  const iter = io.def;
  // 同一批状态经常还要计算数个点型迭代象。复用映射程序，避免对每个点再次展开几何依赖。
  if (iterFast.enabled && !ctx.posOverride?.size && iter.maps.length > 1 && iter.pre.length === 1 && s.states.length) {
    const mapIndex = iter.maps.findIndex(map => map.length === 1 && map[0] === d.src);
    const program = mapIndex >= 0 ? fastProgramOf(iter, page)?.multi?.[mapIndex] : undefined;
    if (program?.pre[0]?.kind === 'pt') {
      const workspace = prepareFast(program, get);
      if (workspace) {
        const coord = new Float64Array(2);
        const points: Shape[] = new Array(s.states.length);
        let count = 0;
        for (const state of s.states) {
          const input = state[0]?.shape;
          if (input?.k !== 'pt' || !runFastPointInto(program, workspace, input.p.x, input.p.y, coord, 0)) break;
          points[count++] = { k: 'pt', p: { x: coord[0], y: coord[1] } };
        }
        if (count === points.length) return OK({ k: 'multi', items: points });
      }
    }
  }
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
  // 迭代 0 次时迭代象是有定义的空集合：什么也不画（0867 的 0 层方块），但取迭代点时仍落在原象上（0617）。
  return items.length ? OK({ k: 'multi', items, ...(colors.some(Boolean) ? { colors } : {}) }) : s.zeroDepth ? OK({ k: 'multi', items: [] }) : UNDEF;
}

/** 只读取迭代象的最后一个可显示对象，结果与先展开整个迭代象再取末尾一致。 */
function evalLastIterPoint(d: Extract<Def, { k: 'iterimg' }>, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const it = get(d.iter), io = byId(page, d.iter);
  if (it.shape?.k !== 'iter' || io?.def.k !== 'iterate') return UNDEF;
  const states = it.shape.states;
  for (let i = states.length - 1; i >= 0; i--) {
    const r = underState(io.def, states[i], get, page, ctx, results)(d.src);
    if (r.status !== 'ok' || !r.shape || r.shape.k === 'num') continue;
    return r.shape.k === 'pt' ? OK(r.shape) : UNDEF;
  }
  return UNDEF;
}

/** 数值快路径程序：编译结果按迭代定义缓存，迭代体里任何对象的定义被替换就重新编译；编译不了的本次求值内不再尝试。 */
const fastPrograms = new WeakMap<IterDef, FastProgram>();
function fastProgramOf(iter: IterDef, page: Page): FastProgram | undefined {
  if (iterCache?.noFast.has(iter)) return undefined;
  let program = fastPrograms.get(iter);
  if (program && !programValid(program, page)) program = undefined;
  if (!program) {
    program = compileIterBody(iter, page);
    if (!program) { iterCache?.noFast.add(iter); return undefined; }
    fastPrograms.set(iter, program);
  }
  return program;
}

/** 单映射迭代的数组式查表：对象 id 都是小整数，用数组代替 Map/Set，每层用代数戳代替 memo.clear()。 */
interface IterTables { size: number; pre: Int32Array; body: Uint8Array }
const iterTables = new WeakMap<IterDef, IterTables>();
function tablesOf(iter: IterDef): IterTables {
  let t = iterTables.get(iter);
  if (!t) {
    let size = 0;
    for (const id of iter.pre) size = Math.max(size, id + 1);
    for (const id of iter.body) size = Math.max(size, id + 1);
    const pre = new Int32Array(size).fill(-1), body = new Uint8Array(size);
    iter.pre.forEach((id, i) => { pre[id] = i; });   // 同一 id 重复出现时以后者为准，与原来的 Map 构造一致
    for (const id of iter.body) body[id] = 1;
    iterTables.set(iter, t = { size, pre, body });
  }
  return t;
}

/** 轨迹只需要单映射迭代象的末点时，复用状态求值器，避免每层保存闭包及缓存。
 * lastOnly 给出时只留末状态（读取这个迭代的只有这些源对象的迭代象）；其中任何一个在末状态上求不出末点时回到完整保留重来，结果与完整展开一致。 */
function evalSingleMapLastIterPoint(d: Extract<Def, { k: 'iterimg' }>, iter: IterDef, get: Get, page: Page, ctx: EvalCtx, results: Results,
  cacheIteration: (r: Result) => void, lastOnly?: Id[]): Result {
  const retainAll = !lastOnly;
  const dv = 'param' in iter.depth ? plainOf(get, iter.depth.param) : iter.depth.fixed;
  if (dv === undefined || !Number.isFinite(dv)) return UNDEF;
  const depth = Math.max(0, Math.min(ITER_MAX_DEPTH, Math.floor(dv + 1e-9)));
  let state = iter.pre.map(id => get(id));
  if (state.some(r => r.status !== 'ok' || !r.shape)) return UNDEF;
  if (depth === 0) {   // 迭代 0 次：迭代点就是原象本身（与 iterpt 一致）
    const r = underState(iter, state, get, page, ctx, results)(d.src);
    return r.shape?.k === 'pt' ? OK(r.shape) : UNDEF;
  }
  const { size, pre, body } = tablesOf(iter);
  const memoGen = new Int32Array(size), memoVal: Result[] = new Array(size);
  let gen = 1;
  const g: Get = id => {
    if (id >= 0 && id < size) {
      const i = pre[id];
      if (i >= 0 && state[i]) return state[i];
      if (body[id] === 0) return get(id);
      if (memoGen[id] === gen) { const cached = memoVal[id]; if (cached) return cached; }
      const ob = byId(page, id); if (!ob) return MISSING;
      memoGen[id] = gen; memoVal[id] = UNDEF;
      const r = evalObject(ob, g, page, ctx, results);
      memoGen[id] = gen; memoVal[id] = r;
      return r;
    }
    return get(id);
  };
  const map = iter.maps[0], width = map.length;
  const shown: Result[][] = [], chain: Result[][] = retainAll ? [state] : [];
  // 不保留各层状态时，两块缓冲交替使用；失败的一层写在另一块里，不破坏当前状态。
  let spare: Result[] | undefined = retainAll ? undefined : new Array<Result>(width);
  let level = 0;
  // 数值快路径：只在不需要保留各层状态时使用；中途任何不寻常的情形都退回下面的通用循环继续。
  if (!retainAll && iterFast.enabled && !ctx.posOverride?.size) {
    const program = fastProgramOf(iter, page);
    if (program) {
      const run = runFast(program, get, state, depth);
      if (run.levels > 0) { level = run.levels; state = run.state; }
    }
  }
  for (; level < depth && level < ITER_MAX_DEPTH;) {
    gen++;
    const next: Result[] = spare ?? new Array<Result>(width);
    let bad = false;
    for (let i = 0; i < width; i++) { const r = g(map[i]); next[i] = r; if (r.status !== 'ok' || !r.shape) bad = true; }
    if (bad) break;
    if (!retainAll) spare = state;
    state = next; level++;
    if (retainAll) { chain.push(state); if (!iter.finalOnly) shown.push(state); }
  }
  if (retainAll) {
    if (iter.finalOnly && level === depth) shown.push(state);
  } else if (iter.finalOnly ? level === depth : level >= 1) shown.push(state);
  if (lastOnly && !iter.finalOnly && shown.length) {
    // 末状态求不出末点时，要往前找前一层：回到完整保留的做法。
    for (const src of lastOnly) {
      gen++;
      const r = g(src);
      if (r.status !== 'ok' || !r.shape || r.shape.k === 'num') return evalSingleMapLastIterPoint(d, iter, get, page, ctx, results, cacheIteration);
    }
  }
  cacheIteration(OK({ k: 'iter', states: shown, ...(retainAll ? { chain } : {}), ...(depth === 0 ? { zeroDepth: true as const } : {}) }));
  for (let i = shown.length - 1; i >= 0; i--) {
    state = shown[i]; gen++;
    const r = g(d.src);
    if (r.status !== 'ok' || !r.shape || r.shape.k === 'num') continue;
    return r.shape.k === 'pt' ? OK(r.shape) : UNDEF;
  }
  return UNDEF;
}

/** 自定义变换作用于图片（方法 96）：把驱动点放到源图片的各个格点上，求象点的位置。
 * 个别格点无定义时只是不画相邻的格子，定义和依赖都保留；条件恢复后重新求值即可显示。 */
function evalCustomImage(d: Extract<Def, { k: 'custom-image' }>, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const source = get(d.src);
  if (source.status === 'missing' || source.status === 'unsupported') return MISSING;
  const s = source.shape;
  if (source.status !== 'ok' || s?.k !== 'box' || !s.image) return UNDEF;
  if (!byId(page, d.pre) || !byId(page, d.img)) return MISSING;
  const frame = s.image, [c0, c1, , c3] = frame.corners;
  const ex = G.sub(c1, c0), ey = G.sub(c3, c0);
  const srcMesh = frame.mesh;
  const { nx, ny } = srcMesh ?? warpGrid(d.samples, G.len(ex), G.len(ey));
  const body = new Set<Id>([...d.body, d.img]), memo = new Map<Id, Result>();
  let driver: Result = UNDEF, missing = false;
  const g: Get = id => {
    if (id === d.pre) return driver;
    if (!body.has(id)) return get(id);
    const m = memo.get(id); if (m) return m;
    const ob = byId(page, id); if (!ob) return MISSING;
    memo.set(id, UNDEF);   // 打断循环依赖
    const r = evalObject(ob, g, page, ctx, results);
    memo.set(id, r);
    return r;
  };
  const pts = new Float64Array((nx + 1) * (ny + 1) * 2);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = (j * (nx + 1) + i) * 2;
    const p = srcMesh ? { x: srcMesh.pts[k], y: srcMesh.pts[k + 1] } : { x: c0.x + ex.x * i / nx + ey.x * j / ny, y: c0.y + ex.y * i / nx + ey.y * j / ny };
    pts[k] = pts[k + 1] = NaN;
    if (!G.finite(p)) continue;
    driver = OK({ k: 'pt', p });
    memo.clear();
    const r = g(d.img);
    if (r.status === 'missing' || r.status === 'unsupported') { missing = true; break; }
    if (r.shape?.k === 'pt' && G.finite(r.shape.p)) { pts[k] = r.shape.p.x; pts[k + 1] = r.shape.p.y; }
  }
  if (missing) return MISSING;
  const mesh: WarpMesh = { nx, ny, pts, cells: new Uint8Array(nx * ny) };
  const clips = frame.clips;
  warpCells(mesh, d.distortion, (i, j) => {
    if (srcMesh && !srcMesh.cells[j * nx + i]) return false;
    if (!clips?.length) return true;
    const u = (i + 0.5) / nx, v = (j + 0.5) / ny;
    const vertices = srcMesh && [warpVertex(srcMesh, i, j), warpVertex(srcMesh, i + 1, j), warpVertex(srcMesh, i + 1, j + 1), warpVertex(srcMesh, i, j + 1)];
    const p = vertices ? { x: vertices.reduce((sum, point) => sum + point.x, 0) / 4, y: vertices.reduce((sum, point) => sum + point.y, 0) / 4 } : { x: c0.x + ex.x * u + ey.x * v, y: c0.y + ex.y * u + ey.y * v };
    return clips.every(clip => G.inPolygon(p, clip));
  });
  const b = warpBounds(mesh);
  if (!b) return UNDEF;
  const corners = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  return OK({ k: 'box', ...imageBox(corners), image: { data: frame.data, mime: frame.mime, corners, mesh } });
}

/** 定义对象创建后不再就地改依赖，父对象列表可以按定义对象缓存（计算对象每次都要遍历表达式树）。 */
const parentsCache = new WeakMap<Def, Id[]>();
function parentsMemo(d: Def): Id[] {
  let par = parentsCache.get(d);
  if (!par) parentsCache.set(d, par = parentsOf(d));
  return par;
}

function evalObject(o: Obj, get: Get, page: Page, ctx: EvalCtx, results: Results): Result {
  const d = o.def;
  const moving = ctx.posOverride?.get(o.id);
  if (moving) return OK({ k: 'pt', p: moving });
  // 按钮的动作目标可能暂时无定义。按钮的位置独立，点击时再处理各个目标。
  if (d.k === 'button') return OK({ k: 'box', at: d.at, w: d.w, h: d.h });
  // 迭代和迭代象不要求所有父对象当前都有定义：前像换成别的值之后，某些对象才有定义
  if (d.k === 'iterate') return evalIterate(d, get, page, ctx, results);
  if (d.k === 'iterimg') return evalIterImage(d, get, page, ctx, results);
  if (d.k === 'itertable') return evalIterTable(d, get, page, ctx, results);
  // 轨迹在路径上重新求值，当前驱动位置的无定义不影响其它样本。
  if (d.k === 'locus') return evalLocus(d, o, page, get, results, ctx);
  if (d.k === 'iterpt') {
    const m = get(d.img).shape; const last = m?.k === 'multi' ? m.items[m.items.length - 1] : undefined;
    if (last?.k === 'pt') return OK(last);
    // 迭代 0 次：迭代点就是原象本身（素数表.gsp：迭代次数取自数值 0.37，外层迭代仍要用它）
    if (m?.k === 'multi' && m.items.length === 0) {
      const img = byId(page, d.img)?.def, io = img?.k === 'iterimg' ? byId(page, img.iter) : undefined;
      if (img?.k === 'iterimg' && io?.def.k === 'iterate') { const r = underState(io.def, io.def.pre.map(id => get(id)), get, page, ctx, results)(img.src); return r.shape?.k === 'pt' ? OK(r.shape) : UNDEF; }
    }
    return UNDEF;
  }
  if (d.k === 'custom-image') return evalCustomImage(d, get, page, ctx, results);
  // 文字里插入的数值无定义时原版照样显示文字（该处写“未定义”，正六边形点的迭代说明截图）；只有锚点决定文字是否有定义
  if (d.k === 'text') {
    if (d.anchor === undefined || !d.off) return OK({ k: 'box', at: d.at, w: d.w, h: d.h });
    const anchor = get(d.anchor), ap = anchor.shape?.k === 'pt' ? anchor.shape.p : undefined;
    return ap ? OK({ k: 'box', at: { x: ap.x + d.off.x, y: ap.y + d.off.y }, w: d.w, h: d.h }) : anchor.status === 'missing' || anchor.status === 'unsupported' ? MISSING : UNDEF;
  }
  if (d.k === 'custom-point') {
    const source = get(d.src);
    if (source.shape?.k !== 'pt') return UNDEF;
    return underState({ k: 'iterate', pre: [d.pre], maps: [[d.img]], body: [...new Set([...d.body, d.img])], depth: { fixed: 1 } }, [source], get, page, ctx, results)(d.img);
  }
  const par = parentsMemo(d);
  // 父对象缺结果：保留定义，等待条件恢复
  for (const id of par) { const r = get(id); if (r.status === 'missing' || r.status === 'unsupported') return MISSING; if (r.status !== 'ok') return r.status === 'undefined' ? UNDEF : MISSING; }
  switch (d.k) {
    case 'free': { const p = ctx.posOverride?.get(o.id) ?? { x: d.x, y: d.y }; return Number.isFinite(p.x) && Number.isFinite(p.y) ? OK({ k: 'pt', p }) : UNDEF; }
    case 'onpath': {
      const shape = sh(get, d.path), override = ctx.tOverride?.get(o.id);
      if (d.edge !== undefined && override === undefined) {
        const p = shape?.k === 'poly' ? polygonEdgePoint(shape.pts, d.edge, d.t) : undefined;
        return p ? OK({ k: 'pt', p }) : UNDEF;
      }
      const t = override ?? d.t;
      if (d.abs && shape?.k === 'line') {
        const { a, b, ext } = shape.s, len = G.dist(a, b);
        if (len === 0) return UNDEF;
        const px = ext === 'line' ? t : ext === 'ray' ? Math.max(0, t) : Math.max(0, Math.min(len, t));
        return OK({ k: 'pt', p: { x: a.x + ((b.x - a.x) / len) * px, y: a.y + ((b.y - a.y) / len) * px } });
      }
      const parent = byId(page, d.path)?.def;
      const p = parent?.k === 'pcurve' ? evalPcurvePoint(parent, get, page, t) : pathPointAt(shape, t, parent?.k === 'locus' && parent.colored === true);
      return p ? OK({ k: 'pt', p }) : UNDEF;
    }
    case 'combine': { const path = sh(get, d.path), p = pointOf(get, d.src); const pr = p && projectToPath(path, p); return pr ? OK({ k: 'pt', p: pr.p }) : UNDEF; }
    case 'mid': { const s = straightOf(get, d.seg); return s ? OK({ k: 'pt', p: G.mid(s.a, s.b) }) : UNDEF; }
    case 'inter': return evalIntersection(d, get, page);
    case 'translate': case 'rotate': case 'dilate': case 'reflect': {
      const src = sh(get, d.src); if (!src) return UNDEF;
      const tm = transformOf(d, get, page); if (!tm) return UNDEF;
      const out = mapShape(src, tm);
      return out ? OK(out) : UNDEF;
    }
    case 'axispt': { const sys = sh(get, d.sys), v = plainOf(get, d.value); return sys?.k === 'sys' && v !== undefined ? OK({ k: 'pt', p: d.axis === 'x' ? fromSys(sys, v, 0) : fromSys(sys, 0, v) }) : UNDEF; }
    case 'plotfix': { const sys = sh(get, d.sys); return sys?.k === 'sys' ? OK({ k: 'pt', p: fromSys(sys, d.x, d.y) }) : UNDEF; }
    case 'plotxy': {
      const sys = sh(get, d.sys), x = qOf(get, d.x), y = qOf(get, d.y), px = plainOf(get, d.x), py = plainOf(get, d.y);
      if (sys?.k !== 'sys' || !x || !y || px === undefined || py === undefined) return UNDEF;
      const a = y.u === 'angle' ? y.v * Math.PI / 180 : y.v;
      return OK({ k: 'pt', p: d.polar ? fromSys(sys, px * Math.cos(a), px * Math.sin(a)) : fromSys(sys, px, py) });
    }
    case 'colorize': {
      const r = get(d.src), values = d.params.map(id => plainOf(get, id) ?? NaN), color = parameterColor(d, values);
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
      const r = s ? G.dist(s.a, s.b) : rv?.k === 'num' && Number.isFinite(rv.q.v) ? rv.q.v * CM : undefined;
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
      return OK(ccw ? arcShape(circ.c, circ.r, aa, G.sweep(aa, ac)) : arcShape(circ.c, circ.r, ac, G.sweep(ac, aa), true));
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
      if (d.appearance) {
        const degrees = markedSweep(d, get);
        if (degrees === undefined) return UNDEF;
        const sweep = Math.abs(degrees) * Math.PI / 180;
        const start = G.angleOf(v, (degrees < 0 ? b : a)!);
        const radius = [16, 20, 24, 30][d.appearance.size] ?? 24;
        const count = Math.min(32, Math.max(1, d.count));
        const shapes: Shape[] = [];
        const fill = d.appearance.fill;
        const color = fill === 0xfefefe ? undefined : '#' + [fill & 255, (fill >>> 8) & 255, (fill >>> 16) & 255].map(n => n.toString(16).padStart(2, '0')).join('');
        if (Math.abs(sweep - Math.PI / 2) < 1e-12) {
          const corner = (r: number) => [G.add(v, G.mul(u, r)), G.add(v, G.mul(G.add(u, w), r)), G.add(v, G.mul(w, r))];
          shapes.push({ k: 'poly', pts: [v, ...corner(radius / Math.SQRT2)] });
          for (let i = 0; i < count; i++) shapes.push({ k: 'paths', paths: [corner((radius + i * 4) / Math.SQRT2)] });
        } else {
          shapes.push({ k: 'sector', c: v, r: radius, a0: start, sweep, segment: false });
          for (let i = 0; i < count; i++) shapes.push(arcShape(v, radius + i * 4, start, sweep));
        }
        return OK({ k: 'multi', items: shapes, ...(color ? { colors: [color] } : {}) });
      }
      const size = 12;
      if (Math.abs(G.dot(u, w)) < 1e-7) return OK({ k: 'paths', paths: [[G.add(v, G.mul(u, size)), G.add(v, G.mul(G.add(u, w), size)), G.add(v, G.mul(w, size))]] });
      const a0 = G.angleOf(v, a!), sweep = G.sweep(a0, G.angleOf(v, b!));
      return OK({ k: 'paths', paths: Array.from({ length: Math.max(1, d.count) }, (_, j) => Array.from({ length: 25 }, (_, i) => ({ x: v.x + (size + 4 * j) * Math.cos(a0 + sweep * i / 24), y: v.y - (size + 4 * j) * Math.sin(a0 + sweep * i / 24) }))) });
    }
    case 'segment-mark': {
      const line = straightOf(get, d.seg);
      if (!line || line.ext !== 'segment') return UNDEF;
      const u = G.unit(G.sub(line.b, line.a));
      if (!u || !Number.isFinite(d.t)) return UNDEF;
      const normal = { x: -u.y, y: u.x }, at = G.pointAt(line, d.t);
      const count = Math.min(32, Math.max(1, Math.trunc(d.count)));
      const paths = Array.from({ length: count }, (_, i) => {
        const center = G.add(at, G.mul(u, (i - (count - 1) / 2) * 4 - 2));
        if (d.mode === 'tick') return [G.add(center, G.mul(normal, -6)), G.add(center, G.mul(normal, 6))];
        const tail = G.add(center, G.mul(u, -4)), tip = G.add(center, G.mul(u, 4));
        return [G.add(tail, G.mul(normal, -7.5)), tip, G.add(tail, G.mul(normal, 7.5))];
      });
      return d.mode === 'filled' ? OK({ k: 'multi', items: paths.map(pts => ({ k: 'poly', pts })) }) : OK({ k: 'paths', paths });
    }
    case 'poly': { const pts = d.pts.map(id => pointOf(get, id)); return pts.every(Boolean) && pts.length >= 3 ? OK({ k: 'poly', pts: pts as Pt[] }) : UNDEF; }
    case 'circle-int': { const c = circleOf(get, d.circle); return c ? OK({ k: 'disk', c: c.c, r: c.r }) : UNDEF; }
    case 'arc-int': { const s = sh(get, d.arc); return s?.k === 'arc' ? OK({ k: 'sector', c: s.c, r: s.r, a0: s.a0, sweep: s.sweep, segment: d.mode === 'segment' }) : UNDEF; }
    case 'plot': return evalPlot(d, get, page, ctx);
    case 'pcurve': return evalPcurve(d, get, page);
    case 'measure': return evalMeasure(d, get, page, ctx.angleUnit);
    case 'param': return OK({ k: 'num', q: q(ctx.valOverride?.get(o.id) ?? d.value, d.unit) });
    case 'calc': {
      const v = evalCalculation(get, page, d.expr);
      // 类型号为“无单位”的计算，结果不带距离单位（0959：无单位 × 距离的结果，原版显示为纯数字；角度单位的例子见工具兼容测试，不在此列）。
      return v ? OK({ k: 'num', q: d.unit !== 'none' && v.u === 'none' ? q(v.v, d.unit) : d.unit === 'none' && v.u === 'distance' ? q(v.v, 'none') : v }) : UNDEF;
    }
    case 'func': return functionExpression(page, o.id) ? OK({ k: 'func' }) : UNDEF;
    case 'picfunc': {
      const source = sh(get, d.stroke), sys = sh(get, d.sys);
      if (sys?.k !== 'sys') return UNDEF;
      if (!d.height) return byId(page, d.stroke)?.def.k === 'stroke' || (source?.k === 'box' && source.image && d.profile?.length) ? OK({ k: 'func' }) : UNDEF;
      if (source?.k !== 'box' || !source.image) return UNDEF;
      const png = d.heightRaster ?? (source.image.mime === 'image/png' ? source.image.data : undefined);
      if (!png) return { status: 'unsupported' };
      let cached = heightMasks.get(d);
      if (cached?.png !== png) {
        cached = { png, mask: readHeightMask(png) };
        heightMasks.set(d, cached);
      }
      if (!cached.mask) return { status: 'unsupported' };
      const convert = (points: Pt[]) => points.map(p => toSys(sys, p)).filter((p): p is Pt => p !== undefined);
      const corners = convert(source.image.corners);
      if (corners.length !== 4) return UNDEF;
      const clips = (source.image.clips ?? []).map(convert);
      return OK({ k: 'func', heightPaths: imageHeightPaths(cached.mask, corners, clips) });
    }
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
    case 'image': {
      let corners: Pt[];
      const placement = d.placement;
      if (placement?.kind === 'center') {
        const center = pointOf(get, placement.center);
        if (!center) return UNDEF;
        const w = d.w * placement.sx, h = d.h * placement.sy;
        const c = Math.cos(placement.angle), s = Math.sin(placement.angle);
        const x = { x: w * c, y: w * s }, y = { x: -h * s, y: h * c };
        const a = G.sub(center, G.mul(G.add(x, y), 0.5));
        corners = [a, G.add(a, x), G.add(G.add(a, x), y), G.add(a, y)];
      } else if (placement?.kind === 'corners') {
        const a = pointOf(get, placement.pts[0]), b = pointOf(get, placement.pts[1]);
        if (!a || !b) return UNDEF;
        if (placement.pts.length === 2) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          corners = imageCorners({ at: { x, y }, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
        } else {
          const c = pointOf(get, placement.pts[2]);
          if (!c) return UNDEF;
          corners = [a, G.add(a, G.sub(b, c)), b, c];
        }
      } else corners = imageCorners(d);
      const clip = d.clip !== undefined ? sh(get, d.clip) : undefined;
      if (corners.some(p => !G.finite(p)) || (d.clip !== undefined && clip?.k !== 'poly')) return UNDEF;
      return OK({ k: 'box', ...imageBox(corners), image: { data: d.data, mime: d.mime, corners, ...(clip?.k === 'poly' ? { clips: [clip.pts] } : {}) } });
    }
    case 'image-clip': {
      const source = sh(get, d.src), mask = sh(get, d.clip);
      if (source?.k !== 'box' || !source.image || mask?.k !== 'poly') return UNDEF;
      return OK({ ...source, image: { ...source.image, clips: [...(source.image.clips ?? []), mask.pts] } });
    }
    case 'stroke': return OK({ k: 'paths', paths: [d.pts] });
    case 'unknown': return { status: 'unsupported' };
  }
}

/** 页面上某个函数（含绘图函数）在 x 处的值（声音按钮等不经过求值缓存的用法）。 */
export function evalFunction(page: Page, results: Results, id: Id, x: number, angleUnit?: EvalCtx['angleUnit']): number | undefined {
  const old = setRadianMode(angleUnit === 'rad');
  try { return callFunc(id2 => results.get(id2) ?? UNDEF, page, id, q(x))?.v; } finally { setRadianMode(old); }
}

export function evaluateExpression(page: Page, results: Results, expr: Expr, angleUnit?: EvalCtx['angleUnit']): Q | undefined {
  const old = setRadianMode(angleUnit === 'rad');
  try { return evalCalculation(id => results.get(id) ?? MISSING, page, expr); } finally { setRadianMode(old); }
}

function evalCalculation(get: Get, page: Page, expr: Expr): Q | undefined {
  let cached = iterCache?.calculations.get(get);
  if (!cached || cached.page !== page) {
    cached = { page, env: { ref: id => qOfRaw(get, id), call: (f, a) => callFunc(get, page, f, a) } };
    iterCache?.calculations.set(get, cached);
  }
  return evalExpr(expr, cached.env);
}

const heightMasks = new WeakMap<Def, { png: string; mask: HeightMask | undefined }>();

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
    const clips = shape.image.clips;
    if (clips) paths = paths.flatMap(path => { const pieces: Pt[][] = []; let part: Pt[] = []; for (const p of path) { if (clips.every(clip => G.inPolygon(p, clip))) part.push(p); else if (part.length) { pieces.push(part); part = []; } } if (part.length) pieces.push(part); return pieces; });
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

/** 函数图像采样用的 x→y：能编译成闭包就编译（与 callFunc 逐位相同），否则逐个 x 走通用求值器。 */
function functionValue(get: Get, page: Page, id: Id): (x: number) => number | undefined {
  const fast = compileFuncValue(page, id, rid => { const s = sh(get, rid); return s?.k === 'num' && s.q.u === 'none' ? s.q.v : undefined; });
  return fast ?? (x => callFunc(get, page, id, q(x))?.v);
}

function callFunc(get: Get, page: Page, id: Id, arg: Q, stack = new Set<Id>()): Q | undefined {
  const f = byId(page, id);
  if (f?.def.k === 'picfunc') {
    if (!f.def.height) return picValue(get, page, f.def, arg.v);
    const result = sh(get, id);
    const value = result?.k === 'func' && result.heightPaths ? imageHeightAt(result.heightPaths, arg.v) : undefined;
    return value === undefined ? undefined : q(value);
  }
  if (!f || f.def.k !== 'func') return undefined;
  const expr = f.def.derivativeOf === undefined ? f.def.expr : functionExpression(page, id);
  if (!expr || stack.has(id)) return undefined;
  stack.add(id);
  try { const value = evalExpr(expr, { ref: r => qOf(get, r), x: arg, call: (g2, a2) => callFunc(get, page, g2, a2, stack) }); return value && Number.isFinite(value.v) ? value : undefined; }
  finally { stack.delete(id); }
}

const intersectionStraight = (s?: Shape): Straight | undefined => isLine(s) ? s.s : undefined;
const intersectionCircle = (s?: Shape): Circ | undefined => (isCirc(s) ? s.c : s?.k === 'arc' ? { c: s.c, r: s.r } : undefined);
const intersectionOnArc = (s: Shape | undefined, p: Pt) => {
  if (s?.k !== 'arc') return true;
  const angle = G.angleOf(s.c, p);
  const offset = s.sweep < 0 ? G.sweep(angle, s.a0) : G.sweep(s.a0, angle);
  return offset <= Math.abs(s.sweep) + 1e-9 || offset >= G.TAU - 1e-9;
};
function validIntersection(p: Pt | undefined, a: Shape | undefined, b: Shape | undefined, points: Pt[],
  straight: Straight | undefined, raw: ReturnType<typeof G.intersectLineCircleRaw> | undefined): p is Pt {
  return !!p && (!raw || !!straight && G.paramOk(straight.ext, raw[points.indexOf(p)].t)) &&
    intersectionOnArc(a, p) && intersectionOnArc(b, p);
}

function evalIntersection(d: Extract<Def, { k: 'inter' }>, get: Get, page: Page): Result {
  const a = sh(get, d.a), b = sh(get, d.b), onArc = intersectionOnArc;
  const sa = intersectionStraight(a), sb = intersectionStraight(b), ca = intersectionCircle(a), cb = intersectionCircle(b);
  let pts: Pt[] = [];
  // 两条普通 y=f(x) 曲线的交点按第一条曲线的采样顺序编号；其余组合暂不推断原版的分支顺序。
  if (a?.k === 'paths' && b?.k === 'paths') {
    const da = byId(page, d.a)?.def, db = byId(page, d.b)?.def;
    const fa = da?.k === 'plot' ? byId(page, da.func)?.def : undefined;
    const fb = db?.k === 'plot' ? byId(page, db.func)?.def : undefined;
    if (da?.k !== 'plot' || db?.k !== 'plot' || da.sys !== db.sys ||
      fa?.k !== 'func' || fb?.k !== 'func' || (fa.form ?? 'y=f(x)') !== 'y=f(x)' || (fb.form ?? 'y=f(x)') !== 'y=f(x)') return UNDEF;
    for (const first of a.paths) for (let i = 0; i + 1 < first.length; i++) {
      const segment: Straight = { a: first[i], b: first[i + 1], ext: 'segment' };
      const candidates: { p: Pt; t: number }[] = [];
      for (const second of b.paths) for (let j = 0; j + 1 < second.length; j++) {
        const p = second[j], q = second[j + 1];
        const pad = G.EPS * Math.max(1, Math.abs(segment.b.x - segment.a.x), Math.abs(segment.b.y - segment.a.y), Math.abs(q.x - p.x), Math.abs(q.y - p.y));
        if (Math.max(segment.a.x, segment.b.x) + pad < Math.min(p.x, q.x) || Math.max(p.x, q.x) + pad < Math.min(segment.a.x, segment.b.x) ||
          Math.max(segment.a.y, segment.b.y) + pad < Math.min(p.y, q.y) || Math.max(p.y, q.y) + pad < Math.min(segment.a.y, segment.b.y)) continue;
        const hit = G.intersectStraights(segment, { a: p, b: q, ext: 'segment' });
        if (hit) candidates.push({ p: hit, t: G.projectParam(segment, hit) ?? 0 });
      }
      candidates.sort((x, y) => x.t - y.t);
      for (const { p } of candidates) {
        if (pts.some(x => G.dist(x, p) < G.EPS)) continue;
        if (pts.length === d.branch) return OK({ k: 'pt', p });
        pts.push(p);
      }
    }
    const alternate = d.alternate ? pts[1 - d.branch] : undefined;
    return alternate ? OK({ k: 'pt', p: alternate }) : UNDEF;
  }
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
        if (!st && pts.length === d.branch) return OK({ k: 'pt', p: hit });
        pts.push(hit);
      }
    }
    if (st) {
      // 方法 98 的直线与曲线交点沿直线编号。纵轴在原版从上往下编号。
      const direction = G.sub(st.b, st.a);
      const sign = reversedAxisPaths.has(pl === a ? d.b : d.a) ? -1 : 1;
      pts.sort((p, q) => sign * G.dot(G.sub(p, q), direction));
      const hit = pts[Math.min(d.branch, pts.length - 1)];
      return hit ? OK({ k: 'pt', p: hit }) : UNDEF;
    }
    return UNDEF;
  }
  // 分支号指的是整条直线/整个圆的第几个交点（射线、线段、弧的范围放在选定之后再检查），
  // 所以射线从圆心出发时，朝前的那个交点是 1 号而不是 0 号。
  let raw: ReturnType<typeof G.intersectLineCircleRaw> | undefined;
  let branch = d.branch;
  const straight = sa ?? sb, round = ca ?? cb;
  if (sa && sb) { const p = G.intersectStraights(sa, sb); pts = p ? [p] : []; }
  else if (straight && round) {
    raw = G.intersectLineCircleRaw(straight, round);
    // 直线与弧求交时，原版的分支号按直线方向从远端数起（与圆相反；原版夹具 ia1/ia2：直线 D→E 时分支 0 在右端，反向后在左端；圆的夹具 io/ip 与新版一致）
    const arc = a?.k === 'arc' || b?.k === 'arc';
    const reversed = reversedAxisPaths.has(sa ? d.a : d.b);
    if (raw.length === 2 && arc !== reversed) raw.reverse();
    pts = raw.map(x => x.p);
    // 已有的两条分支在相切时汇合，射线、线段及弧的范围照常检查。
    if (raw.length === 1 && branch === 1) branch = 0;
  }
  else if (ca && cb) pts = G.intersectCircles(ca, cb);
  const preferred = pts[branch];
  if (validIntersection(preferred, a, b, pts, straight, raw)) return OK({ k: 'pt', p: preferred });
  const alternate = d.alternate ? pts[1 - d.branch] : undefined;
  return validIntersection(alternate, a, b, pts, straight, raw) ? OK({ k: 'pt', p: alternate }) : UNDEF;
}

/** 外层轨迹只读取一条内层点轨迹的首末点时，可直接算相应端点。
 * 仅限弧驱动的常规点构造。若端点和相邻样本没有组成连续的一段，就求完整轨迹。 */
function sampledLocusEndpoint(o: Obj, driven: Set<Id>, get: Get, results: Results, page: Page, ctx: EvalCtx): Result | undefined {
  const d = o.def;
  if (d.k !== 'onpath' || (d.t !== 0 && d.t !== 1) || d.edge !== undefined || ctx.tOverride?.has(o.id) ||
      ctx.posOverride?.has(o.id) || !driven.has(d.path) || results.has(d.path) || ctx.posOverride?.has(d.path)) return undefined;
  const locus = byId(page, d.path)?.def;
  if (locus?.k !== 'locus' || locus.parameter || locus.path !== undefined || locus.colored) return undefined;
  const driver = byId(page, locus.driver)?.def;
  const path = driver?.k === 'onpath' ? sh(get, driver.path) : undefined;
  if (path?.k !== 'arc') return undefined;

  const moves = descendants(page, [locus.driver]), needed = dependsChain(page, locus.out);
  for (const id of needed) {
    if (id === locus.driver) continue;
    if (!moves.has(id)) {
      const r = get(id);
      if (r.status === 'missing' || r.status === 'unsupported') return undefined;
      continue;
    }
    const kind = byId(page, id)?.def.k;
    // 这些构造只在父对象缺失时返回 missing，且在整个取样过程中保持图形类型。
    if (kind !== 'seg' && kind !== 'parallel' && kind !== 'perp' && kind !== 'inter' && kind !== 'dilate' && kind !== 'mid') return undefined;
  }
  const count = Math.max(40, Math.min(5000, Number.isFinite(locus.samples) ? Math.round(locus.samples) : 500));
  const sample = (t: number) => {
    const p = pathPointAt(path, t);
    if (!p || !G.finite(p)) return undefined;
    const memo: Results = new Map([[locus.driver, OK({ k: 'pt', p })]]);
    const sampleGet: Get = id => {
      const cached = memo.get(id); if (cached) return cached;
      if (!moves.has(id)) return get(id);
      const obj = byId(page, id); if (!obj) return MISSING;
      memo.set(id, UNDEF);
      const r = evalObject(obj, sampleGet, page, ctx, memo);
      memo.set(id, r);
      return r;
    };
    const r = sampleGet(locus.out);
    return r.shape?.k === 'pt' && G.finite(r.shape.p) ? r.shape : undefined;
  };
  const edge = sample(d.t), next = sample(d.t === 0 ? 1 / count : (count - 1) / count);
  if (!edge || !next || Math.max(Math.abs(edge.p.x - next.p.x), Math.abs(edge.p.y - next.p.y)) > 26) return undefined;
  return OK(edge);
}

function evalLocus(d: Extract<Def, { k: 'locus' }>, o: Obj, page: Page, get: Get, results: Results, ctx: EvalCtx): Result {
  const drv = byId(page, d.driver);
  if (!drv || !byId(page, d.out)) return MISSING;
  const parameter = d.parameter;
  if (parameter && drv.def.k !== 'param') return UNDEF;
  const pathId = d.path ?? (drv.def.k === 'onpath' ? drv.def.path : undefined);
  const pathResult = pathId === undefined ? undefined : get(pathId), path = pathResult?.shape;
  if (!parameter && !path) return pathResult?.status === 'missing' || pathResult?.status === 'unsupported' ? MISSING : UNDEF;
  const pathDef = pathId === undefined ? undefined : byId(page, pathId)?.def;
  const continuous = pathDef?.k === 'pcurve' || (pathDef?.k === 'locus' && pathDef.colored === true);
  // 被驱动点依赖的对象链（按创建顺序）
  const driven = descendants(page, [d.driver]), needed = dependsChain(page, d.out);
  const chain = page.objects.filter(x => x.id === d.driver || (driven.has(x.id) && x.id !== o.id && needed.has(x.id)));
  const total = Math.max(parameter ? 2 : 40, Math.min(5000, Number.isFinite(d.samples) ? Math.round(d.samples) : 500));
  const circleLike = path?.k === 'circle' || path?.k === 'disk';
  let lo = path?.k === 'line' && path.s.ext === 'line' ? -3 : 0;
  let hi = path?.k === 'line' && path.s.ext !== 'segment' ? 3 : 1;
  // 直线、射线上的驱动点取遍当前视图（四周各留半个视图）：原版 蚶线.gsp 的轨迹画满窗口，按 ±3 个单位只画出一段
  if (path?.k === 'line' && path.s.ext !== 'segment') {
    if (d.pathRange) [lo, hi] = d.pathRange;
    else if (ctx.view) {
      const range = viewParamRange(path.s, ctx.view);
      if (range) { lo = path.s.ext === 'ray' ? Math.max(0, range[0]) : range[0]; hi = Math.max(lo + 1e-9, range[1]); }
    }
  }
  const paths: Pt[][] = [[]], colors: (string | undefined)[][] = [[]], positions: number[][] = [[]];
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
  if (!parameter && !continuous && fast && outSlot !== undefined && !Array.isArray(initial[outSlot])) {
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
  // 通用路径。被驱动对象的结果按“对象 × 样本”存表，同一次求值里驱动点、路径、样本数都相同的轨迹共用这张表
  // （课件里一组轨迹常常共用驱动点和大半依赖链）；不依赖驱动点的对象直接取现成结果，不再每个样本复制结果表。
  // 链里有迭代、嵌套轨迹这类要读整张结果表的对象时，走逐样本重建表的慢路径。
  const needsTable = page.objects.some(x => needed.has(x.id) && driven.has(x.id) && TABLE_KINDS.has(x.def.k));
  let local: Results = results, written: Id[] = [];
  const shareKey = `${d.driver}:${pathId}:${total}:${lo}:${hi}:${parameter?.range.join(',') ?? ''}`;
  const pool = get === topGet ? locusShare : undefined;
  let share = needsTable ? undefined : pool?.get(shareKey);
  if (!needsTable && !share) { const flags: boolean[] = []; flags[d.driver] = true; for (const id of driven) flags[id] = true; share = { table: [], fixed: [], driven: flags }; pool?.set(shareKey, share); }
  const visiting = new Set<Id>(), busy: boolean[] = [];
  // 迭代只被迭代象读取、迭代象又只被迭代点读取时，缓存里只需保留末状态（各迭代象的末点都在末状态上核对过）。
  const lastOnlySrcs = new Map<Id, Id[] | undefined>();
  const lastOnlyFor = (iterId: Id): Id[] | undefined => {
    if (lastOnlySrcs.has(iterId)) return lastOnlySrcs.get(iterId);
    const images = chain.filter(x => x.def.k === 'iterimg' && x.def.iter === iterId);
    const only = chain.every(x => {
      const parents = parentsMemo(x.def);
      if (parents.includes(iterId)) return x.def.k === 'iterimg';
      return !images.some(im => parents.includes(im.id)) || x.def.k === 'iterpt';
    });
    const srcs = only ? images.map(im => (im.def as Extract<Def, { k: 'iterimg' }>).src) : undefined;
    lastOnlySrcs.set(iterId, srcs);
    return srcs;
  };
  const lastPoint = (image: Extract<Def, { k: 'iterimg' }>, getter: Get, values: Results): Result => {
    const iter = byId(page, image.iter);
    if (iter?.def.k === 'iterate' && iter.def.maps.length === 1 && !iter.def.random && driven.has(iter.id) &&
      !values.has(iter.id) && !ctx.posOverride?.has(iter.id)) {
      const only = lastOnlyFor(iter.id);
      return evalSingleMapLastIterPoint(image, iter.def, getter, page, ctx, values, r => {
        values.set(iter.id, r);
        if (values === local) written.push(iter.id);
      }, only && [...new Set([image.src, ...only])]);
    }
    return evalLastIterPoint(image, getter, page, ctx, values);
  };
  let sample = 0;
  const lget: Get = share ? id => {
    const moving = share!.driven[id];
    if (moving) { const r = share!.table[id]?.[sample]; if (r) return r; }
    // 不随驱动点变化的对象取外层的值：在迭代状态下求轨迹时外层是该状态的取值，不能直接读顶层结果（保形映射1.gsp 的迭代象）
    else { const r = share!.fixed[id] ?? (get === topGet ? results.get(id) : get(id)); if (r) { share!.fixed[id] = r; return r; } }
    const obj = byId(page, id); if (!obj) return MISSING;
    if (busy[id]) return UNDEF;
    busy[id] = true;
    const r = evalObject(obj, lget, page, ctx, results);
    busy[id] = false;
    if (moving) (share!.table[id] ??= [])[sample] = r; else share!.fixed[id] = r;
    return r;
  } : id => {
    const have = local.get(id);
    if (have) return have;
    if (get !== topGet && id !== d.driver && !driven.has(id)) { const r = get(id); local.set(id, r); return r; }   // 迭代状态下不随驱动点变化的对象
    const obj = byId(page, id); if (!obj) return MISSING;
    if (visiting.has(id)) return UNDEF;
    visiting.add(id);
    const image = obj.def.k === 'iterpt' ? byId(page, obj.def.img) : undefined;
    const r = image?.def.k === 'iterimg' && driven.has(image.id) && !local.has(image.id) && !ctx.posOverride?.has(image.id)
      ? lastPoint(image.def, lget, local)
      : sampledLocusEndpoint(obj, driven, lget, local, page, ctx) ?? evalObject(obj, lget, page, ctx, local);
    visiting.delete(id);
    local.set(id, r); written.push(id);
    return r;
  };
  if (!share) { local = get === topGet ? new Map(results) : new Map(); for (const x of chain) local.delete(x.id); }
  for (let i = 0; i <= total; i++) {
    const u = i / total;
    const t = circleLike ? u * G.TAU : lo + (hi - lo) * u;
    sample = i;
    if (!share) { for (let w = written.length - 1; w >= 0; w--) local.delete(written[w]); written = []; }
    let driverValue: Result;
    if (parameter && drv.def.k === 'param') {
      const [start, end] = parameter.range;
      const value = start + (end - start) * u;
      const unit = drv.def.unit;
      driverValue = Number.isFinite(value) ? OK({ k: 'num', q: q(unit === 'angle' ? value * 180 / Math.PI : value, unit) }) : UNDEF;
    } else {
      const override = pathDef?.k === 'pcurve' ? evalPcurvePoint(pathDef, get, page, t) : pathPointAt(path, t, continuous);
      if (!override) {
        if (!share) local.delete(d.driver);
        if (continuous && paths[paths.length - 1].length) { paths.push([]); colors.push([]); positions.push([]); }
        continue;
      }
      driverValue = OK({ k: 'pt', p: override });
    }
    if (share) (share.table[d.driver] ??= [])[i] ??= driverValue;
    else local.set(d.driver, driverValue);
    const r = lget(d.out);
    const shape = r.shape;
    if (isPt(shape)) { paths[paths.length - 1].push(shape.p); colors[colors.length - 1].push(r.color); positions[positions.length - 1].push(u); }
    // 轨迹的轨迹（轨迹旋转A.gsp：以轨迹为“被驱动对象”画出一族曲线）也逐个保留
    else if (shape && (shape.k === 'line' || shape.k === 'circle' || shape.k === 'arc' || shape.k === 'poly' || shape.k === 'disk' || shape.k === 'sector' || shape.k === 'paths' || shape.k === 'multi' || (shape.k === 'box' && shape.image))) {   // 图片的轨迹：每个样本位置各画一张（图片也能构造轨迹.gsp）
      items.push(shape);
      itemColors.push(r.color);
    }
    else if (paths[paths.length - 1].length) { paths.push([]); colors.push([]); positions.push([]); }
    if (r.status === 'missing' || r.status === 'unsupported') return MISSING;
  }
  if (items.length) return OK({ k: 'multi', items, ...(itemColors.some(Boolean) ? { colors: itemColors } : {}) });
  // 两个相邻样本之间若发生跳变，直接连线会穿过本不存在的轨迹。先找相对两侧
  // 突然变长的线段，再二分求值：连续的陡曲线最终会缩短，真正的跳变不会。
  // 原版自制夹具在横、纵方向每轴约 26 页面像素处断开；小跳变仍连接。
  const axisDistance = (a: Pt, b: Pt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const probe = (u: number): { p: Pt; color?: string } | undefined => {
    let driverValue: Result;
    if (parameter && drv.def.k === 'param') {
      const value = parameter.range[0] + (parameter.range[1] - parameter.range[0]) * u;
      driverValue = Number.isFinite(value) ? OK({ k: 'num', q: q(drv.def.unit === 'angle' ? value * 180 / Math.PI : value, drv.def.unit) }) : UNDEF;
    } else {
      const t = circleLike ? u * G.TAU : lo + (hi - lo) * u;
      const p = pathDef?.k === 'pcurve' ? evalPcurvePoint(pathDef, get, page, t) : pathPointAt(path, t, continuous);
      driverValue = p ? OK({ k: 'pt', p }) : UNDEF;
    }
    if (driverValue.status !== 'ok') return undefined;
    const values: Results = get === topGet ? new Map(results) : new Map();
    for (const x of chain) values.delete(x.id);
    values.set(d.driver, driverValue);
    const active = new Set<Id>();
    const probeGet: Get = id => {
      const cached = values.get(id); if (cached) return cached;
      if (get !== topGet && !driven.has(id)) { const r = get(id); values.set(id, r); return r; }
      const obj = byId(page, id); if (!obj) return MISSING;
      if (active.has(id)) return UNDEF;
      active.add(id);
      const image = obj.def.k === 'iterpt' ? byId(page, obj.def.img) : undefined;
      const r = image?.def.k === 'iterimg' && driven.has(image.id) && !values.has(image.id) && !ctx.posOverride?.has(image.id)
        ? lastPoint(image.def, probeGet, values)
        : sampledLocusEndpoint(obj, driven, probeGet, values, page, ctx) ?? evalObject(obj, probeGet, page, ctx, values);
      active.delete(id); values.set(id, r); return r;
    };
    const result = probeGet(d.out), shape = result.shape;
    return isPt(shape) && G.finite(shape.p) ? { p: shape.p, color: result.color } : undefined;
  };
  // 原版即使只存少量样本，也会把有定义的轨迹延伸到无定义区间的边界。
  // 对相邻的“有效/无定义”样本做二分，避免相切处出现明显缺口。
  let boundaryBudget = 64;
  for (let k = 0; k < paths.length && boundaryBudget; k++) {
    const path = paths[k], at = positions[k], c = colors[k];
    if (!path.length) continue;
    for (const start of [true, false]) {
      const end = start ? 0 : at.length - 1, inside = at[end];
      let outside = (Math.round(inside * total) + (start ? -1 : 1)) / total;
      if (outside < 0 || outside > 1 || probe(outside)) continue;
      boundaryBudget--;
      let valid = inside;
      for (let depth = 0; depth < 8; depth++) {
        const middle = (valid + outside) / 2, sample = probe(middle);
        if (!sample) { outside = middle; continue; }
        valid = middle;
        if (start) { path.unshift(sample.p); at.unshift(middle); c.unshift(sample.color); }
        else { path.push(sample.p); at.push(middle); c.push(sample.color); }
      }
      if (!boundaryBudget) break;
    }
  }
  for (let k = paths.length - 1; k >= 0; k--) {
    const path = paths[k], at = positions[k], c = colors[k], cuts: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const gap = axisDistance(path[i - 1], path[i]);
      const before = i > 1 ? axisDistance(path[i - 2], path[i - 1]) : 0, after = i + 1 < path.length ? axisDistance(path[i], path[i + 1]) : 0;
      if (gap <= 26 || gap <= 3 * Math.max(before, after)) continue;
      let a = path[i - 1], b = path[i], ua = at[i - 1], ub = at[i], broken = false;
      for (let depth = 0; depth < 8; depth++) {
        const um = (ua + ub) / 2, m = probe(um)?.p;
        if (!m) { broken = true; break; }
        const left = axisDistance(a, m), right = axisDistance(m, b);
        if (Math.max(left, right) <= 26) break;
        if (left >= right) { b = m; ub = um; } else { a = m; ua = um; }
        if (depth === 7) broken = true;
      }
      if (broken) cuts.push(i);
    }
    for (let j = cuts.length - 1; j >= 0; j--) {
      const i = cuts[j];
      paths.splice(k + 1, 0, path.splice(i));
      colors.splice(k + 1, 0, c.splice(i));
    }
  }
  return paths.some(p => p.length > 1) ? OK({ k: 'paths', paths, ...(colors.some(p => p.some(Boolean)) ? { colors } : {}) }) : UNDEF;
}
/** 直线参数（a→b 为 0→1）在视图外扩半个视图的矩形内的范围。 */
function viewParamRange(s: Straight, v: NonNullable<EvalCtx['view']>): [number, number] | undefined {
  const mx = (v.x1 - v.x0) / 2, my = (v.y1 - v.y0) / 2, r = { x0: v.x0 - mx, y0: v.y0 - my, x1: v.x1 + mx, y1: v.y1 + my };
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, q] of [[-dx, s.a.x - r.x0], [dx, r.x1 - s.a.x], [-dy, s.a.y - r.y0], [dy, r.y1 - s.a.y]] as const) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return undefined; continue; }
    const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  return Number.isFinite(t0) && Number.isFinite(t1) && t0 < t1 ? [t0, t1] : undefined;
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
  const value = functionValue(get, page, d.func);
  if (form === 'x=f(y)') {
    const m = Math.max(200, Math.min(4000, d.samples));
    const lo = d.lo ?? Math.min(...ys), hi = d.hi ?? Math.max(...ys);
    return OK({ k: 'paths', paths: sampleFunction(value, lo, hi, m, (y, x) => fromSys(sysShape, x, y), [Math.min(...xs), Math.max(...xs)]) });
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
  const paths = sampleFunction(value, lo, hi, n, (x, y) => fromSys(sysShape, x, y), [Math.min(...ys), Math.max(...ys)]);
  return OK({ k: 'paths', paths });
}

function evalPcurvePoint(d: Extract<Def, { k: 'pcurve' }>, get: Get, page: Page, u: number): Pt | undefined {
  const sys = sh(get, d.sys);
  if (sys?.k !== 'sys') return undefined;
  const t = d.lo + (d.hi - d.lo) * Math.min(1, Math.max(0, u));
  const a = callFunc(get, page, d.fx, q(t)), b = callFunc(get, page, d.fy, q(t));
  if (!a || !b || !Number.isFinite(a.v) || !Number.isFinite(b.v)) return undefined;
  if (!d.polar) return fromSys(sys, a.v, b.v);
  const ang = b.u === 'angle' ? b.v * Math.PI / 180 : b.v;
  return fromSys(sys, a.v * Math.cos(ang), a.v * Math.sin(ang));
}

function evalPcurve(d: Extract<Def, { k: 'pcurve' }>, get: Get, page: Page): Result {
  const sys = sh(get, d.sys);
  if (sys?.k !== 'sys' || get(d.fx).status !== 'ok' || get(d.fy).status !== 'ok') return UNDEF;
  const n = Math.max(2, Math.min(5000, d.samples)), paths: Pt[][] = [], parameters: number[][] = [];
  let cur: Pt[] = [], params: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, point = evalPcurvePoint(d, get, page, u);
    if (!point) {
      if (cur.length > 1) { paths.push(cur); parameters.push(params); }
      cur = []; params = []; continue;
    }
    cur.push(point); params.push(u);
  }
  if (cur.length > 1) { paths.push(cur); parameters.push(params); }
  return paths.length ? OK({ k: 'paths', paths, parameters }) : UNDEF;
}

const measureNum = (v: number | undefined, u: Q['u'] = 'none'): Result => (v === undefined || !Number.isFinite(v) ? UNDEF : OK({ k: 'num', q: q(v, u) }));
const measureCm = (px: number) => px / CM;
function evalMeasure(d: Extract<Def, { k: 'measure' }>, get: Get, page: Page, angleUnit: EvalCtx['angleUnit'] = 'deg'): Result {
  const num = measureNum, cm = measureCm;
  const [r0, r1, r2] = d.refs;
  switch (d.m) {
    case 'length': { const s = straightOf(get, r0); return num(s && cm(G.dist(s.a, s.b)), 'distance'); }
    case 'distance': {
      const a = pointOf(get, r0); if (!a) return UNDEF;
      const b = pointOf(get, r1);
      if (b) return num(cm(G.dist(a, b)), 'distance');
      const l = straightOf(get, r1); return num(l && cm(G.dist(a, G.pointAt(l, G.projectParam({ ...l, ext: 'line' }, a) ?? 0))), 'distance');
    }
    case 'perimeter': { const s = sh(get, r0); return s?.k === 'poly' ? num(cm(G.polygonPerimeter(s.pts)), 'distance') : s?.k === 'disk' ? num(cm(G.TAU * s.r), 'distance') : s?.k === 'sector' ? num(cm(s.r * (2 + Math.abs(s.sweep))), 'distance') : UNDEF; }
    case 'circumference': { const c = circleOf(get, r0); return num(c && cm(G.TAU * c.r), 'distance'); }
    case 'angle': {
      const a = pointOf(get, r0), v = pointOf(get, r1), b = pointOf(get, r2);
      const deg = a && v && b ? angleMeasure(a, v, b) : undefined;
      if (deg === undefined) return UNDEF;
      const signed = deg > 180 ? deg - 360 : deg;
      return num(angleUnit === 'deg' ? Math.abs(signed) : signed, 'angle');
    }
    case 'markedangle': {
      const mark = byId(page, r0)?.def;
      const deg = mark?.k === 'angle-mark' ? markedSweep(mark, get) : undefined;
      return num(deg === undefined || angleUnit !== 'deg' ? deg : Math.abs(deg), 'angle');
    }
    case 'area': {
      const s = sh(get, r0);
      if (s?.k === 'poly') return num(G.polygonArea(s.pts) / (CM * CM), 'none');
      if (s?.k === 'disk') return num((Math.PI * s.r * s.r) / (CM * CM));
      if (s?.k === 'circle') return num((Math.PI * s.c.r * s.c.r) / (CM * CM));
      if (s?.k === 'sector') { const sweep = Math.abs(s.sweep); return num((s.r * s.r * (s.segment ? sweep - Math.sin(sweep) : sweep)) / 2 / (CM * CM)); }
      return UNDEF;
    }
    case 'arcangle': case 'arclength': {
      let sweepA: number | undefined, r: number | undefined;
      if (d.refs.length === 3) { const c = circleOf(get, r0), a = pointOf(get, r1), b = pointOf(get, r2); if (c && a && b) { sweepA = G.sweep(G.angleOf(c.c, a), G.angleOf(c.c, b)); r = c.r; } }
      else { const s = sh(get, r0); if (s?.k === 'arc') { sweepA = Math.abs(s.sweep); r = s.r; } }
      if (sweepA === undefined || r === undefined) return UNDEF;
      return d.m === 'arcangle' ? num((sweepA * 180) / Math.PI, 'angle') : num(cm(r * sweepA), 'distance');
    }
    case 'radius': { const c = circleOf(get, r0); return num(c && cm(c.r), 'distance'); }
    case 'ratio': {
      // 三点：AC 在 AB 方向上的有向比。原版 example-36.gsp 用 O、单位点、x 轴上的点之比画正态曲线，原版左右两半对称，
      // 说明点在 O 左侧时比为负。
      if (d.refs.length === 3) return num(signedRatio(pointOf(get, r0), pointOf(get, r1), pointOf(get, r2)));
      const a = straightOf(get, r0), b = straightOf(get, r1); const lb = b && G.dist(b.a, b.b); return num(a && lb ? G.dist(a.a, a.b) / lb : undefined); }
    case 'pointvalue': {
      const p = pointOf(get, r0); const path = sh(get, r1); if (!p || !path) return UNDEF;
      const pr = projectToPath(path, p);
      if (!pr) {
        // 路径退化（如长度为 0 的线段）时，路径上的点仍取它自己的路径参数（圆柱 圆锥 圆台的形成.gsp 的圆锥面）
        const own = byId(page, r0)?.def;
        return own?.k === 'onpath' && own.path === r1 && own.edge === undefined && !own.abs && path.k !== 'circle' && Number.isFinite(own.t) ? num(own.t) : UNDEF;
      }
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
      // 原点处的极角按 0 计（等高线试验.gsp 等的原版画面里依赖它的数值都有定义）。
      return d.m === 'coordradius' ? num(Math.hypot(c.x, c.y)) : num(Math.hypot(c.x, c.y) < G.EPS ? 0 : (Math.atan2(c.y, c.x) * 180 / Math.PI + 360) % 360, 'angle');
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
