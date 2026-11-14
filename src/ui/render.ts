/** Canvas 绘制：文档图形层。预览与追踪在各自的画布上，不经过这里。 */
import { classOf } from '../core/construct';
import { drawMathLine, fontStack, layoutExpr, layoutRich, type MathBox } from './mathlayout';
import { BUTTON_BAR } from '../core/button';
import { drawWarp, strokeWarpOutline } from './warp-draw';
import { boxOf, tableSizes, type Rect } from '../core/hit';
import { display as numDisplay, formatPlain, formatQ, exprToText, type Expr } from '../core/expr';
import { functionExpression, type Results, type Shape } from '../core/engine';
import { TEXT_DEFAULTS, type DisplayPrefs, type Id, type Obj, type Page, type TextCat, type TextRun } from '../core/model';
import { byId, defaultValueDisplay, parentsOf, TEXT_REF } from '../core/model';
import { fontAt, normalizeRuns } from '../core/text-runs';
import { TAU } from '../core/geom';
import type { Pt } from '../core/geom';

// 点型 0–3 的半径（逻辑像素）。原版 96 dpi 截图：点型 1 的填充直径约 2 像素（example-36.gsp 轴上的点），
// 点型 2 的外径 9 像素、填充 7 像素（fixtures-p1/pic96 的自由点）；点型 3 未实测。
export const POINT_RADIUS = [1.5, 1.5, 4, 6.5];
// 迭代象的点按迭代象自己的点型画成无描边纯色小点（第十七轮实测：原版截图抗锯齿面积折算的半径，
// 点型 0/1/2/3 = 0.9/1.4/2.15/2.95，取自 1221、1346、0454/0416、0451/0456；与原象的点型无关）。
export const ITER_POINT_RADIUS = [0.9, 1.4, 2.15, 2.95];
/** 迭代点的像素形状：n 是外框边长，rows 是 [行, 起列, 止列(不含)]，相对外框左上角。依据：原版 0454/0416（点型 2）、0451/0456（点型 3）、1346（点型 1）、1170/1221（点型 0）的像素逐个统计。 */
const ITER_SPRITES: { n: number; rows: [number, number, number][] }[] = [
  { n: 2, rows: [[0, 0, 2], [1, 0, 2]] },
  { n: 3, rows: [[0, 0, 3], [1, 0, 3], [2, 0, 3]] },
  { n: 5, rows: [[0, 1, 4], [1, 0, 5], [2, 0, 5], [3, 0, 5], [4, 1, 4]] },
  { n: 7, rows: [[0, 2, 5], [1, 1, 6], [2, 0, 7], [3, 0, 7], [4, 0, 7], [5, 1, 6], [6, 2, 5]] },
];
// 线宽码 0..3 的像素宽度：原版夹具实测（把 0669 全部对象头的线宽码改成 0/1/2/3，截图量得 1/1/3/5 像素；码 4 原版拒绝打开）。
export const LINE_WIDTH = [1, 1, 3, 5];
const VALUE_DX = 4, VALUE_DY = 5;
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
  // 标签的斜体 = 样式表斜体 或 数学标签选项（原版改写 10005 实验：样式表斜体为假、选项开启时标签仍是斜体；样式表斜体为真、选项关闭时也是斜体）。
  const name = o.name ?? def.style.name, wantBold = o.bold ?? (bold || def.style.bold), wantItalic = cat === 'label' ? !!o.italic || italic : o.italic ?? italic;
  return `${wantItalic ? 'italic ' : ''}${wantBold ? 'bold ' : ''}${px}px ${fontStack(name)}`;
}
function objectFont(o: Obj, cat: TextCat): string {
  const f = o.font;
  return f ? `${f.italic || (cat === 'label' && MATH_ITALIC) ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${fontStack(f.name)}` : catFont(cat, FONT_SANS);
}
const catColor = (cat: TextCat, dflt: string) => TS[cat]?.color ?? dflt;
/** 对象自己的样式表项带颜色（1203 后三个字段）时用它，否则用页面的该类文字默认色。 */
const fontColor = (o: Obj, cat: TextCat, dflt: string) => o.font && o.font.color && o.font.color !== '#000000' ? o.font.color : catColor(cat, dflt);
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
/** 度量/计算依赖的几何对象（点、线、圆…）本身没有定义时，原版整行文字都不画；只有算式自己无定义（如开方取负、点值超范围）才写“未定义”。
 * 依据：0935、0959 的原版截图里依赖无定义交点的度量不出现，0416、0807 的算式无定义写“未定义”。 */
const missingGeometryMemo = new WeakMap<Results, Map<Id, boolean>>();
function dependsOnMissingGeometry(page: Page, results: Results, id: Id): boolean {
  let memo = missingGeometryMemo.get(results);
  if (!memo) { memo = new Map(); missingGeometryMemo.set(results, memo); }
  const walk = (x: Id, seen: Set<Id>): boolean => {
    const known = memo!.get(x);
    if (known !== undefined) return known;
    if (seen.has(x)) return false;
    seen.add(x);
    const ob = byId(page, x);
    let found = false;
    if (ob) for (const p of parentsOf(ob.def)) {
      const po = byId(page, p);
      if (po && !['measure', 'calc', 'param', 'func'].includes(po.def.k) && results.get(p)?.status === 'undefined') { found = true; break; }
      if (walk(p, seen)) { found = true; break; }
    }
    memo!.set(x, found);
    return found;
  };
  return walk(id, new Set());
}

