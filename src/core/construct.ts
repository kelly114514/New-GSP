/** 构造与变换：把选择转成新对象。所有函数须在 store.run 事务内调用。 */
import { isCirc, isLine, isPt, pathPointAt, pathUsesPixelDistance, polygonEdgeAt, projectOnPath, viewParamRange, type Shape } from './engine';
import * as G from './geom';
import type { Pt } from './geom';
import { CM } from './expr';
import { remapDef } from './remap';
import { byId, isArcDef, isCircleDef, isInteriorDef, isMeasureDef, isPathDef, isPointDef, isStraightDef, parentsOf, ancestors, descendants, type AngleBy, type Def, type Id, type Obj, type Page, type RatioBy, type TranslateBy } from './model';
import { imagePixelSize } from './image';
import { defaultWarpSamples } from './warp';
import type { Store } from './store';

export type ObjClass = 'point' | 'straight' | 'circle' | 'arc' | 'interior' | 'locus' | 'plot' | 'measure' | 'table' | 'sys' | 'text' | 'button' | 'image' | 'stroke' | 'func' | 'unknown';

export function classOf(o: Obj): ObjClass {
  const d = o.def;
  if (isPointDef(d)) return 'point';
  if (isStraightDef(d)) return 'straight';
  if (isCircleDef(d)) return 'circle';
  if (isArcDef(d)) return 'arc';
  if (isInteriorDef(d)) return 'interior';
  if (d.k === 'locus') return 'locus';
  if (d.k === 'plot' || d.k === 'pcurve') return 'plot';
  if (isMeasureDef(d)) return 'measure';
  if (d.k === 'table' || d.k === 'itertable') return 'table';
  if (d.k === 'sys') return 'sys';
  if (d.k === 'text') return 'text';
  if (d.k === 'button') return 'button';
  if (d.k === 'image' || d.k === 'image-clip' || d.k === 'custom-image') return 'image';
  if (d.k === 'stroke' || d.k === 'segment-mark' || d.k === 'angle-mark') return 'stroke';
  if (d.k === 'func' || d.k === 'picfunc') return 'func';
  return 'unknown';
}

export interface Marks {
  center?: Id; mirror?: Id; vector?: [Id, Id]; angle?: [Id, Id, Id] | { m: Id }; distance?: Id; ratio?: { segs: [Id, Id] } | { m: Id } | { pts: [Id, Id, Id] };
  rectDistances?: [Id, Id];
  translationMode?: TranslateBy['mode'];
}

const shape = (st: Store, id: Id): Shape | undefined => st.results.get(id)?.shape;
export const ptOf = (st: Store, id: Id): Pt | undefined => { const s = shape(st, id); return isPt(s) ? s.p : undefined; };

type ReusableConstruction = Extract<Def, { k: 'seg' | 'ray' | 'line' | 'mid' | 'parallel' | 'perp' | 'circle' | 'circle-seg' | 'arc-circle' | 'arc3' }>;

/** 按父对象复用原版构造；线段和直线接受反向的两点顺序。 */
export function constructOnce(st: Store, def: ReusableConstruction, recompute = true): Obj {
  const refs = parentsOf(def), unordered = def.k === 'seg' || def.k === 'line';
  const existing = st.page.objects.find(o => {
    if (o.def.k !== def.k) return false;
    const other = parentsOf(o.def);
    return other.every((id, i) => id === refs[i]) || unordered && other[0] === refs[1] && other[1] === refs[0];
  });
  return existing ?? st.add(def, {}, recompute);
}

export function addSegmentLike(st: Store, kind: 'seg' | 'ray' | 'line', a: Id, b: Id): Obj {
  return constructOnce(st, { k: kind, a, b });
}

/** 选中 ≥2 个点：2 个点连一条，3 个以上首尾相接成闭合链。返回涉及的对象。 */
export function constructLines(st: Store, kind: 'seg' | 'ray' | 'line', points: Id[]): Obj[] {
  const out: Obj[] = [];
  const n = points.length;
  const pairs: [Id, Id][] = [];
  for (let i = 0; i + 1 < n; i++) pairs.push([points[i], points[i + 1]]);
  if (n >= 3) pairs.push([points[n - 1], points[0]]);
  for (const [a, b] of pairs) out.push(addSegmentLike(st, kind, a, b));
  return out;
}

export function constructMidpoints(st: Store, segs: Id[]): Obj[] { return segs.map(s => constructOnce(st, { k: 'mid', seg: s })); }

