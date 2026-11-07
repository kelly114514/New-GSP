/** Canvas 绘制：文档图形层。预览与追踪在各自的画布上，不经过这里。 */
import { classOf } from '../core/construct';
import { boxOf, type Rect } from '../core/hit';
import { display as numDisplay, formatPlain, formatQ, exprToText } from '../core/expr';
import { functionExpression, type Results, type Shape } from '../core/engine';
import { TEXT_DEFAULTS, type DisplayPrefs, type Id, type Obj, type Page, type TextCat } from '../core/model';
import { byId, parentsOf } from '../core/model';
import { TAU } from '../core/geom';
import type { Pt } from '../core/geom';

export const POINT_RADIUS = [2.5, 3.5, 4.5, 6.5];
export const LINE_WIDTH = [1, 2, 3, 5];
let SEL_POINT = '#d000d0', SEL_LINE = 'rgba(224,112,224,0.55)';
const FONT_SANS = "16px Tahoma,'Microsoft YaHei','Segoe UI',sans-serif";   // 原版度量值文字约 16 逻辑像素的 Tahoma（150% 缩放下与原版逐像素对照得出）
let FONT_LABEL = "italic bold 16px 'Times New Roman',serif";

/** 把一个文档的显示设置用到绘制和数值格式上（每次绘制前调用）。 */
export function applyDisplay(d: DisplayPrefs) {
  Object.assign(numDisplay, { angleUnit: d.angleUnit, anglePrec: d.anglePrec, distUnit: d.distUnit, distPrec: d.distPrec, otherPrec: d.otherPrec });
  SEL_POINT = d.selected;
  const n = parseInt(d.selected.slice(1), 16);
  SEL_LINE = `rgba(${Math.min(255, (n >> 16) + 60)},${Math.min(255, ((n >> 8) & 255) + 60)},${Math.min(255, (n & 255) + 60)},0.55)`;
  FONT_LABEL = `${d.mathItalic ? 'italic ' : ''}bold 16px 'Times New Roman',serif`;
  TS = d.textStyles ?? {}; MATH_ITALIC = d.mathItalic;
}

let TS: NonNullable<DisplayPrefs['textStyles']> = {};
let MATH_ITALIC = true;
/** 某类文字实际用的字体：没有改过样式就用原来的写法；改过的项叠加在出厂样式上，大小按比例缩放。 */
function catFont(cat: TextCat, _base: string, bold = false, italic = false): string {
  // 字号：文件样式表里的数值就是逻辑像素（逐工具截图对照）；坐标轴数字按已对照的比例。
  const o = TS[cat] ?? {}, def = TEXT_DEFAULTS[cat], px = Math.round(def.px * ((o.size ?? def.style.size) / def.style.size) * 10) / 10;
  const name = o.name ?? def.style.name, wantBold = o.bold ?? (bold || def.style.bold), wantItalic = o.italic ?? italic;
  return `${wantItalic ? 'italic ' : ''}${wantBold ? 'bold ' : ''}${px}px '${name}','SimSun','Microsoft YaHei',sans-serif`;
}
const catColor = (cat: TextCat, dflt: string) => TS[cat]?.color ?? dflt;
/** 样式带下划线时补画一条线。 */
function underlineIf(ctx: CanvasRenderingContext2D, cat: TextCat, text: string, x: number, y: number, h = 16) {
  if (!TS[cat]?.underline) return;
  const w = ctx.measureText(text).width, x0 = ctx.textAlign === 'center' ? x - w / 2 : x;
  ctx.fillRect(x0, y + h, w, 1);
}

export interface DrawOpts {
  selection: Set<Id>;
  highlight?: Id[];                 // 悬停/作图时高亮的对象
  hideHidden: boolean;
  /** 文本编辑中的对象不画。 */
  skip?: Set<Id>;
  showGrid?: boolean;
  view: Rect;
}

function dashFor(o: Obj): number[] {
  const w = LINE_WIDTH[o.style.width] ?? 2;
  return o.style.dash === 'dash' ? [w * 4 + 2, w * 3 + 2] : o.style.dash === 'dot' ? [w, w * 2 + 1] : [];
}

/** 函数表达式左边的写法：f(x)、y、x、r、θ。 */
export function funcHead(d: { name: string; param: string; form?: string; symbol?: boolean }): string {
  if (d.form === 'x=f(y)') return d.symbol ? 'x' : `${d.name}(y)`;
  if (d.form === 'r=f(t)') return d.symbol ? 'r' : `${d.name}(θ)`;
  if (d.form === 't=f(r)') return d.symbol ? 'θ' : `${d.name}(r)`;
  return d.symbol ? 'y' : `${d.name}(${d.param || 'x'})`;
}