function userLabel(o: Obj): string | undefined {
  if (o.def.k !== 'calc' && o.def.k !== 'measure') return o.label;
  return (o.valueDisplay ?? defaultValueDisplay(o)) === 'expression' ? undefined : o.label;
}
/** 旧新版文档没有数值显示方式，保留其自动命名规则。 */
function displayLabel(page: Page, o: Obj): string | undefined {
  const own = userLabel(o);
  if (o.valueDisplay !== undefined || own || o.def.k !== 'calc' || !o.label) return own;
  const unnameable = (e: Expr, depth: number): boolean => {
    switch (e.t) {
      case 'ref': {
        const p = byId(page, e.id);
        if (!p || (p.def.k !== 'calc' && p.def.k !== 'measure') || userLabel(p)) return false;
        if (p.hidden) return !p.label;   // 被隐藏又没有任何名字的度量/计算（1156、1192 的原版画面）
        return p.def.k === 'calc' && depth < 8 && unnameable(p.def.expr, depth + 1);
      }
      case 'neg': case 'fn': case 'call': return unnameable(e.a, depth);
      case 'bin': return unnameable(e.a, depth) || unnameable(e.b, depth);
      default: return false;
    }
  };
  if (unnameable(o.def.expr, 0)) return o.label;
  return undefined;
}
function measureNameInner(page: Page, _results: Results, o: Obj, state: { remaining: number; active: Set<Id> }): string {
  { const own = displayLabel(page, o); if (own) return own; }
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
    case 'markedangle': {
      const mark = byId(page, r[0])?.def;
      return mark?.k === 'angle-mark' ? `∠${nm(mark.a)}${nm(mark.v)}${nm(mark.b)}` : '角度';
    }
    case 'perimeter': return `${nm(r[0])}的周长`;
    case 'circumference': return `${nm(r[0])}的周长`;
    case 'area': return `${nm(r[0])}的面积`;
    case 'arcangle': return `m${nm(r[0])}`;
    case 'arclength': return `${nm(r[0])}的弧长`;
    case 'radius': return `${nm(r[0])}的半径`;
    case 'ratio': return `${nm(r[0])}/${nm(r[1])}`;
    case 'pointvalue': return `${nm(r[0])}的值`;
    case 'abscissa': return `x[${nm(r[0])}]`;   // 原版把点名写成下标：x_D、y_C
    case 'ordinate': return `y[${nm(r[0])}]`;
    case 'coords': return nm(r[0]);
    case 'coorddist': return `${nm(r[0])}${nm(r[1])}`;
    case 'coordradius': return `r[${nm(r[0])}]`;
    case 'coordangle': return `θ[${nm(r[0])}]`;
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
/** 画板上度量、计算和参数的负数用短横线 “–”（原版 0669 的 –2.82、0416 的 –1.00、1346 的 –2.18）；文字里嵌入的数值和表格不在此列。 */
const dashNegative = (t: string) => t.replace(/^-/, '–');
export function valueText(page: Page, results: Results, o: Obj): string | undefined {
  if (o.def.k === 'picfunc') {   // 原版显示成“f(x): 绘图 [1]”
    const { height, stroke } = o.def, s = byId(page, stroke);
    const sources = page.objects.filter(x => {
      if (!height) return x.def.k === 'stroke';
      const shape = results.get(x.id)?.shape;
      return shape?.k === 'box' && !!shape.image;
    });
    const index = s ? sources.indexOf(s) + 1 : 0;
    return `${o.label ?? 'f'}(x): ${s ? (height ? '图片' : typeName(s)) : '?'} [${index || '?'}]`;
  }
  if (o.def.k === 'func') {   // 函数在画板上显示成“f(x) = 表达式”
    const d = o.def, v = d.form === 'x=f(y)' ? 'y' : d.form === 'r=f(t)' ? 'θ' : d.form === 't=f(r)' ? 'r' : d.param || 'x';
    return `${funcHead(d)} = ${exprToText(functionExpression(page, o.id) ?? d.expr, id => { const p = byId(page, id); return !p ? '?' : p.def.k === 'param' || p.def.k === 'func' ? p.def.name : measureName(page, results, p); }, 0, v)}`;
  }
  const s = results.get(o.id)?.shape;
  const valueLine = (value: string) => {
    if (o.valueDisplay === 'number') return value;
    if (o.valueDisplay === 'equals') return ` = ${value}`;
    return `${measureName(page, results, o)} = ${value}`;
  };
  if (!s) return results.get(o.id)?.status === 'undefined' && !dependsOnMissingGeometry(page, results, o.id) ? valueLine('未定义') : undefined;
  if (s.k === 'num') return valueLine(dashNegative(formatQ(s.q, o.decimals)));
  const name = measureName(page, results, o);
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
export function flatShapes(s: Shape | undefined): Shape[] { return flatColored(s).map(x => x.s); }
/** 展开嵌套的 multi（如迭代象的原象是轨迹），保留每个子图形的颜色：内层颜色优先（保形映射1.gsp 的灰度渐变球）。 */
export function flatColored(s: Shape | undefined, color?: string, out: { s: Shape; color?: string }[] = []): { s: Shape; color?: string }[] {
  if (!s) return out;
  if (s.k !== 'multi') { out.push({ s, color }); return out; }
  s.items.forEach((it, i) => flatColored(it, s.colors?.[i] ?? color, out));
  return out;
}

export function drawPage(ctx: CanvasRenderingContext2D, page: Page, results: Results, o: DrawOpts) {
  currentResults = results;
  currentView = o.view;
  const objs = page.objects.filter(x => !(x.hidden && o.hideHidden) && !o.skip?.has(x.id));
  const sel = o.selection;
  const hl = new Set(o.highlight ?? []);
  // 坐标系的网格最先画
  const shown = new Set(objs.map(x => x.id));
  for (const x of objs) if (x.def.k === 'sys') drawSystem(ctx, x, results, o, shown);
  for (const x of objs) for (const shape of flatShapes(results.get(x.id)?.shape)) if (shape.k === 'box' && shape.image) drawImage(ctx, x, shape, sel);
  // 区域填充
  for (const x of objs) {
    const shape = results.get(x.id)?.shape;
    flatColored(shape).forEach(({ s, color }) => {
      if (s.k === 'poly' || s.k === 'disk' || s.k === 'sector') drawRegion(ctx, x, s, sel.has(x.id) || hl.has(x.id), color);
    });
  }
  // 线、圆、弧、轨迹
  // 轨迹先于直线、圆、弧绘制：原版 0669 里深红色的点轨迹压在蓝色线段和绿色弧线下面（经验规则，原理未明）。
  // 受控对照 420 份带轨迹的课件：彩色得分提高 8 份（0292 0.879→0.974、0810 0.499→0.632、0461、0291、0293 等）、降低 2 份（0837 多露出一道绿边、0341）。
  const strokeObjs = [...objs.filter(o => o.def.k === 'locus'), ...objs.filter(o => o.def.k !== 'locus')];
  for (const x of strokeObjs) {
    if (x.def.k === 'sys') continue;
    const shape = results.get(x.id)?.shape;
    flatColored(shape).forEach(({ s, color }) => {
      if (s.k === 'line' || s.k === 'circle' || s.k === 'arc' || s.k === 'paths') strokeShape(ctx, x, s, sel.has(x.id), hl.has(x.id), color);
    });
  }
  // 点
  // 同一页的点型迭代象按迭代层交错绘制（第 k 层的各迭代象依次画完再画第 k+1 层），不是整个迭代象依次覆盖：
  // 原版 1131（六色圆极限集）里先出现的白点盖在后出现的彩色点上、绿点只留在自己的簇里。受控对照（按对象顺序 / 反序 / 交错）的彩色得分：
  // 1135 0.902/0.940/0.952，1131 0.736/0.715/0.760，1006 0.884/0.902/0.904，其余课件不变。
  const interleaved = objs.filter(o => o.def.k === 'iterimg' && !sel.has(o.id) && !hl.has(o.id) && ITER_SPRITES[o.style.pointSize] && (() => { const m = results.get(o.id)?.shape; return m?.k === 'multi' && m.items.every(i => i.k === 'pt'); })());
  if (interleaved.length > 1) {
    const lists = interleaved.map(o => ({ o, items: (results.get(o.id)!.shape as { items: Shape[]; colors?: (string | undefined)[] }).items, colors: (results.get(o.id)!.shape as { colors?: (string | undefined)[] }).colors, sprite: ITER_SPRITES[o.style.pointSize], base: colorOf(o) }));
    const most = Math.max(...lists.map(l => l.items.length));
    ctx.save();
    for (let k = 0; k < most; k++) for (const l of lists) {
      const it = l.items[k]; if (!it || it.k !== 'pt' || !inView(it.p)) continue;
      ctx.fillStyle = l.colors?.[k] ?? l.base;
      const left = Math.round(it.p.x - l.sprite.n / 2), top = Math.round(it.p.y - l.sprite.n / 2);
      for (const [dy, a, b] of l.sprite.rows) ctx.fillRect(left + a, top + dy, b - a, 1);
    }
    ctx.restore();
  }
  for (const x of objs) {
    if (interleaved.length > 1 && interleaved.includes(x)) continue;
    const shape = results.get(x.id)?.shape;
    const selected = sel.has(x.id), highlighted = hl.has(x.id);
    if (shape?.k === 'pt' && inView(shape.p)) drawPoint(ctx, x, shape.p, selected, highlighted);
    if (shape?.k !== 'multi') continue;
    // 整组共用 Canvas 状态，但仍按原顺序逐点填充和描边，保留重叠、透明度与高亮。
    // 迭代出来的点画成无描边小点，半径按迭代象自己的点型查 ITER_POINT_RADIUS
    const iterated = x.def.k === 'iterimg', r = iterated ? ITER_POINT_RADIUS[x.style.pointSize] ?? 2.15 : POINT_RADIUS[x.style.pointSize] ?? 3.5;
    ctx.save();
    ctx.fillStyle = colorOf(x);
    const outline = !iterated && !selected && !highlighted;   // 迭代点是无描边的纯色小点（0416、0454 的原版画面）
    if (outline) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; }
    const base = colorOf(x);
    const sprite = iterated && !selected && !highlighted ? ITER_SPRITES[x.style.pointSize] : undefined;
    if (sprite) {
      // 原版迭代点是不抗锯齿的像素块（实测 2×2、3×3、去角的 5×5 与 7×7）；同色的点合成一条路径一次填充。
      let current: string | undefined;
      ctx.beginPath();
      for (const { s, color } of flatColored(shape)) if (s.k === 'pt' && inView(s.p)) {
        const c = color ?? base;
        if (c !== current) { if (current !== undefined) ctx.fill(); ctx.beginPath(); ctx.fillStyle = c; current = c; }
        const left = Math.round(s.p.x - sprite.n / 2), top = Math.round(s.p.y - sprite.n / 2);
        for (const [dy, a, b] of sprite.rows) ctx.rect(left + a, top + dy, b - a, 1);
      }
      if (current !== undefined) ctx.fill();
      ctx.restore();
      continue;
    }
    for (const { s, color } of flatColored(shape)) if (s.k === 'pt' && inView(s.p)) {
      if (selected || highlighted) pointRings(ctx, s.p, r, selected, highlighted);
      ctx.fillStyle = color ?? base;
      pointPath(ctx, s.p, r); ctx.fill(); if (outline || selected || highlighted) ctx.stroke();
    }
    ctx.restore();
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

function drawSystem(ctx: CanvasRenderingContext2D, o: Obj, results: Results, opt: DrawOpts, shown: Set<Id>) {
  const s = results.get(o.id)?.shape;
  if (s?.k !== 'sys' || o.def.k !== 'sys') return;
  const { origin, ux, uy } = s, v = opt.view;
  const lx = Math.hypot(ux.x, ux.y), ly = Math.hypot(uy.x, uy.y);
  if (lx < 2 || ly < 2) return;
  const piX = o.def.grid === 'tri' || !!o.def.piX, piY = !!o.def.piY;
  const piStepX = piX ? piGridUnits(lx) : 0, piStepY = piY ? piGridUnits(ly) : 0;
  const gx = piX ? Math.PI * piStepX / 72 : piY ? numericGridStep(lx) : 1;
  const gy = piY ? Math.PI * piStepY / 72 : piX ? numericGridStep(ly) : 1;
  ctx.save();
  ctx.lineWidth = 1;
  if (o.def.showGrid) {
    ctx.strokeStyle = o.style.color || '#c0c0c0';   // 网格颜色就是坐标系对象的颜色（0450 是几乎看不见的 #f2f2f2，其余多为 #c0c0c0）
    const grid = o.def.grid;
    if (grid === 'polar') {
      const far = Math.hypot(v.x1 - v.x0, v.y1 - v.y0) + Math.hypot(origin.x - v.x0, origin.y - v.y0);
      if (o.def.gridPoints) {
        ctx.fillStyle = o.style.color || '#c0c0c0';
        ctx.beginPath();
        for (let r = lx; r < far; r += lx) for (let k = 0; k < 12; k++) {
          const x = origin.x + r * Math.cos((k * TAU) / 12), y = origin.y - r * Math.sin((k * TAU) / 12);
          if (x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1) { ctx.moveTo(x + 1.2, y); ctx.arc(x, y, 1.2, 0, TAU); }
        }
        ctx.fill();
      } else {
        for (let r = lx; r < far; r += lx) { ctx.beginPath(); ctx.arc(origin.x, origin.y, r, 0, TAU); ctx.stroke(); }
        for (let k = 0; k < 12; k++) { ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(origin.x + far * Math.cos((k * TAU) / 12), origin.y - far * Math.sin((k * TAU) / 12)); ctx.stroke(); }
      }
    } else {
      const corners = [[v.x0, v.y0], [v.x1, v.y0], [v.x0, v.y1], [v.x1, v.y1]].map(([x, y]) => ({ x: x - origin.x, y: y - origin.y }));
      const det = ux.x * uy.y - ux.y * uy.x;
      const toU = (p: Pt) => ({ x: (p.x * uy.y - p.y * uy.x) / det, y: (ux.x * p.y - ux.y * p.x) / det });
      const cs = corners.map(toU), minx = Math.floor(Math.min(...cs.map(c => c.x)) / gx), maxx = Math.ceil(Math.max(...cs.map(c => c.x)) / gx), miny = Math.floor(Math.min(...cs.map(c => c.y)) / gy), maxy = Math.ceil(Math.max(...cs.map(c => c.y)) / gy);
      const lines = (maxx - minx) + (maxy - miny);
      if (o.def.gridPoints && (maxx - minx + 1) * (maxy - miny + 1) < 100000) {
        ctx.fillStyle = o.style.color || '#c0c0c0';
        ctx.beginPath();
        for (let i = minx; i <= maxx; i++) for (let j = miny; j <= maxy; j++) {
          const x = origin.x + ux.x * i * gx + uy.x * j * gy, y = origin.y + ux.y * i * gx + uy.y * j * gy;
          if (x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1) { ctx.moveTo(x + 1.2, y); ctx.arc(x, y, 1.2, 0, TAU); }
        }
        ctx.fill();
      } else if (!o.def.gridPoints && lines < 600) {
        ctx.beginPath();
        const align = Math.abs(ux.y) < 1e-9 && Math.abs(uy.x) < 1e-9;   // 轴对齐的网格线落在整像素上（原版是 1 像素 #c0c0c0，1004 截图核对）
        for (let i = minx; i <= maxx; i++) {
          const x = origin.x + ux.x * i * gx, ax = align ? Math.round(x) + 0.5 : x;
          ctx.moveTo(ax + uy.x * miny * gy, origin.y + ux.y * i * gx + uy.y * miny * gy); ctx.lineTo(ax + uy.x * maxy * gy, origin.y + ux.y * i * gx + uy.y * maxy * gy);
        }
        for (let j = miny; j <= maxy; j++) {
          const y = origin.y + uy.y * j * gy, ay = align ? Math.round(y) + 0.5 : y;
          ctx.moveTo(origin.x + ux.x * minx * gx + uy.x * j * gy, ay + ux.y * minx * gx); ctx.lineTo(origin.x + ux.x * maxx * gx + uy.x * j * gy, ay + ux.y * maxx * gx);
        }
        ctx.stroke();
      }
    }
  }
  // 坐标轴与刻度
  ctx.strokeStyle = '#606060'; ctx.fillStyle = catColor('axis', '#404040'); ctx.font = catFont('axis', '11px sans-serif');
  const far = 4000, ex = { x: ux.x / lx, y: ux.y / lx }, ey = { x: uy.x / ly, y: uy.y / ly };
  // 轴对象被隐藏时原版不画该轴及其刻度（原版夹具 fixtures-p1/pic96/warp-native.gsp：两轴隐藏，绘图区无轴线）
  const showX = shown.has(o.def.axisX), showY = shown.has(o.def.axisY);
  // 轴对齐时，轴线和刻度落在整像素上（原版是 1 像素实线；半像素会被抗锯齿成两条浅线）
  const snapAxes = Math.abs(ux.y) < 1e-9 && Math.abs(uy.x) < 1e-9;
  const sx = (x: number) => (snapAxes ? Math.round(x) + 0.5 : x), sy = (y: number) => (snapAxes ? Math.round(y) + 0.5 : y);
  const ox = sx(origin.x), oy = sy(origin.y);
  ctx.beginPath();
  if (showX) { ctx.moveTo(ox - ex.x * far, oy - ex.y * far); ctx.lineTo(ox + ex.x * far, oy + ex.y * far); }
  if (showY) { ctx.moveTo(ox - ey.x * far, oy - ey.y * far); ctx.lineTo(ox + ey.x * far, oy + ey.y * far); }
  ctx.stroke();
  // 刻度与数字（原版夹具实测，第十七轮）：十进制轴的数字按 1-2-5 序列取间距不小于 80 像素（x，y 取 40）的最小值，
  // 刻度是数字步长的 1/10（尾数 1）、1/4（尾数 2）、1/5（尾数 5），例如单位 100 像素：数字每 1、刻度每 0.1；单位 3.16：数字每 50、刻度每 10。
  // 有 π 刻度的轴仍按原来的整数步长。
  const dx = !piX && !piY ? decimalSteps(lx, 80) : undefined, dy = !piY && !piX ? decimalSteps(ly, 40) : undefined;
  const tx = dx ? dx.tick : gx, ty = dy ? dy.tick : gy;
  const stepX = dx ? dx.every : piX ? Math.max(1, Math.ceil(60 / (lx * gx))) : piY ? Math.max(1, Math.ceil(100 / (lx * gx))) : tickStep(lx, 100);
  const stepY = dy ? dy.every : piY ? Math.max(1, Math.ceil(60 / (ly * gy))) : piX ? Math.max(1, Math.ceil(50 / (ly * gy))) : tickStep(ly, 50);
  const rangeX = Math.ceil(far / (lx * tx)), rangeY = Math.ceil(far / (ly * ty));
  const minus = (n: number) => String(n).replace('-', '−');
  const tickPath = new Path2D();   // 整条轴的刻度一次描边
  const half = 5;   // 刻度总长约 10 像素（含轴线所在行）
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = -rangeX; i <= rangeX && showX; i++) {
    if (i === 0) continue;
    const px = origin.x + ux.x * i * tx, py = origin.y + ux.y * i * tx;
    if (px < v.x0 - 20 || px > v.x1 + 20 || py < v.y0 - 20 || py > v.y1 + 20) continue;
    tickPath.moveTo(sx(px) - ey.x * half, oy + (py - origin.y) - ey.y * half); tickPath.lineTo(sx(px) + ey.x * half, oy + (py - origin.y) + ey.y * half);
    if (i % stepX === 0) { if (piX) drawPiTick(ctx, i * piStepX, px, py + 5, false); else ctx.fillText(minus(Number((i * tx).toPrecision(10))), px, py + 5); }
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let j = -rangeY; j <= rangeY && showY; j++) {
    if (j === 0) continue;
    const px = origin.x + uy.x * j * ty, py = origin.y + uy.y * j * ty;
    if (px < v.x0 - 20 || px > v.x1 + 20 || py < v.y0 - 20 || py > v.y1 + 20) continue;
    tickPath.moveTo(ox + (px - origin.x) - ex.x * half, sy(py) - ex.y * half); tickPath.lineTo(ox + (px - origin.x) + ex.x * half, sy(py) + ex.y * half);
    if (j % stepY === 0) { if (piY) drawPiTick(ctx, j * piStepY, px - 5, py, true); else ctx.fillText(minus(Number((j * ty).toPrecision(10))), px - 5, py); }
  }
  ctx.stroke(tickPath);
  ctx.restore();
}
/** 十进制坐标轴的刻度步长：数字间距取 1-2-5 序列里不小于 minSpacing 像素的最小值，刻度为数字步长的 1/10、1/4、1/5（按尾数 1、2、5）；every 是每隔几个刻度写一个数字。 */
export function decimalSteps(unitPx: number, minSpacing: number): { label: number; tick: number; every: number } {
  const want = minSpacing / unitPx + 1e-9;   // 严格大于：夹具里恰好 80 像素的单位 8、16 都被原版舍掉（只有单位 4 被接受，是已知的单点不吻合）
  let k = Math.floor(Math.log10(want)) - 1, label = 0;
  for (; ; k++) {
    const hit = [1, 2, 5].map(m => m * 10 ** k).find(l => l >= want);
    if (hit !== undefined) { label = hit; break; }
  }
  const mantissa = Math.round(label / 10 ** Math.floor(Math.log10(label) + 1e-9));
  const every = mantissa === 1 ? 10 : mantissa === 2 ? 4 : 5;
  return { label, tick: label / every, every };
}
function tickStep(px: number, minSpacing: number): number { const want = minSpacing / px; const m = [1, 2, 5, 10, 20, 50, 100]; return m.find(s => s >= want) ?? 100; }

/** π 轴以 π/72 为整数单位，按可见间距选取网格。 */
function piGridUnits(px: number): number {
  const candidates = [1, 2, 3, 6, 12, 18, 36, 72, 144, 288, 576, 1152, 2304];
  return candidates.find(n => px * Math.PI * n / 72 >= 35) ?? candidates[candidates.length - 1];
}
function numericGridStep(px: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(35 / px)));
  return ([1, 2, 5, 10].find(n => n * power * px >= 35) ?? 10) * power;
}
function drawPiTick(ctx: CanvasRenderingContext2D, units: number, x: number, y: number, vertical: boolean) {
  let a = Math.abs(units), b = 72;
  while (b) { const r = a % b; a = b; b = r; }
  const numerator = Math.abs(units) / a, denominator = 72 / a;
  const text = `${units < 0 ? '−' : ''}${numerator === 1 ? '' : numerator}π`;
  if (denominator === 1) { ctx.fillText(text, x, y); return; }
  ctx.save();
  const width = Math.max(ctx.measureText(text).width, ctx.measureText(String(denominator)).width) + 2;
  const cx = vertical ? x - width / 2 : x, top = vertical ? y - 10 : y;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(text, cx, top); ctx.fillRect(cx - width / 2, top + 11, width, 1);
  ctx.fillText(String(denominator), cx, top + 13);
  ctx.restore();
}