function pointsOnDefiningPath(def: Def | undefined): Id[] {
  switch (def?.k) {
    case 'seg': case 'ray': case 'line': return [def.a, def.b];
    case 'parallel': case 'perp': return [def.pt];
    case 'bisect': return [def.v];
    case 'circle': return [def.p];
    case 'arc3': return [def.a, def.b, def.c];
    default: return [];
  }
}

/** 两个路径当前所有交点（按分支顺序），含可直接复用的共用点。 */
export function constructIntersections(st: Store, a: Id, b: Id): Obj[] {
  const secondPoints = pointsOnDefiningPath(st.get(b)?.def);
  const shared = pointsOnDefiningPath(st.get(a)?.def).filter(id => secondPoints.includes(id));
  const unique = isLine(shape(st, a)) && isLine(shape(st, b));
  const out: Obj[] = [];
  const samePoint = (p: Pt, q: Pt | undefined) => p.x === q?.x && p.y === q?.y;
  for (let branch = 0; branch < 2; branch++) {
    const existing = st.page.objects.find(o => {
      const d = o.def;
      return d.k === 'inter' && d.branch === branch && !d.alternate &&
        (d.a === a && d.b === b || unique && d.a === b && d.b === a);
    });
    const first = out.length ? ptOf(st, out[0].id) : undefined;
    const known = existing && ptOf(st, existing.id);
    if (known && !samePoint(known, first)) {
      out.push(existing);
      continue;
    }
    const probe = st.add({ k: 'inter', a, b, branch });
    const p = ptOf(st, probe.id);
    const duplicate = p && samePoint(p, first);
    const reusedId = p && shared.find(id => { const q = ptOf(st, id); return q && G.dist(p, q) <= G.EPS; });
    if (p && !duplicate && reusedId === undefined) out.push(probe);
    else {
      st.page.objects.pop();
      st.page.nextId--;
      st.recompute();
      if (reusedId !== undefined && !duplicate) out.push(st.get(reusedId)!);
    }
  }
  return out;
}

export function intersectionCount(st: Store, a: Id, b: Id): number {
  let n = 0;
  const sa = shape(st, a), sb = shape(st, b);
  if (!sa || !sb) return 0;
  const asS = (s: Shape) => (isLine(s) ? s.s : undefined), asC = (s: Shape): G.Circ | undefined => (isCirc(s) ? s.c : s.k === 'arc' ? { c: s.c, r: s.r } : undefined);
  const x = asS(sa), y = asS(sb), c = asC(sa), d = asC(sb);
  if (x && y) n = G.intersectStraights(x, y) ? 1 : 0;
  else if (x && d) n = G.intersectStraightCircle(x, d).length;
  else if (y && c) n = G.intersectStraightCircle(y, c).length;
  else if (c && d) n = G.intersectCircles(c, d).length;
  return n;
}

export function constructParallelPerp(st: Store, kind: 'parallel' | 'perp', pt: Id, line: Id): Obj { return constructOnce(st, { k: kind, pt, line }); }
export function constructBisector(st: Store, a: Id, v: Id, b: Id): Obj { return st.add({ k: 'bisect', a, v, b }); }

/** “对象上的点”在路径上随机取点，工具单击沿用指针投影。 */
export function constructPointOnPath(st: Store, pathId: Id, at?: Pt): Obj | undefined {
  const path = shape(st, pathId);
  if (!path) return undefined;
  let t: number, abs = false;
  if (at) {
    const pr = projectOnPath(st.page, st.results, pathId, at);
    if (!pr) return undefined;
    if (pr.side) return st.add({ k: 'onpath', path: pathId, t: pr.side.t, edge: pr.side.edge });
    t = pr.t; abs = !!pr.abs;
  }
  else {
    const pos = Math.random();
    t = path.k === 'circle' || path.k === 'disk' ? pos * G.TAU : pos;
    if (path.k === 'line' && path.s.ext !== 'segment' && st.ctx.view) {
      const range = viewParamRange(path.s, st.ctx.view, 0);
      if (range) {
        const lo = path.s.ext === 'ray' ? Math.max(0, range[0]) : range[0];
        if (range[1] > lo) t = lo + (range[1] - lo) * pos;
      }
    }
  }
  if (path.k === 'poly') {
    const side = polygonEdgeAt(path.pts, t);
    return st.add({ k: 'onpath', path: pathId, t: side.t, edge: side.edge });
  }
  if (path.k === 'line' && path.s.ext === 'segment') t = Math.min(0.999, Math.max(0.001, t));
  if (!at && path.k === 'line' && pathUsesPixelDistance(st.page, pathId)) { t *= G.dist(path.s.a, path.s.b); abs = true; }
  return st.add({ k: 'onpath', path: pathId, t, ...(abs ? { abs: true } : {}) });
}