export function measureName(page: Page, _results: Results, o: Obj): string {
  return measureNameInner(page, _results, o, { remaining: 128, active: new Set() });
}
function measureNameInner(page: Page, _results: Results, o: Obj, state: { remaining: number; active: Set<Id> }): string {
  if (o.label) return o.label;
  const d = o.def;
  const nm = (id: Id) => { const p = byId(page, id); return p?.label ?? (p ? defaultName(p) : '?'); };
  if (d.k === 'param') return d.name;
  if (d.k === 'func') return funcHead(d);
  if (d.k === 'calc') {
    if (state.remaining-- <= 0 || state.active.has(o.id)) return `计算${o.id}`;
    state.active.add(o.id);
    const text = exprToText(functionExpression(page, o.id) ?? d.expr, id => { const p = byId(page, id); return !p ? '?' : p.def.k === 'param' ? p.def.name : p.def.k === 'func' ? p.def.name : measureNameInner(page, _results, p, state); });
    state.active.delete(o.id);
    return text.length > 512 ? text.slice(0, 511) + '…' : text;
  }
  if (d.k !== 'measure') return '';
  const r = d.refs;
  switch (d.m) {
    case 'length': { const s = byId(page, r[0]); const dd = s?.def; return dd && 'a' in dd && 'b' in dd ? `${nm(dd.a as Id)}${nm(dd.b as Id)}` : `m${nm(r[0])}`; }
    case 'distance': {
      if (r.length !== 2) return '距离';
      const a = byId(page, r[0]), b = byId(page, r[1]);
      return a?.label && b?.label && classOf(b) === 'point' ? `${a.label}${b.label}` : `${nm(r[0])}到${nm(r[1])}的距离`;
    }
    case 'angle': return `∠${nm(r[0])}${nm(r[1])}${nm(r[2])}`;
    case 'perimeter': return `${nm(r[0])}的周长`;
    case 'circumference': return `${nm(r[0])}的周长`;
    case 'area': return `${nm(r[0])}的面积`;
    case 'arcangle': return `m${nm(r[0])}`;
    case 'arclength': return `${nm(r[0])}的弧长`;
    case 'radius': return `${nm(r[0])}的半径`;
    case 'ratio': return `${nm(r[0])}/${nm(r[1])}`;
    case 'pointvalue': return `${nm(r[0])}的值`;
    case 'abscissa': return `x${nm(r[0])}`;
    case 'ordinate': return `y${nm(r[0])}`;
    case 'coords': return nm(r[0]);
    case 'coorddist': return `${nm(r[0])}${nm(r[1])}`;
    case 'coordradius': return `r${nm(r[0])}`;
    case 'coordangle': return `θ${nm(r[0])}`;
    case 'slope': return `m${nm(r[0])}`;
    case 'equation': {   // 原版：过 A、B 的直线叫 AB，圆心 A、圆上点 B 的圆也叫 AB；自己有标签时用标签
      const pth = byId(page, r[0]), pd = pth?.def;
      if (pth?.label) return pth.label;
      if (pd && 'a' in pd && 'b' in pd) return `${nm(pd.a as Id)}${nm(pd.b as Id)}`;
      if (pd && 'c' in pd && 'p' in pd) return `${nm(pd.c as Id)}${nm(pd.p as Id)}`;
      return nm(r[0]);
    }
  }
}
export function defaultName(o: Obj): string {
  switch (classOf(o)) { case 'point': return '点'; case 'straight': return '线'; case 'circle': return '圆'; default: return '对象'; }
}

/** 文字型对象（度量、参数、计算、方程）要显示的整行文字。 */
export function valueText(page: Page, results: Results, o: Obj): string | undefined {
  if (o.def.k === 'picfunc') {   // 原版显示成“f(x): 绘图 [1]”
    const s = byId(page, o.def.stroke), strokes = page.objects.filter(x => x.def.k === 'stroke');
    return `${o.label ?? 'f'}(x): ${s ? typeName(s) : '?'} [${s ? strokes.indexOf(s) + 1 : '?'}]`;
  }
  if (o.def.k === 'func') {   // 函数在画板上显示成“f(x) = 表达式”
    const d = o.def, v = d.form === 'x=f(y)' ? 'y' : d.form === 'r=f(t)' ? 'θ' : d.form === 't=f(r)' ? 'r' : d.param || 'x';
    return `${funcHead(d)} = ${exprToText(functionExpression(page, o.id) ?? d.expr, id => { const p = byId(page, id); return !p ? '?' : p.def.k === 'param' || p.def.k === 'func' ? p.def.name : measureName(page, results, p); }, 0, v)}`;
  }
  const s = results.get(o.id)?.shape;
  const name = measureName(page, results, o);
  if (!s) return results.get(o.id)?.status === 'undefined' ? `${name} = 无定义` : undefined;
  if (s.k === 'num') return `${name} = ${formatQ(s.q, o.decimals)}`;
  if (s.k === 'coords') return `${name}: (${formatPlain(s.x)}, ${formatPlain(s.y)})`;
  if (s.k === 'text') return `${name}: ${s.text}`;
  return undefined;
}