function drawImage(ctx: CanvasRenderingContext2D, o: Obj, shape: Extract<Shape, { k: 'box' }>, sel: Set<Id>) {
  const frame = shape.image; if (!frame) return;
  const [p, px, , py] = frame.corners;
  const img = imageCache(frame.data, frame.mime);
  if (frame.mesh) {
    const mesh = frame.mesh;
    if (!img?.complete || !img.naturalWidth || !drawWarp(ctx, img, mesh)) { ctx.save(); ctx.strokeStyle = '#999'; strokeWarpOutline(ctx, mesh); ctx.restore(); }
    if (sel.has(o.id)) { ctx.save(); ctx.strokeStyle = SEL_POINT; ctx.lineWidth = 1; strokeWarpOutline(ctx, mesh); ctx.restore(); }
    return;
  }
  ctx.save();
  for (const clip of frame.clips ?? []) { ctx.beginPath(); clip.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.clip(); }
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
    ctx.arc(s.c.x, s.c.y, s.r, -s.a0, -(s.a0 + s.sweep), s.sweep >= 0); ctx.closePath();
  }
  ctx.globalAlpha = o.def.k === 'segment-mark' ? 1 : o.style.fillAlpha ?? 0.5;
  ctx.fillStyle = color ?? colorOf(o);
  // 原版用 Windows 默认的“交替”填充规则：同一顶点序列走两遍的区域不填（2011年无锡.gsp 的白色内框）、自交多边形的重叠处留空。
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
  if (selected) { ctx.fillStyle = 'rgba(208,0,208,0.35)'; ctx.fill('evenodd'); }
  ctx.restore();
}