/** 圆上的弧：两个点必须在圆周上（或依附于圆）。 */
export function constructArcOnCircle(st: Store, circle: Id, a: Id, b: Id): Obj { return constructOnce(st, { k: 'arc-circle', circle, a, b }); }

export function constructInterior(st: Store, sel: Obj[]): Obj[] {
  const points = sel.filter(o => classOf(o) === 'point');
  if (points.length >= 3 && points.length === sel.length) return [st.add({ k: 'poly', pts: points.map(p => p.id) })];
  return sel.filter(o => o.def.k === 'circle' || o.def.k === 'circle-seg' || o.def.k === 'arc-circle' || o.def.k === 'arc3').map(o => {
    if (isCircleDef(o.def)) return st.add({ k: 'circle-int', circle: o.id });
    return st.add({ k: 'arc-int', arc: o.id, mode: 'sector' });
  });
}

// ---------------- 变换 ----------------
export interface TransformSpec {
  point(st: Store, src: Id): Obj;
}

/** 追踪图片及其内置变换，保留暂时无定义的图片类型。 */
function isPicture(page: Page, id: Id): boolean {
  const seen = new Set<Id>();
  while (!seen.has(id)) {
    seen.add(id);
    const d = byId(page, id)?.def;
    if (!d) return false;
    if (d.k === 'image' || d.k === 'image-clip' || d.k === 'custom-image') return true;
    if (d.k !== 'translate' && d.k !== 'rotate' && d.k !== 'dilate' && d.k !== 'reflect') return false;
    id = d.src;
  }
  return false;
}

/** 对一组对象做变换：点直接变换，线/圆/多边形先变换其定义点再按原类型重建。 */
export function transformObjects(st: Store, ids: Id[], mk: (src: Id) => Def | Id, builtIn = false): Obj[] {
  const memo = new Map<Id, Id>(), created: Obj[] = [];
  const imgPoint = (id: Id): Id => {
    const m = memo.get(id); if (m !== undefined) return m;
    const o = byId(st.page, id)!;
    const r = mk(id);
    const n = typeof r === 'number' ? byId(st.page, r)! : st.add(r, { style: { ...o.style }, hidden: false });   // 数字：已经建好的象
    memo.set(id, n.id); created.push(n);
    return n.id;
  };
  const image = (id: Id): Id | undefined => {
    const m = memo.get(id); if (m !== undefined) return m;
    const o = byId(st.page, id); if (!o) return undefined;
    const d = o.def;
    let nd: Def | undefined;
    if (isPicture(st.page, id)) return imgPoint(id);
    if (builtIn && (d.k === 'arc-center' || d.k === 'arc-int' || d.k === 'bisect' || d.k === 'parallel' || d.k === 'perp')) return imgPoint(id);
    if (isPointDef(d)) return imgPoint(id);
    if (d.k === 'seg' || d.k === 'ray' || d.k === 'line') nd = { k: d.k, a: imgPoint(d.a), b: imgPoint(d.b) };
    else if (d.k === 'circle') nd = { k: 'circle', c: imgPoint(d.c), p: imgPoint(d.p) };
    else if (d.k === 'poly') nd = { k: 'poly', pts: d.pts.map(imgPoint) };
    else if (d.k === 'arc3') nd = { k: 'arc3', a: imgPoint(d.a), b: imgPoint(d.b), c: imgPoint(d.c) };
    else if (d.k === 'circle-int') { const c = image(d.circle); nd = c === undefined ? undefined : { k: 'circle-int', circle: c }; }
    else if (d.k === 'arc-circle') { const c = image(d.circle); nd = c === undefined ? undefined : { k: 'arc-circle', circle: c, a: imgPoint(d.a), b: imgPoint(d.b) }; }
    else if (d.k === 'parallel' || d.k === 'perp') nd = { k: 'seg', a: imgPoint(o.id), b: imgPoint(o.id) } as Def; // 不直接支持：落到下面的跳过
    if (!nd || (nd.k === 'seg' && (d.k === 'parallel' || d.k === 'perp'))) return undefined;
    const n = st.add(nd, { style: { ...o.style }, hidden: false });
    memo.set(id, n.id); created.push(n);
    return n.id;
  };
  for (const id of ids) image(id);
  return created;
}