let currentResults: Results = new Map();
let currentView: Rect = { x0: 0, y0: 0, x1: 1280, y1: 800 };
const inView = (p: Pt) => p.x >= currentView.x0 - 30 && p.x <= currentView.x1 + 30 && p.y >= currentView.y0 - 30 && p.y <= currentView.y1 + 30;
/** 对象显示用的颜色：按参数着色时随参数值变化。 */
export function colorOf(o: Obj): string {
  const computed = currentResults.get(o.id)?.color;
  if (computed) return computed;
  const cb = o.colorBy;
  if (!cb) return o.style.color;
  const v = (currentResults.get(cb.param)?.shape as { q?: { v: number } } | undefined)?.q?.v;
  if (v === undefined || cb.to === cb.from) return o.style.color;
  let u = (v - cb.from) / (cb.to - cb.from);
  if (cb.cycle === 'none') u = Math.min(1, Math.max(0, u));
  else if (cb.cycle === 'one') u = u - Math.floor(u);
  else { const w = ((u % 2) + 2) % 2; u = w <= 1 ? w : 2 - w; }
  if (cb.mode === 'gray') { const g = Math.round(u * 255); return `rgb(${g},${g},${g})`; }
  return `hsl(${Math.round(u * 300)},85%,45%)`;
}

/** 迭代象是一批图形，其它对象就是它自己。 */
export function flatShapes(s: Shape | undefined): Shape[] { return !s ? [] : s.k === 'multi' ? s.items : [s]; }

export function drawPage(ctx: CanvasRenderingContext2D, page: Page, results: Results, o: DrawOpts) {
  currentResults = results;
  currentView = o.view;
  const objs = page.objects.filter(x => !(x.hidden && o.hideHidden) && !o.skip?.has(x.id));
  const sel = o.selection;
  const hl = new Set(o.highlight ?? []);
  // 坐标系的网格最先画
  for (const x of objs) if (x.def.k === 'sys') drawSystem(ctx, x, results, o);
  for (const x of objs) for (const shape of flatShapes(results.get(x.id)?.shape)) if (shape.k === 'box' && shape.image) drawImage(ctx, x, shape, sel);
  // 区域填充
  for (const x of objs) {
    const shape = results.get(x.id)?.shape;
    flatShapes(shape).forEach((s, i) => {
      if (s.k === 'poly' || s.k === 'disk' || s.k === 'sector') drawRegion(ctx, x, s, sel.has(x.id) || hl.has(x.id), shape?.k === 'multi' ? shape.colors?.[i] : undefined);
    });
  }
  // 线、圆、弧、轨迹
  for (const x of objs) {
    if (x.def.k === 'sys') continue;
    const shape = results.get(x.id)?.shape;
    flatShapes(shape).forEach((s, i) => {
      if (s.k === 'line' || s.k === 'circle' || s.k === 'arc' || s.k === 'paths') strokeShape(ctx, x, s, sel.has(x.id), hl.has(x.id), shape?.k === 'multi' ? shape.colors?.[i] : undefined);
    });
  }
  // 点
  for (const x of objs) {
    // 迭代象里的点比原象小：原版不管原象的点型，一律画最小的点（对照 n 等分线段样本）
    const dot = x.def.k === 'iterimg' ? { ...x, style: { ...x.style, pointSize: 0 } } : x;
    for (const s of flatShapes(results.get(x.id)?.shape)) if (s.k === 'pt' && inView(s.p)) drawPoint(ctx, dot, s.p, sel.has(x.id), hl.has(x.id));
  }
  // 标签
  for (const x of objs) {
    if (!x.labelShown || !x.label) continue;
    const pos = labelAnchor(x, results.get(x.id)?.shape);
    if (pos && inView(pos)) drawLabel(ctx, x, pos);
  }
  // 文字型对象
  for (const x of objs) drawTextual(ctx, page, results, x, sel.has(x.id));
}