/** 画布当前是 1:1 缩放（没有放大、也没有高分屏倍率）。没有变换接口的替身画布按 1:1 处理。 */
function unitScale(ctx: CanvasRenderingContext2D): boolean {
  if (typeof ctx.getTransform !== 'function') return false;
  const m = ctx.getTransform();
  if (!m || typeof m.a !== 'number') return false;
  return Math.abs(m.a - 1) < 1e-6 && Math.abs(m.d - 1) < 1e-6 && !m.b && !m.c;
}
export function strokeShape(ctx: CanvasRenderingContext2D, o: Obj, s: Shape, selected: boolean, highlighted: boolean, color?: string) {
  const w = LINE_WIDTH[o.style.width] ?? 2;
  // 原版（GDI）画 1、3、5 像素的直线是对齐像素的实线（0414 棋盘边框：原版一行 #c0c0c0，落在整数坐标上的抗锯齿线只有一半浓度）。
  // 画布缩放为 1 时把奇数线宽的直线端点取整并移到像素中心；放大或高分屏缩放时保持精确位置，避免缩放时线条跳动。
  const crisp = w % 2 === 1 && unitScale(ctx);
  const sn = (v: number) => (crisp ? Math.round(v) + 0.5 : v);
  const path = () => {
    ctx.beginPath();
    if (s.k === 'line') {
      const clipped = clipStraight(s.s, currentView);
      if (clipped) { ctx.moveTo(sn(clipped[0].x), sn(clipped[0].y)); ctx.lineTo(sn(clipped[1].x), sn(clipped[1].y)); }
    } else if (s.k === 'circle') ctx.arc(s.c.c.x, s.c.c.y, s.c.r, 0, TAU);
    else if (s.k === 'arc') ctx.arc(s.c.x, s.c.y, s.r, -s.a0, -(s.a0 + s.sweep), s.sweep >= 0);
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

function pointPath(ctx: CanvasRenderingContext2D, p: Pt, r: number) {
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
}

function pointRings(ctx: CanvasRenderingContext2D, p: Pt, r: number, selected: boolean, highlighted: boolean) {
  if (selected) { pointPath(ctx, p, r + 4); ctx.strokeStyle = SEL_POINT; ctx.lineWidth = 2; ctx.stroke(); }
  if (highlighted) { pointPath(ctx, p, r + 5); ctx.strokeStyle = 'rgba(255,160,0,0.8)'; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
}

export function drawPoint(ctx: CanvasRenderingContext2D, o: Obj, p: Pt, selected: boolean, highlighted: boolean) {
  const r = POINT_RADIUS[o.style.pointSize] ?? 3.5;
  ctx.save();
  pointRings(ctx, p, r, selected, highlighted);
  pointPath(ctx, p, r);
  ctx.fillStyle = colorOf(o); ctx.fill(); ctx.stroke();
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
  ctx.font = o.font ? objectFont(o, 'label') : catFont('label', FONT_LABEL, true, MATH_ITALIC); ctx.fillStyle = fontColor(o, 'label', '#000'); ctx.textBaseline = 'top';
  // 标签里的 [..] 是下标（原版 example-09.gsp 的 L[2] 显示为 L₂）
  const label = o.label ?? '';
  if (/\[[^\]]*\]/.test(label)) drawValueLine(ctx, label, at, false); else ctx.fillText(label, at.x, at.y);
  underlineIf(ctx, 'label', label, at.x, at.y);
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
      if (b) { const layout = embeddedText(page, results, source, image.textValues); drawRichText(ctx, source, layout.text, b, selected, layout.runs); }
    }
    return;
  }
  if (o.def.k === 'text') {
    const b = boxOf(o, s); if (!b) return;
    const math = o.def.math;
    if (math && o.def.text === o.def.mathText) {
      // 含分数、上下标、根号的原版文字：按结构排版（文字未被编辑时）
      const def = o.def, refText = (index: number, mode?: 'A' | 'D') => embeddedText(page, results, { ...o, def: { ...def, text: `${index}${mode ? ':' + mode : ''}` } }).text;
      ctx.save();
      const box = layoutRich(ctx, math, refText, def.font);
      if (selected) { ctx.fillStyle = 'rgba(224,112,224,0.35)'; ctx.fillRect(b.x0, b.y0, Math.max(b.x1 - b.x0, box.w + 6), Math.max(b.y1 - b.y0, box.asc + box.desc + 6)); }
      ctx.fillStyle = def.font.color; box.draw(ctx, b.x0 + 3, b.y0 + 3 + box.asc);
      ctx.restore();
      return;
    }
    const layout = embeddedText(page, results, o);
    drawRichText(ctx, o, layout.text, b, selected, layout.runs);
    return;
  }
  if (o.def.k === 'button') {
    const b = boxOf(o, s); if (!b) return;
    // 原版外观：黑色细边框，左侧对象颜色的色条，右侧灰色立体按钮面，标签左对齐（截图 example-40.gsp、单摆.gsp）
    ctx.save();
    ctx.font = objectFont(o, 'button');
    const px = Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 16, tw = ctx.measureText(o.def.text).width;
    const link = o.def.action.type === 'link';
    const x = Math.round(b.x0), y = Math.round(b.y0), w = Math.round(link ? Math.max(b.x1 - b.x0, tw + 9 + BUTTON_BAR) : tw + 9 + BUTTON_BAR), h = Math.round(link ? Math.max(b.y1 - b.y0, px + 5) : px + 5);
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colorOf(o); ctx.fillRect(x + 1, y + 1, BUTTON_BAR, h - 2);
    const fx = x + 2 + BUTTON_BAR, fw = w - 3 - BUTTON_BAR;
    ctx.fillStyle = '#c0c0c0'; ctx.fillRect(fx, y + 1, fw, h - 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(fx, y + 1, fw, 1); ctx.fillRect(fx, y + 1, 1, h - 2);
    ctx.fillStyle = '#808080'; ctx.fillRect(fx, y + h - 2, fw, 1); ctx.fillRect(fx + fw - 1, y + 1, 1, h - 2);
    if (selected) { ctx.strokeStyle = SEL_POINT; ctx.lineWidth = 2; ctx.strokeRect(x - 3, y - 3, w + 6, h + 6); }
    ctx.fillStyle = fontColor(o, 'button', '#000'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(o.def.text, fx + 3, y + h / 2 + 0.5);
    if (o.font?.underline) ctx.fillRect(fx + 3, y + h / 2 + px / 2, tw, 1); else if (!o.font) underlineIf(ctx, 'button', o.def.text, fx + 3, y + h / 2 - 8);
    ctx.restore();
    return;
  }
  if ((o.def.k === 'table' || o.def.k === 'itertable') && s?.k === 'table' && at) {
    const sources = o.def.cols.map(id => byId(page, id));
    if (o.def.k === 'itertable') sources.unshift(undefined);
    drawTable(ctx, page, results, o, s, sources, at, selected); return;
  }
  const k = o.def.k;
  if ((k === 'measure' || k === 'param' || k === 'calc' || k === 'func' || k === 'picfunc') && at) text = valueText(page, results, o);
  if (!text || !at) return;
  ctx.save();
  ctx.font = objectFont(o, 'value'); ctx.textBaseline = 'top';
  // 原版把度量、计算、参数的文字画在文件位置右下方：左 4 像素、上 5 像素（改后复测各份外框差 ≤1 像素）（第十七轮 0669、0416、1162、1346、0454、0813 的墨迹外框对照）。
  const vx = at.x + VALUE_DX, vy = at.y + VALUE_DY;
  const math = mathParts(page, results, o, ctx);
  if (math) {
    // 没有自定义标签的计算和函数定义按公式排版
    const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 16;
    ctx.fillStyle = o.font?.color && o.font.color !== '#000000' ? o.font.color : o.style.color === '#000000' ? catColor('value', '#000') : o.style.color;
    const box = drawMathLine(ctx, math, ctx.font, size, vx, vy);
    if (selected) { ctx.fillStyle = 'rgba(224,112,224,0.4)'; ctx.fillRect(vx - 3, vy - 2, box.w + 6, box.h + 4); ctx.strokeStyle = SEL_POINT; ctx.strokeRect(vx - 3, vy - 2, box.w + 6, box.h + 4); }
    ctx.restore();
    return;
  }
  const w = ctx.measureText(text).width;
  if (selected) { const h = Math.max(24, (o.font?.size ?? 18) + 6); ctx.fillStyle = 'rgba(224,112,224,0.4)'; ctx.fillRect(vx - 3, vy - 2, w + 6, h); ctx.strokeStyle = SEL_POINT; ctx.strokeRect(vx - 3, vy - 2, w + 6, h); }
  ctx.fillStyle = o.font?.color && o.font.color !== '#000000' ? o.font.color : o.style.color === '#000000' ? catColor('value', '#000') : o.style.color;
  drawValueLine(ctx, text, { x: vx, y: vy }, o.def.k === 'param' && o.def.showEdit, MATH_ITALIC);
  if (o.font?.underline) ctx.fillRect(vx, vy + o.font.size, w, 1); else if (!o.font) underlineIf(ctx, 'value', text, vx, vy);
  ctx.restore();
}

/** 算式里引用的无名计算（原版自动起名 m[n] 的）按它的算式展开并加括号：0617 的“(s·p)·1厘米”。有名字的计算和度量仍写名字。 */
function inlineUnnamedCalcs(page: Page, e: Expr, depth = 0): Expr {
  switch (e.t) {
    case 'ref': { const p = byId(page, e.id); return depth < 8 && p?.def.k === 'calc' && !displayLabel(page, p) ? inlineUnnamedCalcs(page, p.def.expr, depth + 1) : e; }
    case 'neg': return { ...e, a: inlineUnnamedCalcs(page, e.a, depth) };
    case 'bin': return { ...e, a: inlineUnnamedCalcs(page, e.a, depth), b: inlineUnnamedCalcs(page, e.b, depth) };
    case 'fn': case 'call': return { ...e, a: inlineUnnamedCalcs(page, e.a, depth) };
    default: return e;
  }
}

/** 计算（无自定义标签）和函数定义的排版片段；其它对象返回 undefined。 */
function mathParts(page: Page, results: Results, o: Obj, ctx: CanvasRenderingContext2D): (string | MathBox)[] | undefined {
  const d = o.def;
  if (!(d.k === 'calc' && o.valueDisplay !== 'number' && o.valueDisplay !== 'equals' && !displayLabel(page, o)) && d.k !== 'func') return undefined;
  const expr = d.k === 'calc' ? inlineUnnamedCalcs(page, d.expr) : functionExpression(page, o.id) ?? d.expr;
  const nameOf = (id: Id) => { const p = byId(page, id); return !p ? '?' : p.def.k === 'param' || p.def.k === 'func' ? p.def.name : measureName(page, results, p); };
  const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 16;
  const varName = d.k === 'func' ? (d.form === 'x=f(y)' ? 'y' : d.form === 'r=f(t)' ? 'θ' : d.form === 't=f(r)' ? 'r' : d.param || 'x') : 'x';
  const box = layoutExpr(ctx, expr, { font: ctx.font, size, nameOf, varName, italicVars: MATH_ITALIC });
  if (d.k === 'func') return [`${funcHead(d)} = `, box];
  const s = results.get(o.id);
  const value = s?.shape?.k === 'num' ? dashNegative(formatQ(s.shape.q, o.decimals)) : s?.status === 'undefined' && !dependsOnMissingGeometry(page, results, o.id) ? '未定义' : undefined;
  return value === undefined ? undefined : [box, ` = ${value}`];
}

/** 名字里的 [..] 画成下标；参数的数值画在小方框里（原版的可编辑数值）。 */
const LATIN_NAME = /([A-Za-zΑ-Ωα-ω′'″]+)/;
function drawValueLine(ctx: CanvasRenderingContext2D, text: string, at: Pt, boxed: boolean, italicName = false) {
  const last = text.lastIndexOf(' = ');
  const split = boxed ? last : -1;
  const head = split >= 0 ? text.slice(0, split + 3) : text, tail = split >= 0 ? text.slice(split + 3) : '';
  const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 16, font = ctx.font;
  // 名字部分（最后一个“ = ”之前）按数学标签选项画斜体：只有拉丁、希腊字母和撇号斜体，数字、汉字和符号保持正体（原版 0669、0454、0416 对照）。
  const nameEnd = italicName && last >= 0 && !/\bitalic\b/.test(font) ? last : -1;
  const italicFont = `italic ${font}`;
  let x = at.x, pos = 0;
  const draw = (s: string, f: string, y: number) => { ctx.font = f; ctx.fillText(s, x, y); x += ctx.measureText(s).width; };
  for (const part of head.split(/(\[[^\]]*\])/)) {
    if (!part) continue;
    const start = pos; pos += part.length;
    const inName = start < nameEnd;
    if (part.startsWith('[')) {
      const sub = part.slice(1, -1), f = (inName && !/^[\d.]+$/.test(sub) ? italicFont : font).replace(/[\d.]+px/, `${size * 0.72}px`);
      draw(sub, f, at.y + size * 0.35);
    } else if (inName) {
      const cut = Math.min(part.length, nameEnd - start);
      for (const piece of part.slice(0, cut).split(LATIN_NAME)) if (piece) draw(piece, LATIN_NAME.test(piece) && piece.length === (piece.match(LATIN_NAME)?.[0].length ?? -1) ? italicFont : font, at.y);
      if (cut < part.length) draw(part.slice(cut), font, at.y);
    } else draw(part, font, at.y);
  }
  ctx.font = font;
  if (tail) {
    const w = ctx.measureText(tail).width;
    ctx.fillText(tail, x + 3, at.y);
    ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.strokeRect(x, at.y - 2, w + 6, size + 6); ctx.restore();
  }
}

/** 文字里引用另一段文字时用它展开后的内容（0870 的“矩形DEFG的面积”引用的文字里还嵌着四个对象名）；嵌套深度有限，防止互相引用。 */
let nestedDepth = 0;
function nestedText(page: Page, results: Results, ro: Obj): string {
  if (ro.def.k !== 'text') return '?';
  if (nestedDepth >= 4) return ro.def.text;
  nestedDepth++;
  try { return embeddedText(page, results, ro).text; } finally { nestedDepth--; }
}

/** 组合文本中的按钮仍是可操作对象；数值、标签在同一处展开，绘制和命中共用布局。 */
export function embeddedText(page: Page, results: Results, o: Obj, values?: Extract<Shape, { k: 'box' }>['textValues']): { text: string; buttons: { id: Id; start: number; end: number }[]; runs?: TextRun[] } {
  if (o.def.k !== 'text') return { text: '', buttons: [] };
  const def = o.def, inputRuns = def.runs?.map(r => r.text).join('') === def.text ? def.runs : undefined, outputRuns: TextRun[] = [];
  const appendRange = (start: number, finish: number) => {
    if (!inputRuns) return;
    let offset = 0;
    for (const run of inputRuns) {
      const from = Math.max(0, start - offset), to = Math.min(run.text.length, finish - offset);
      if (to > from) outputRuns.push({ text: run.text.slice(from, to), font: run.font });
      offset += run.text.length;
      if (offset >= finish) break;
    }
  };
  let text = '', end = 0; const buttons: { id: Id; start: number; end: number }[] = [];
  for (const match of o.def.text.matchAll(TEXT_REF)) {
    appendRange(end, match.index);
    text += o.def.text.slice(end, match.index);
    const index = Number(match[1]), ro = byId(page, o.def.refs?.[index] ?? -1);
    const rs = values ? values[index] : ro && results.get(ro.id)?.shape;
    let value = ro?.label ?? (ro?.def.k === 'text' ? nestedText(page, results, ro) : '?');
    if (match[2] === 'A') value = ro?.label ?? (ro?.def.k === 'param' || ro?.def.k === 'func' ? ro.def.name : '');
    else if (match[2] === 'D') value = rs?.k === 'num' ? ` ${rs.q.v < 0 ? '−' : '+'} ${formatQ({ ...rs.q, v: Math.abs(rs.q.v) }, ro?.decimals)}` : '?';
    else if (ro?.def.k === 'button') value = ro.def.text;
    else if (!values && ro && !rs && results.get(ro.id)?.status === 'undefined' && (ro.def.k === 'measure' || ro.def.k === 'calc' || ro.def.k === 'param')) value = '未定义';
    else if (rs?.k === 'num') value = formatQ(rs.q, ro?.decimals);
    else if (rs?.k === 'coords') value = `(${rs.x.toFixed(2)}, ${rs.y.toFixed(2)})`;
    else if (rs?.k === 'text') value = rs.text;
    else if (rs?.k === 'func' && ro) value = valueText(page, results, ro) ?? value;
    else if (ro?.def.k === 'seg' && ro.label === undefined) {
      value = [ro.def.a, ro.def.b].map(id => {
        const label = byId(page, id)?.label;
        if (!label) return '?';
        const subscripted = label.replace(/\[(\d+)\]/g, (_, digits: string) =>
          [...digits].map(ch => '₀₁₂₃₄₅₆₇₈₉'[Number(ch)]).join(''));
        return [...subscripted].map(ch => ch + '\u0305').join('');
      }).join('');
    }
    if (ro?.def.k === 'button') buttons.push({ id: ro.id, start: text.length, end: text.length + value.length });
    if (inputRuns && value) outputRuns.push({ text: value, font: fontAt(inputRuns, match.index, def.font) });
    text += value; end = match.index + match[0].length;
  }
  appendRange(end, o.def.text.length);
  return { text: text + o.def.text.slice(end), buttons, ...(inputRuns ? { runs: normalizeRuns(outputRuns) } : {}) };
}
function embeddedButtonBoxes(ctx: CanvasRenderingContext2D, o: Obj, b: Rect, layout: ReturnType<typeof embeddedText>): { id: Id; rect: Rect }[] {
  if (o.def.k !== 'text' || !layout.buttons.length) return [];
  const f = o.def.font, boxes: { id: Id; rect: Rect }[] = [];
  const rows: { width: number; size: number; name: string; index: number }[][] = [[]]; let index = 0;
  ctx.save();
  for (const run of layout.runs ?? [{ text: layout.text, font: f }]) for (const ch of run.text) {
    if (ch === '\n') { rows.push([]); index += ch.length; continue; }
    const rf = run.font;
    ctx.font = `${rf.italic ? 'italic ' : ''}${rf.bold ? 'bold ' : ''}${rf.size}px ${rf.name}, 'Microsoft YaHei', sans-serif`;
    rows[rows.length - 1].push({ width: ctx.measureText(ch).width, size: rf.size, name: rf.name, index });
    index += ch.length;
  }
  let y = b.y0 + 3;
  for (const row of rows) {
    let x = b.x0 + 3;
    for (const cell of row) {
      const ref = layout.buttons.find(r => cell.index >= r.start && cell.index < r.end), last = boxes.at(-1);
      if (ref) {
        if (last?.id === ref.id && last.rect.y0 === y) { last.rect.x1 = x + cell.width; last.rect.y1 = Math.max(last.rect.y1, y + cell.size * 1.2); }
        else boxes.push({ id: ref.id, rect: { x0: x, y0: y, x1: x + cell.width, y1: y + cell.size * 1.2 } });
      }
      x += cell.width;
    }
    y += row.length ? Math.max(...row.map(cell => gdiLineHeight(cell.size, cell.name))) : gdiLineHeight(f.size, f.name);
  }
  ctx.restore(); return boxes;
}
export function embeddedButtonAt(ctx: CanvasRenderingContext2D, page: Page, results: Results, o: Obj, p: Pt): Obj | undefined {
  const b = boxOf(o, results.get(o.id)?.shape); if (!b) return undefined;
  const hit = embeddedButtonBoxes(ctx, o, b, embeddedText(page, results, o)).find(x => p.x >= x.rect.x0 && p.x <= x.rect.x1 && p.y >= x.rect.y0 && p.y <= x.rect.y1);
  return hit ? byId(page, hit.id) : undefined;
}

export function drawRichText(ctx: CanvasRenderingContext2D, o: Obj, text: string, b: Rect, selected: boolean, resolvedRuns?: TextRun[]) {
  if (o.def.k !== 'text') return;
  const f = o.def.font;
  ctx.save();
  ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.name}, 'Microsoft YaHei', sans-serif`;
  ctx.fillStyle = f.color; ctx.textBaseline = 'top';
  if (selected) { ctx.fillStyle = 'rgba(224,112,224,0.35)'; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeStyle = SEL_POINT; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.fillStyle = f.color; }
  const runs = resolvedRuns ?? o.def.runs;
  if (runs?.length && runs.map(r => r.text).join('') === text) {
    const rows: { ch: string; font: typeof f; width: number }[][] = [[]];
    let width = 0;
    for (const run of runs) for (const ch of run.text) {
      const rf = run.font;
      ctx.font = `${rf.italic ? 'italic ' : ''}${rf.bold ? 'bold ' : ''}${rf.size}px ${rf.name}, 'Microsoft YaHei', sans-serif`;
      if (ch === '\n') { rows.push([]); width = 0; continue; }
      const w = ctx.measureText(ch).width;
      if (!o.def.refs?.length && width + w > b.x1 - b.x0 - 6 + WRAP_SLACK && rows.at(-1)!.length) { rows.push([]); width = 0; }   // 带引用的文本按标记分行，宽度随内容
      rows.at(-1)!.push({ ch, font: rf, width: w }); width += w;
    }
    let y = b.y0 + 3;
    for (const row of rows) {
      let x = b.x0 + 3; const height = row.length ? Math.max(...row.map(c => gdiLineHeight(c.font.size, c.font.name))) : gdiLineHeight(f.size, f.name);   // 按这一行实际用到的字体
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
  const lines = wrap(ctx, text, o.def.refs?.length ? Infinity : b.x1 - b.x0 - 6 + WRAP_SLACK);
  lines.forEach((ln, i) => {
    const y = b.y0 + 3 + i * gdiLineHeight(f.size, f.name);
    ctx.fillText(ln, b.x0 + 3, y);
    if (f.underline) { const w = ctx.measureText(ln).width; ctx.fillRect(b.x0 + 3, y + f.size * 1.1, w, 1); }
  });
  ctx.restore();
}
/** 原版（GDI 整数字宽）排版的文字比 Canvas 略窄，同一个框里原版能放下的行，新版按浮点字宽会多出一个字而折行。 */
/** 原版（GDI）的行距，按字体实测：Times New Roman = ceil(1.107×字号)+1（12 号 15、16 号 19：0741、1247、0199），
 * Tahoma = ceil(1.207×字号)（18 号 22：0238、0801）；Arial = 字号+3（12 号 15：1410；18 号 21：1386），其余字体（宋体、黑体、楷体…）按 Times 的公式（0706、1421、1400 的整库对比比 1.3 倍更接近原版）。 */
const gdiLineHeight = (size: number, name?: string) =>
  name === 'Tahoma' ? Math.ceil(size * 1.207) : name === 'Arial' ? size + 3 : Math.ceil(size * 1.107) + 1;
const WRAP_SLACK = (globalThis as { __wrapSlack?: number }).__wrapSlack ?? 0;
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

const tableWidthCache = new WeakMap<object, { key: string; widths: number[] }>();
function drawTable(ctx: CanvasRenderingContext2D, page: Page, results: Results, o: Obj, s: Extract<Shape, { k: 'table' }>, sources: (Obj | undefined)[], at: Pt, selected: boolean) {
  // 原版 0325 截图实测：黑色 1 像素外框，表头高 22、数据行高 20，行间和列间是 50% 灰的 1 像素线；
  // 列宽 = 该列最宽文字 + 约 10 像素；文字居中；无法读成数的单元（原版画的无穷大符号）显示 ∞。
  const scale = Math.max(1, (o.font?.size ?? 14) / 14), rowH = 20 * scale;
  ctx.save();
  ctx.font = objectFont(o, 'table'); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const cols = Math.max(1, s.cols.length);
  const nameOf = (id: Id) => { const source = byId(page, id); return source ? measureName(page, results, source) : '?'; };
  const options = { font: ctx.font, size: Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 14, nameOf, varName: 'x', italicVars: MATH_ITALIC };
  const labels: string[] = [];
  const headers = Array.from({ length: cols }, (_, i) => {
    const source = sources[i];
    const label = (source && measureName(page, results, source)) || (o.def.k === 'itertable' && i === 0 ? 'n' : s.cols[i]?.name ?? '');
    labels.push(label);
    // 迭代数据表的列沿用数值初象名称。普通测量表的表头才展开公式。
    if (o.def.k === 'itertable') return undefined;
    const def = source?.def;
    if (source && def?.k === 'calc' && !displayLabel(page, source)) return layoutExpr(ctx, inlineUnnamedCalcs(page, def.expr), options);
    if (!label) return undefined;
    const slash = source && def?.k === 'measure' && def.m === 'ratio' && !displayLabel(page, source) ? label.indexOf('/') : -1;
    if (slash < 0) return layoutExpr(ctx, { t: 'ref', id: 0 }, { ...options, nameOf: () => label });
    const names = [label.slice(0, slash), label.slice(slash + 1)];
    return layoutExpr(ctx, { t: 'bin', op: '/', a: { t: 'ref', id: 0 }, b: { t: 'ref', id: 1 } }, { ...options, nameOf: id => names[id] });
  });
  const headH = Math.max(22 * scale, ...headers.map(h => h ? Math.ceil(h.asc + h.desc + 4 * scale) : 0));
  const cell = (v: number, i: number) => Number.isNaN(Number(v)) ? '∞' : (i === 0 && s.intFirst ? String(v) : formatPlain(Number(v))).replace('-', '−');
  // 列宽只与内容、字体和表头有关：同一份结果（s.rows 是同一个数组）重绘时不再逐格量字。
  const key = `${ctx.font}|${JSON.stringify(labels)}|${headers.map(h => h?.w ?? 0).join(',')}|${scale}`;
  let cache = tableWidthCache.get(s.rows);
  if (!cache || cache.key !== key) {
    cache = { key, widths: Array.from({ length: cols }, (_, i) => {
      let width = headers[i]?.w ?? ctx.measureText(labels[i]).width;
      for (const row of s.rows) width = Math.max(width, ctx.measureText(cell(row[i], i)).width);
      return width + 10 * scale;
    }) };
    tableWidthCache.set(s.rows, cache);
  }
  const widths = cache.widths;
  const totalW = widths.reduce((a, b) => a + b, 0), totalH = headH + rowH * s.rows.length;
  tableSizes.set(s, { w: totalW, h: totalH });
  // 只画落在当前视口内的行（超长表格不必每帧画出全部行）。
  const view = currentView;
  const first = view ? Math.max(0, Math.floor((view.y0 - at.y - headH) / rowH) - 1) : 0;
  const last = view ? Math.min(s.rows.length - 1, Math.ceil((view.y1 - at.y - headH) / rowH) + 1) : s.rows.length - 1;
  ctx.fillStyle = '#fff'; ctx.fillRect(at.x, at.y, totalW, totalH);
  ctx.strokeStyle = '#7f7f7f'; ctx.lineWidth = 1; ctx.beginPath();
  for (let r = first; r <= last; r++) { const y = Math.round(at.y + headH + rowH * r) + 0.5; ctx.moveTo(at.x, y); ctx.lineTo(at.x + totalW, y); }
  let x = at.x; for (let i = 0; i < cols - 1; i++) { x += widths[i]; const px = Math.round(x) + 0.5; ctx.moveTo(px, at.y); ctx.lineTo(px, at.y + totalH); }
  ctx.stroke();
  ctx.strokeStyle = selected ? SEL_POINT : '#000'; ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeRect(Math.round(at.x) + 0.5, Math.round(at.y) + 0.5, totalW, totalH);
  ctx.fillStyle = '#000';
  const write = (text: string, cx: number, y: number) => { ctx.fillText(text, cx, y); if (o.font?.underline) ctx.fillRect(cx - ctx.measureText(text).width / 2, y + o.font.size / 2, ctx.measureText(text).width, 1); };
  x = at.x;
  for (let i = 0; i < cols; i++) {
    const header = headers[i];
    if (header) {
      ctx.textAlign = 'left';
      header.draw(ctx, x + (widths[i] - header.w) / 2, at.y + (headH + header.asc - header.desc) / 2);
      ctx.textAlign = 'center';
    } else write(labels[i], x + widths[i] / 2, at.y + headH / 2);
    for (let r = first; r <= last; r++) write(cell(s.rows[r][i], i), x + widths[i] / 2, at.y + headH + rowH * (r + 0.5));
    x += widths[i];
  }
  ctx.restore();
}

/** 用于信息工具、状态栏的对象类型名（短命令名，不抄原文）。 */
export function typeName(o: Obj): string {
  const d = o.def;
  if (d.k === 'segment-mark') return '线段标记';
  if (d.k === 'angle-mark') return '角标';
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
    case 'table': return '表格'; case 'sys': return '坐标系'; case 'text': return '说明'; case 'button': return '操作类按钮'; case 'image': case 'image-clip': case 'custom-image': return '图片'; case 'stroke': return '绘图';
    default: return '对象';
  }
}

export { parentsOf };