/** 自定义变换要重放的那串构造：象点的祖先里依赖于原象点的部分（按创建顺序，含象点）。 */
/** 图片对象最初来源的像素尺寸（取样变换的默认采样数用）。 */
function picturePixels(p: Page, id: Id): { w: number; h: number } {
  for (let k = 0, cur = id; k < 64; k++) {
    const d = byId(p, cur)?.def;
    if (!d) break;
    if (d.k === 'image') return imagePixelSize(d.data, d.mime) ?? { w: d.w, h: d.h };
    if (d.k === 'image-clip' || d.k === 'custom-image' || d.k === 'translate' || d.k === 'rotate' || d.k === 'dilate' || d.k === 'reflect') cur = d.src; else break;
  }
  return { w: 0, h: 0 };
}

export function customChain(st: Store, tf: { src: Id; img: Id }): Obj[] | undefined {
  const p = st.page;
  if (!byId(p, tf.src) || !byId(p, tf.img)) return undefined;
  const fromSrc = descendants(p, [tf.src]), toImg = new Set<Id>([tf.img, ...ancestors(p, [tf.img])]);
  if (!fromSrc.has(tf.img)) return undefined;
  return p.objects.filter(o => fromSrc.has(o.id) && toImg.has(o.id));
}

/** 把自定义变换用到一批对象上（点直接重放；线、圆、多边形变换它们的定义点）。选中顺序里靠后的先做（原版采集：两个点同时应用时，后选的点先出象）。 */
export function applyCustomTransform(st: Store, tf: { src: Id; img: Id }, targets: Id[]): Obj[] {
  const chain = customChain(st, tf);
  if (!chain) throw new Error('这个自定义变换依赖的对象已经不存在');
  // 原版参考手册：两点之间只经过内置变换时，图片得到普通变换图片；否则得到取样变换的图片（方法 96）。
  const fromSrc = descendants(st.page, [tf.src]);
  let prev = tf.src;
  const builtIn = chain.every(c => {
    const d = c.def;
    if (d.k !== 'translate' && d.k !== 'rotate' && d.k !== 'dilate' && d.k !== 'reflect') return false;
    if (d.src !== prev || parentsOf(d).slice(1).some(x => x === tf.src || fromSrc.has(x))) return false;
    prev = c.id; return true;
  });
  return transformObjects(st, [...targets].reverse(), t => {
    if (!builtIn && isPicture(st.page, t)) {
      const px = picturePixels(st.page, t);
      return { k: 'custom-image', src: t, pre: tf.src, img: tf.img, body: chain.map(c => c.id), samples: defaultWarpSamples(px.w, px.h), distortion: 0.6 };
    }
    const map = new Map<Id, Id>([[tf.src, t]]);
    for (const c of chain) { const n = st.add(remapDef(structuredClone(c.def), map), { style: { ...c.style }, hidden: false }); map.set(c.id, n.id); }
    return map.get(tf.img)!;
  });
}

export function marksUsable(st: Store, m: Marks): { center: boolean; mirror: boolean; vector: boolean; angle: boolean; distance: boolean; ratio: boolean } {
  const has = (id?: Id) => id !== undefined && !!st.get(id);
  return {
    center: has(m.center), mirror: has(m.mirror), vector: !!m.vector && has(m.vector[0]) && has(m.vector[1]),
    angle: !!m.angle && (Array.isArray(m.angle) ? m.angle.every(has) : has(m.angle.m)), distance: has(m.distance), ratio: !!m.ratio && ('m' in m.ratio ? has(m.ratio.m) : 'pts' in m.ratio ? m.ratio.pts.every(has) : m.ratio.segs.every(has)),
  };
}

export function translateBy(st: Store, ids: Id[], by: TranslateBy) { return transformObjects(st, ids, src => ({ k: 'translate', src, by }), true); }
export function rotateBy(st: Store, ids: Id[], center: Id, angle: AngleBy) { return transformObjects(st, ids, src => ({ k: 'rotate', src, center, angle }), true); }
export function dilateBy(st: Store, ids: Id[], center: Id, ratio: RatioBy) { return transformObjects(st, ids, src => ({ k: 'dilate', src, center, ratio }), true); }
export function reflectBy(st: Store, ids: Id[], mirror: Id) { return transformObjects(st, ids, src => ({ k: 'reflect', src, mirror }), true); }

// ---------------- 坐标系与度量 ----------------
/** 页面上第一个坐标系；没有则返回 undefined。 */
export function findSys(st: Store): Obj | undefined { return st.page.objects.find(o => o.def.k === 'sys'); }