function drawSystem(ctx: CanvasRenderingContext2D, o: Obj, results: Results, opt: DrawOpts) {
  const s = results.get(o.id)?.shape;
  if (s?.k !== 'sys' || o.def.k !== 'sys') return;
  const { origin, ux, uy } = s, v = opt.view;
  const lx = Math.hypot(ux.x, ux.y), ly = Math.hypot(uy.x, uy.y);
  if (lx < 2 || ly < 2) return;
  ctx.save();
  ctx.lineWidth = 1;
  if (o.def.showGrid) {
    ctx.strokeStyle = '#c8c8c8';
    const grid = o.def.grid;
    if (grid === 'polar') {
      const far = Math.hypot(v.x1 - v.x0, v.y1 - v.y0) + Math.hypot(origin.x - v.x0, origin.y - v.y0);
      for (let r = lx; r < far; r += lx) { ctx.beginPath(); ctx.arc(origin.x, origin.y, r, 0, TAU); ctx.stroke(); }
      for (let k = 0; k < 12; k++) { ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(origin.x + far * Math.cos((k * TAU) / 12), origin.y - far * Math.sin((k * TAU) / 12)); ctx.stroke(); }
    } else {
      const gx = grid === 'rect' ? 1 : 1;
      const corners = [[v.x0, v.y0], [v.x1, v.y0], [v.x0, v.y1], [v.x1, v.y1]].map(([x, y]) => ({ x: x - origin.x, y: y - origin.y }));
      const det = ux.x * uy.y - ux.y * uy.x;
      const toU = (p: Pt) => ({ x: (p.x * uy.y - p.y * uy.x) / det, y: (ux.x * p.y - ux.y * p.x) / det });
      const cs = corners.map(toU), minx = Math.floor(Math.min(...cs.map(c => c.x))), maxx = Math.ceil(Math.max(...cs.map(c => c.x))), miny = Math.floor(Math.min(...cs.map(c => c.y))), maxy = Math.ceil(Math.max(...cs.map(c => c.y)));
      const lines = (maxx - minx) + (maxy - miny);
      if (lines < 600) {
        ctx.beginPath();
        for (let i = minx; i <= maxx; i += gx) { ctx.moveTo(origin.x + ux.x * i + uy.x * miny, origin.y + ux.y * i + uy.y * miny); ctx.lineTo(origin.x + ux.x * i + uy.x * maxy, origin.y + ux.y * i + uy.y * maxy); }
        for (let j = miny; j <= maxy; j++) { ctx.moveTo(origin.x + ux.x * minx + uy.x * j, origin.y + ux.y * minx + uy.y * j); ctx.lineTo(origin.x + ux.x * maxx + uy.x * j, origin.y + ux.y * maxx + uy.y * j); }
        ctx.stroke();
      }
    }
  }
  // 坐标轴与刻度
  ctx.strokeStyle = '#606060'; ctx.fillStyle = catColor('axis', '#404040'); ctx.font = catFont('axis', '11px sans-serif');
  const far = 4000, ex = { x: ux.x / lx, y: ux.y / lx }, ey = { x: uy.x / ly, y: uy.y / ly };
  ctx.beginPath();
  ctx.moveTo(origin.x - ex.x * far, origin.y - ex.y * far); ctx.lineTo(origin.x + ex.x * far, origin.y + ex.y * far);
  ctx.moveTo(origin.x - ey.x * far, origin.y - ey.y * far); ctx.lineTo(origin.x + ey.x * far, origin.y + ey.y * far);
  ctx.stroke();
  // 刻度：每个单位一个小刻度；标签的间隔按轴取（原版 150% 缩放实测：x 轴标签每 5 个单位、y 轴每 2 个单位，即横向要求的间隔比纵向大）
  const stepX = tickStep(lx, 100), stepY = tickStep(ly, 50), range = Math.ceil(far / Math.min(lx, ly));
  const minus = (n: number) => String(n).replace('-', '−');
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = -range; i <= range; i++) {
    if (i === 0) continue;
    const px = origin.x + ux.x * i, py = origin.y + ux.y * i;
    if (px < v.x0 - 20 || px > v.x1 + 20 || py < v.y0 - 20 || py > v.y1 + 20) continue;
    ctx.beginPath(); ctx.moveTo(px - ey.x * 3, py - ey.y * 3); ctx.lineTo(px + ey.x * 3, py + ey.y * 3); ctx.stroke();
    if (i % stepX === 0) ctx.fillText(minus(i), px, py + 5);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let j = -range; j <= range; j++) {
    if (j === 0) continue;
    const px = origin.x + uy.x * j, py = origin.y + uy.y * j;
    if (px < v.x0 - 20 || px > v.x1 + 20 || py < v.y0 - 20 || py > v.y1 + 20) continue;
    ctx.beginPath(); ctx.moveTo(px - ex.x * 3, py - ex.y * 3); ctx.lineTo(px + ex.x * 3, py + ex.y * 3); ctx.stroke();
    if (j % stepY === 0) ctx.fillText(minus(j), px - 5, py);
  }
  ctx.restore();
}
function tickStep(px: number, minSpacing: number): number { const want = minSpacing / px; const m = [1, 2, 5, 10, 20, 50, 100]; return m.find(s => s >= want) ?? 100; }

function drawImage(ctx: CanvasRenderingContext2D, o: Obj, shape: Extract<Shape, { k: 'box' }>, sel: Set<Id>) {
  const frame = shape.image; if (!frame) return;
  const [p, px, , py] = frame.corners;
  const img = imageCache(frame.data, frame.mime);
  ctx.save();
  if (frame.clip) { ctx.beginPath(); frame.clip.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.clip(); }
  if (img?.complete && img.naturalWidth) {
    ctx.save(); ctx.transform(px.x - p.x, px.y - p.y, py.x - p.x, py.y - p.y, p.x, p.y);
    ctx.drawImage(img, 0, 0, 1, 1); ctx.restore();
  } else { ctx.strokeStyle = '#999'; ctx.beginPath(); frame.corners.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.stroke(); }
  ctx.restore();
  if (sel.has(o.id)) { ctx.save(); ctx.strokeStyle = SEL_POINT; ctx.setLineDash([4, 3]); ctx.beginPath(); frame.corners.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.stroke(); ctx.restore(); }
}
const images = new Map<string, HTMLImageElement>();
export const imageLoaded = new Set<() => void>();
function imageCache(data: string, mime: string): HTMLImageElement | undefined {
  const key = mime + ':' + data;
  let img = images.get(key);
  if (!img) { img = new Image(); img.onload = () => imageLoaded.forEach(f => f()); img.src = `data:${mime};base64,${data}`; images.set(key, img); }
  return img;
}
/** 多边形裁剪：把图片限制在多边形内部。 */
export function clipPathOf(_page: Page, results: Results, o: Obj): Pt[] | undefined {
  if (o.def.k !== 'image' || o.def.clip === undefined) return undefined;
  const s = results.get(o.def.clip)?.shape;
  return s?.k === 'poly' ? s.pts : undefined;
}

function drawRegion(ctx: CanvasRenderingContext2D, o: Obj, s: Shape, selected: boolean, color?: string) {
  ctx.save();
  ctx.beginPath();
  if (s.k === 'poly') { s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
  else if (s.k === 'disk') ctx.arc(s.c.x, s.c.y, s.r, 0, TAU);
  else if (s.k === 'sector') {
    if (!s.segment) ctx.moveTo(s.c.x, s.c.y);
    ctx.arc(s.c.x, s.c.y, s.r, -s.a0, -(s.a0 + s.sweep), true); ctx.closePath();
  }
  ctx.globalAlpha = o.style.fillAlpha ?? 0.5;
  ctx.fillStyle = color ?? colorOf(o);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (selected) { ctx.fillStyle = 'rgba(208,0,208,0.35)'; ctx.fill(); }
  ctx.restore();
}

function strokeShape(ctx: CanvasRenderingContext2D, o: Obj, s: Shape, selected: boolean, highlighted: boolean, color?: string) {
  const w = LINE_WIDTH[o.style.width] ?? 2;
  const path = () => {
    ctx.beginPath();
    if (s.k === 'line') {
      const clipped = clipStraight(s.s, currentView);
      if (clipped) { ctx.moveTo(clipped[0].x, clipped[0].y); ctx.lineTo(clipped[1].x, clipped[1].y); }
    } else if (s.k === 'circle') ctx.arc(s.c.c.x, s.c.c.y, s.c.r, 0, TAU);
    else if (s.k === 'arc') ctx.arc(s.c.x, s.c.y, s.r, -s.a0, -(s.a0 + s.sweep), true);
    else if (s.k === 'paths') for (const p of s.paths) {
      let last: Pt | undefined, count = 0, distance = 0;
      ctx.lineDashOffset = 0;
      for (let i = 1; i < p.length; i++) {
        const line = clipStraight({ a: p[i - 1], b: p[i], ext: 'segment' }, currentView);
        if (!line) { last = undefined; continue; }
        if (!last || Math.hypot(last.x - line[0].x, last.y - line[0].y) > 1e-6) ctx.moveTo(line[0].x, line[0].y);
        ctx.lineTo(line[1].x, line[1].y); last = line[1];
        distance += Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y);
        if (++count === 128) {
          // 自交或密集轨迹的一次性描边会让原生栅格器做过量工作。
          ctx.stroke(); ctx.beginPath(); ctx.lineDashOffset = -distance; count = 0; last = undefined;
        }
      }
      ctx.stroke(); ctx.beginPath();
    }
  };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (selected || highlighted) { ctx.strokeStyle = selected ? SEL_LINE : 'rgba(255,160,0,0.45)'; ctx.lineWidth = w + 6; path(); ctx.stroke(); }
  ctx.strokeStyle = color ?? colorOf(o); ctx.lineWidth = w; ctx.setLineDash(dashFor(o));
  if (s.k === 'paths' && s.colors) {
    s.paths.forEach((points, j) => { for (let i = 1; i < points.length; i++) {
      const line = clipStraight({ a: points[i - 1], b: points[i], ext: 'segment' }, currentView); if (!line) continue;
      ctx.beginPath(); ctx.strokeStyle = s.colors?.[j]?.[i] ?? colorOf(o); ctx.moveTo(line[0].x, line[0].y); ctx.lineTo(line[1].x, line[1].y); ctx.stroke();
    } });
  } else { path(); ctx.stroke(); }
  ctx.restore();
}

/** 在页面坐标下裁到可见范围，避免把发散结果的巨大坐标提交给原生绘图器。 */
export function clipStraight(s: { a: Pt; b: Pt; ext: string }, view: Rect): [Pt, Pt] | undefined {
  let lo = s.ext === 'line' ? -Infinity : 0, hi = s.ext === 'segment' ? 1 : Infinity;
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  if (![s.a.x, s.a.y, dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) < 1e-12) return undefined;
  for (const [a, d, min, max] of [[s.a.x, dx, view.x0 - 30, view.x1 + 30], [s.a.y, dy, view.y0 - 30, view.y1 + 30]]) {
    if (d === 0) { if (a < min || a > max) return undefined; continue; }
    const t0 = (min - a) / d, t1 = (max - a) / d;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return undefined;
  }
  const at = (t: number) => ({ x: s.a.x + t * dx, y: s.a.y + t * dy });
  const a = at(lo), b = at(hi);
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return undefined;
  // 巨大坐标相减可能丢掉低位，参数虽已裁剪，重建点仍有很大的舍入残差。
  const bounded = (p: Pt) => ({ x: Math.max(view.x0 - 30, Math.min(view.x1 + 30, p.x)), y: Math.max(view.y0 - 30, Math.min(view.y1 + 30, p.y)) });
  return [bounded(a), bounded(b)];
}

export function drawPoint(ctx: CanvasRenderingContext2D, o: Obj, p: Pt, selected: boolean, highlighted: boolean) {
  const r = POINT_RADIUS[o.style.pointSize] ?? 3.5;
  ctx.save();
  if (selected) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, TAU); ctx.strokeStyle = SEL_POINT; ctx.lineWidth = 2; ctx.stroke(); }
  if (highlighted) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, TAU); ctx.strokeStyle = 'rgba(255,160,0,0.8)'; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fillStyle = colorOf(o); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  ctx.restore();
}