/** 建立默认坐标系（原点 + 两个单位点 + 两条轴），位置取页面中心附近。 */
export function createSystem(st: Store, origin?: Pt): Obj {
  const v = st.ctx.view ?? { x0: 0, y0: 0, x1: 800, y1: 600 };
  const o = origin ?? { x: Math.round((v.x0 + v.x1) / 2 / 8) * 8, y: Math.round((v.y0 + v.y1) / 2 / 8) * 8 };
  const org = st.add({ k: 'free', x: o.x, y: o.y }, { style: { color: '#ff0000', pointSize: 2, width: 2, dash: 'solid' } });
  const ux = st.add({ k: 'translate', src: org.id, by: { mode: 'rect', dx: 1, dy: 0 } });
  const uy = st.add({ k: 'translate', src: org.id, by: { mode: 'rect', dx: 0, dy: 1 } });
  uy.hidden = true;   // 方形网格：x、y 同一尺度，只露出原点和横轴单位点；矩形网格再露出纵轴单位点（见 setGridStyle）
  const ax = st.add({ k: 'line', a: org.id, b: ux.id }, { style: { color: '#606060', pointSize: 1, width: 1, dash: 'solid' } });
  const ay = st.add({ k: 'line', a: org.id, b: uy.id }, { style: { color: '#606060', pointSize: 1, width: 1, dash: 'solid' } });
  return st.add({ k: 'sys', origin: org.id, unitX: ux.id, unitY: uy.id, axisX: ax.id, axisY: ay.id, grid: 'square', showGrid: true, snap: false }, { style: { color: '#c0c0c0', pointSize: 1, width: 1, dash: 'solid' } });
}

/** 切换网格样式：矩形和三角网格的两个方向各有单位点；方形和极坐标只有一个尺度，纵向单位跟随横向。 */
export function setGridStyle(st: Store, sys: Obj, grid: 'square' | 'rect' | 'polar' | 'tri') {
  if (sys.def.k !== 'sys') return;
  const uy = st.get(sys.def.unitY), ux = st.get(sys.def.unitX), two = grid === 'rect' || grid === 'tri';
  st.update(sys.id, { ...sys.def, grid, showGrid: true });
  if (uy) uy.hidden = !two;
  if (!two && ux?.def.k === 'translate' && ux.def.by.mode === 'rect' && uy?.def.k === 'translate' && uy.def.by.mode === 'rect') st.update(uy.id, { ...uy.def, by: { ...uy.def.by, dy: ux.def.by.dx, dyPx: ux.def.by.dxPx } });
}

/** 坐标系的单位点拖动：沿所在坐标轴改变单位长度。返回 false 表示这个点不是可拖的单位点。 */
export function dragSysUnit(st: Store, sys: Obj, unit: Id, p: Pt): boolean {
  if (sys.def.k !== 'sys') return false;
  const d = sys.def, org = ptOf(st, d.origin), ux = st.get(d.unitX), uy = st.get(d.unitY);
  if (!org || ux?.def.k !== 'translate' || uy?.def.k !== 'translate' || ux.def.by.mode !== 'rect' || uy.def.by.mode !== 'rect') return false;
  const MIN = 0.05, two = d.grid === 'rect' || d.grid === 'tri';
  if (unit === d.unitX) {
    const dx = Math.max(MIN, (p.x - org.x) / CM);
    st.update(ux.id, { ...ux.def, by: { ...ux.def.by, dx, dxPx: undefined } });
    if (!two) st.update(uy.id, { ...uy.def, by: { ...uy.def.by, dy: dx, dyPx: undefined } });
    return true;
  }
  if (unit === d.unitY) {
    const dy = Math.max(MIN, (org.y - p.y) / CM);
    st.update(uy.id, { ...uy.def, by: { ...uy.def.by, dy, dyPx: undefined } });
    if (!two) st.update(ux.id, { ...ux.def, by: { ...ux.def.by, dx: dy, dxPx: undefined } });
    return true;
  }
  return false;
}

/** 度量时给被度量的对象显示标签（参数选项“应用于度量过的对象”）：点直接显示，其它对象显示定义它的点。 */
export function labelMeasured(st: Store, refs: Id[]) {
  const seen = new Set<Id>();
  const show = (id: Id) => { if (seen.has(id)) return; seen.add(id); const o = st.get(id); if (o && classOf(o) === 'point') st.showLabel(id, true); };
  for (const id of refs) {
    const o = st.get(id); if (!o) continue;
    if (classOf(o) === 'point') show(id);
    else if (classOf(o) !== 'sys') for (const p of parentsOf(o.def)) show(p);
  }
}

/** 轨迹：驱动点（路径上的点）与它的依赖点。 */
export function constructLocus(st: Store, driver: Id, out: Id): Obj { return st.add({ k: 'locus', driver, out, samples: 200 }); }

export { pathPointAt, isPathDef };