export function labelAnchor(o: Obj, s: Shape | undefined): Pt | undefined {
  if (!s) return undefined;
  const dx = o.labelDx ?? 6, dy = o.labelDy ?? 6;
  if (s.k === 'pt') return { x: s.p.x + dx, y: s.p.y + dy };
  if (s.k === 'line') { const m = { x: (s.s.a.x + s.s.b.x) / 2, y: (s.s.a.y + s.s.b.y) / 2 }; return { x: m.x + (o.labelDx ?? 4), y: m.y + (o.labelDy ?? -14) }; }
  if (s.k === 'circle') return { x: s.c.c.x + s.c.r * 0.707 + (o.labelDx ?? 4), y: s.c.c.y - s.c.r * 0.707 + (o.labelDy ?? -14) };
  if (s.k === 'arc') return { x: s.c.x + s.r * Math.cos(s.a0 + s.sweep / 2) + (o.labelDx ?? 4), y: s.c.y - s.r * Math.sin(s.a0 + s.sweep / 2) + (o.labelDy ?? -14) };
  if (s.k === 'poly') { const c = s.pts.reduce((a, p) => ({ x: a.x + p.x / s.pts.length, y: a.y + p.y / s.pts.length }), { x: 0, y: 0 }); return { x: c.x + (o.labelDx ?? 0), y: c.y + (o.labelDy ?? 0) }; }
  if (s.k === 'paths' && s.paths[0]?.length) { const p = s.paths[0][Math.floor(s.paths[0].length / 2)]; return { x: p.x + 4, y: p.y - 12 }; }
  return undefined;
}

function drawLabel(ctx: CanvasRenderingContext2D, o: Obj, at: Pt) {
  ctx.save();
  ctx.font = catFont('label', FONT_LABEL, true, MATH_ITALIC); ctx.fillStyle = catColor('label', '#000'); ctx.textBaseline = 'top';
  ctx.fillText(o.label ?? '', at.x, at.y); underlineIf(ctx, 'label', o.label ?? '', at.x, at.y);
  ctx.restore();
}

function drawTextual(ctx: CanvasRenderingContext2D, page: Page, results: Results, o: Obj, selected: boolean) {
  const r = results.get(o.id);
  const s = r?.shape;
  if (o.hidden) return;
  let text: string | undefined, at = o.at;
  if (o.def.k === 'iterimg' && s?.k === 'multi') {
    const source = byId(page, o.def.src);
    if (source?.def.k !== 'text') return;
    for (const image of s.items) {
      if (image.k !== 'box') continue;
      const b = boxOf(source, image);
      if (b) drawRichText(ctx, source, embeddedText(page, results, source, image.textValues).text, b, selected);
    }
    return;
  }
  if (o.def.k === 'text') {
    const b = boxOf(o, s); if (!b) return;
    const layout = embeddedText(page, results, o);
    drawRichText(ctx, o, layout.text, b, selected);
    const boxes = embeddedButtonBoxes(ctx, o, b, layout);
    ctx.save(); ctx.strokeStyle = '#707070'; ctx.lineWidth = 1;
    for (const box of boxes) ctx.strokeRect(box.rect.x0 - 1, box.rect.y0 - 1, box.rect.x1 - box.rect.x0 + 2, box.rect.y1 - box.rect.y0 + 2);
    ctx.restore();
    return;
  }
  if (o.def.k === 'button') {
    const b = boxOf(o, s); if (!b) return;
    ctx.save();
    ctx.fillStyle = '#e8e8e8'; ctx.strokeStyle = selected ? SEL_POINT : '#707070'; ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = catColor('button', '#000'); ctx.font = catFont('button', FONT_SANS); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.def.text, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); underlineIf(ctx, 'button', o.def.text, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - 8);
    ctx.restore();
    return;
  }
  if ((o.def.k === 'table' || o.def.k === 'itertable') && s?.k === 'table' && at) {
    const nm = (id: Id) => { const c = byId(page, id); return c ? measureName(page, results, c) : ''; };
    const names = o.def.k === 'table' ? o.def.cols.map(nm) : ['n', ...o.def.cols.map(nm)];
    drawTable(ctx, page, o, { ...s, cols: s.cols.map((c, i) => ({ ...c, name: names[i] || c.name })) }, at, selected); return; }
  const k = o.def.k;
  if ((k === 'measure' || k === 'param' || k === 'calc' || k === 'func' || k === 'picfunc') && at) text = valueText(page, results, o);
  if (!text || !at) return;
  ctx.save();
  ctx.font = catFont('value', FONT_SANS); ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width;
  if (selected) { ctx.fillStyle = 'rgba(224,112,224,0.4)'; ctx.fillRect(at.x - 3, at.y - 2, w + 6, 24); ctx.strokeStyle = SEL_POINT; ctx.strokeRect(at.x - 3, at.y - 2, w + 6, 24); }
  ctx.fillStyle = o.style.color === '#000000' ? catColor('value', '#000') : o.style.color;
  drawValueLine(ctx, text, at, o.def.k === 'param' && o.def.showEdit);
  underlineIf(ctx, 'value', text, at.x, at.y);
  ctx.restore();
}

/** 名字里的 [..] 画成下标；参数的数值画在小方框里（原版的可编辑数值）。 */
function drawValueLine(ctx: CanvasRenderingContext2D, text: string, at: Pt, boxed: boolean) {
  const split = boxed ? text.lastIndexOf(' = ') : -1;
  const head = split >= 0 ? text.slice(0, split + 3) : text, tail = split >= 0 ? text.slice(split + 3) : '';
  const size = parseFloat(ctx.font) || 16, font = ctx.font;
  let x = at.x;
  for (const part of head.split(/(\[[^\]]*\])/)) {
    if (!part) continue;
    if (part.startsWith('[')) {
      ctx.font = font.replace(/[\d.]+px/, `${size * 0.72}px`);
      const sub = part.slice(1, -1); ctx.fillText(sub, x, at.y + size * 0.35); x += ctx.measureText(sub).width;
      ctx.font = font;
    } else { ctx.fillText(part, x, at.y); x += ctx.measureText(part).width; }
  }
  if (tail) {
    const w = ctx.measureText(tail).width;
    ctx.fillText(tail, x + 3, at.y);
    ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.strokeRect(x, at.y - 2, w + 6, size + 6); ctx.restore();
  }
}

/** 组合文本中的按钮仍是可操作对象；数值、标签在同一处展开，绘制和命中共用布局。 */
function embeddedText(page: Page, results: Results, o: Obj, values?: Extract<Shape, { k: 'box' }>['textValues']): { text: string; buttons: { id: Id; start: number; end: number }[] } {
  if (o.def.k !== 'text') return { text: '', buttons: [] };
  let text = '', end = 0; const buttons: { id: Id; start: number; end: number }[] = [];
  for (const match of o.def.text.matchAll(/(\d+)/g)) {
    text += o.def.text.slice(end, match.index);
    const index = Number(match[1]), ro = byId(page, o.def.refs?.[index] ?? -1);
    const rs = values ? values[index] : ro && results.get(ro.id)?.shape;
    const value = ro?.def.k === 'button' ? ro.def.text : rs?.k === 'num' ? formatQ(rs.q, ro?.decimals) : rs?.k === 'coords' ? `(${rs.x.toFixed(2)}, ${rs.y.toFixed(2)})` : ro?.label ?? (ro?.def.k === 'text' ? ro.def.text : '?');
    if (ro?.def.k === 'button') buttons.push({ id: ro.id, start: text.length, end: text.length + value.length });
    text += value; end = match.index + match[0].length;
  }
  return { text: text + o.def.text.slice(end), buttons };
}
function embeddedButtonBoxes(ctx: CanvasRenderingContext2D, o: Obj, b: Rect, layout: ReturnType<typeof embeddedText>): { id: Id; rect: Rect }[] {
  if (o.def.k !== 'text' || !layout.buttons.length) return [];
  const f = o.def.font, boxes: { id: Id; rect: Rect }[] = []; let line = '', row = 0, index = 0;
  ctx.save(); ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.name}, 'Microsoft YaHei', sans-serif`;
  for (const ch of layout.text) {
    if (ch === '\n') { line = ''; row++; index += ch.length; continue; }
    if (!o.def.refs?.length && ctx.measureText(line + ch).width > b.x1 - b.x0 - 6 && line) { row++; line = ''; }
    const ref = layout.buttons.find(r => index >= r.start && index < r.end), x = b.x0 + 3 + ctx.measureText(line).width, y = b.y0 + 3 + row * f.size * 1.3;
    if (ref) {
      const width = ctx.measureText(ch).width, last = boxes.at(-1);
      if (last?.id === ref.id && last.rect.y0 === y) last.rect.x1 = x + width;
      else boxes.push({ id: ref.id, rect: { x0: x, y0: y, x1: x + width, y1: y + f.size * 1.2 } });
    }
    line += ch; index += ch.length;
  }
  ctx.restore(); return boxes;
}
export function embeddedButtonAt(ctx: CanvasRenderingContext2D, page: Page, results: Results, o: Obj, p: Pt): Obj | undefined {
  const b = boxOf(o, results.get(o.id)?.shape); if (!b) return undefined;
  const hit = embeddedButtonBoxes(ctx, o, b, embeddedText(page, results, o)).find(x => p.x >= x.rect.x0 && p.x <= x.rect.x1 && p.y >= x.rect.y0 && p.y <= x.rect.y1);
  return hit ? byId(page, hit.id) : undefined;
}

export function drawRichText(ctx: CanvasRenderingContext2D, o: Obj, text: string, b: Rect, selected: boolean) {
  if (o.def.k !== 'text') return;
  const f = o.def.font;
  ctx.save();
  ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.name}, 'Microsoft YaHei', sans-serif`;
  ctx.fillStyle = f.color; ctx.textBaseline = 'top';
  if (selected) { ctx.fillStyle = 'rgba(224,112,224,0.35)'; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeStyle = SEL_POINT; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.fillStyle = f.color; }
  const runs = o.def.runs;
  if (runs?.length && runs.map(r => r.text).join('') === text) {
    const rows: { ch: string; font: typeof f; width: number }[][] = [[]];
    let width = 0;
    for (const run of runs) for (const ch of run.text) {
      const rf = run.font;
      ctx.font = `${rf.italic ? 'italic ' : ''}${rf.bold ? 'bold ' : ''}${rf.size}px ${rf.name}, 'Microsoft YaHei', sans-serif`;
      if (ch === '\n') { rows.push([]); width = 0; continue; }
      const w = ctx.measureText(ch).width;
      if (!o.def.refs?.length && width + w > b.x1 - b.x0 - 6 && rows.at(-1)!.length) { rows.push([]); width = 0; }   // 带引用的文本按标记分行，宽度随内容
      rows.at(-1)!.push({ ch, font: rf, width: w }); width += w;
    }
    let y = b.y0 + 3;
    for (const row of rows) {
      let x = b.x0 + 3; const height = Math.max(f.size, ...row.map(c => c.font.size)) * 1.3;
      for (const cell of row) {
        const rf = cell.font;
        ctx.font = `${rf.italic ? 'italic ' : ''}${rf.bold ? 'bold ' : ''}${rf.size}px ${rf.name}, 'Microsoft YaHei', sans-serif`;
        ctx.fillStyle = rf.color; ctx.fillText(cell.ch, x, y);
        if (rf.underline) ctx.fillRect(x, y + rf.size * 1.1, cell.width, 1);
        x += cell.width;
      }
      y += height;
    }
    ctx.restore(); return;
  }
  const lines = wrap(ctx, text, o.def.refs?.length ? Infinity : b.x1 - b.x0 - 6);
  lines.forEach((ln, i) => {
    const y = b.y0 + 3 + i * (f.size * 1.3);
    ctx.fillText(ln, b.x0 + 3, y);
    if (f.underline) { const w = ctx.measureText(ln).width; ctx.fillRect(b.x0 + 3, y + f.size * 1.1, w, 1); }
  });
  ctx.restore();
}
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > width && line) { out.push(line); line = ch; } else line += ch;
    }
    out.push(line);
  }
  return out;
}

function drawTable(ctx: CanvasRenderingContext2D, page: Page, o: Obj, s: Extract<Shape, { k: 'table' }>, at: Pt, selected: boolean) {
  const colW = 90, rowH = 22;
  ctx.save();
  ctx.font = catFont('table', FONT_SANS); ctx.textBaseline = 'middle';
  const rows = s.rows.length + 1, cols = Math.max(1, s.cols.length);
  ctx.fillStyle = '#fff'; ctx.fillRect(at.x, at.y, colW * cols, rowH * (rows + 1));
  ctx.strokeStyle = selected ? SEL_POINT : '#444'; ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeRect(at.x, at.y, colW * cols, rowH * (rows + 1));
  ctx.fillStyle = '#000';
  s.cols.forEach((c, i) => { ctx.fillText(c.name, at.x + 5 + i * colW, at.y + rowH / 2); });
  ctx.beginPath(); ctx.moveTo(at.x, at.y + rowH); ctx.lineTo(at.x + colW * cols, at.y + rowH);
  for (let i = 1; i < cols; i++) { ctx.moveTo(at.x + i * colW, at.y); ctx.lineTo(at.x + i * colW, at.y + rowH * (rows + 1)); }
  ctx.stroke();
  s.rows.forEach((row, r) => row.forEach((v, i) => ctx.fillText(i === 0 && s.intFirst ? String(v) : formatPlain(Number(v)), at.x + 5 + i * colW, at.y + rowH * (r + 1.5))));
  void o; void page;
  ctx.restore();
}

/** 用于信息工具、状态栏的对象类型名（短命令名，不抄原文）。 */
export function typeName(o: Obj): string {
  const d = o.def;
  switch (d.k) {
    case 'free': return '点'; case 'onpath': return '线上的点'; case 'mid': return '中点'; case 'inter': return '交点';
    case 'translate': case 'rotate': case 'dilate': case 'reflect': return '点';
    case 'seg': return '线段'; case 'ray': return '射线'; case 'line': return '直线'; case 'parallel': case 'perp': return '直线';
    case 'bisect': return '射线';
    case 'circle': case 'circle-seg': return '圆'; case 'arc-circle': case 'arc3': return '弧';
    case 'poly': return d.pts.length === 3 ? '三角形内部' : d.pts.length === 4 ? '四边形内部' : '多边形内部';
    case 'circle-int': return '圆内部'; case 'arc-int': return '扇形内部';
    case 'locus': return '轨迹'; case 'plot': return '函数图像'; case 'pcurve': return '参数曲线';
    case 'measure': return '度量值'; case 'param': return '参数'; case 'calc': return '计算结果'; case 'func': return '函数';
    case 'picfunc': return '数据函数'; case 'itertable': return '表格'; case 'iterimg': return '迭代象'; case 'iterate': return '迭代';
    case 'table': return '表格'; case 'sys': return '坐标系'; case 'text': return '说明'; case 'button': return '操作类按钮'; case 'image': return '图片'; case 'stroke': return '绘图';
    default: return '对象';
  }
}

export { parentsOf };
