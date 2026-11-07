/**
 * 自定义工具：把一串构造记下来，之后对别的对象重放。
 *
 * 工具 = 一组对象（ID 是工具内 1 起序号）+ 前提条件（用户依次点选、会被替换掉的那几个对象）。
 * 应用时：前提条件换成用户点选的对象，其余对象按顺序重新构造，引用经 remapDef 换成新对象。
 * 文件格式见 docs/gsp格式.md §3h；哪些规则来自文件、哪些是推断，也写在那里。
 */
import { ancestors, isMeasureDef, isPointDef, isStraightDef, parentsOf, type Def, type EmbeddedTool, type Id, type Obj, type Page } from './model';
import { pathPointAt, type EvalCtx, type Results, type Shape } from './engine';
import { remapDef } from './remap';
import { labelFor, type Store } from './store';
import { TAU, type Pt, type Straight } from './geom';

/** 占位类型来自工具记录及其后续构造的引用；依据见 gsp格式.md §3h。 */
export type InputKind = 'point' | 'number' | 'segment' | 'straight' | 'system' | 'function' | 'path' | 'curve' | 'text' | 'polygon' | 'axis' | 'iteration-image' | 'plot-path' | 'object' | 'geometry';
export const inputPrompt: Record<InputKind, string> = {
  point: '点一个点（空白处会新建点）', number: '点一个数值（参数、度量或计算）',
  segment: '点一条线段', straight: '点一个直线型对象',
  system: '点坐标系的原点或坐标轴', function: '点一个函数',
  path: '点一个路径对象', curve: '点一个圆或弧', text: '点一个文本、数值或函数',
  polygon: '点一个多边形内部', axis: '点一根坐标轴', 'iteration-image': '点一个迭代象',
  'plot-path': '点一个函数图像或轨迹', object: '点一个对象',
  geometry: '点一个点、路径或图片',
};
export interface ToolInput { index: Id; kind: InputKind; label?: string }
export interface Tool {
  name: string;
  comment?: string;
  /** 来自哪个工具文件（菜单里的组名）；文档内嵌的工具没有。 */
  group?: string;
  objects: Obj[];
  inputs: ToolInput[];
  /** 不能使用的原因（用户可读）；没有就是可用。 */
  blocked?: string;
  /** 所有阻碍项的简短键（调查脚本统计用）：prereq:大类/类型、obj:方法/大类/类型、free。 */
  blockerKeys?: string[];
}

interface RawKind { m: number; c: number; k: number; withParams?: boolean }
const rawOf = (o: Obj) => o.src as RawKind | undefined;

/** 前提条件对象（方法 0 的占位）要求点选的种类；不认识返回 undefined。 */
export function inputKindOf(o: Obj): InputKind | undefined {
  const r = rawOf(o);
  if (!r) return undefined;
  if (r.c === 1 && r.k === 4) return 'point';
  if (r.c === 1 && r.k === 14) return 'segment';
  if (r.c === 1 && r.k === 7) return 'straight';
  if (r.c === 1 && r.k === 39) return 'system';
  if (r.c === 1 && r.k === 1) return 'object';
  if (r.c === 1 && (r.k === 5 || r.k === 63)) return 'path';
  if (r.c === 1 && r.k === 8) return 'curve';
  if (r.c === 1 && r.k === 17) return 'text';
  if (r.c === 1 && r.k === 15) return 'polygon';
  if (r.c === 1 && r.k === 38) return 'axis';
  if (r.c === 1 && r.k === 65) return 'iteration-image';
  if (r.c === 1 && r.k === 85) return 'plot-path';
  if (r.c === 1 && r.k === 92) return 'geometry';
  if (r.c === 11 && [1, 18, 33, 48, 49, 51, 60, 79, 80, 81].includes(r.k)) return 'number';
  if (r.c === 11 && r.k === 57) return 'function';
  return undefined;
}

/** 画板里的对象能不能当这一项前提条件。 */
export function acceptsInput(kind: InputKind, o: Obj, results?: Results): boolean {
  const s = results?.get(o.id)?.shape;
  if (kind === 'point') return s ? s.k === 'pt' : isPointDef(o.def);
  if (kind === 'segment') return s ? s.k === 'line' && s.s.ext === 'segment' : o.def.k === 'seg';
  if (kind === 'straight') return s ? s.k === 'line' : isStraightDef(o.def);
  if (kind === 'system') return o.def.k === 'sys';
  if (kind === 'function') return o.def.k === 'func' || o.def.k === 'picfunc';
  if (kind === 'object') return o.def.k !== 'unknown';
  if (kind === 'geometry') return !!s && ['pt', 'line', 'circle', 'arc', 'paths', 'poly', 'disk', 'sector'].includes(s.k) || o.def.k === 'image';
  if (kind === 'path') return !!s && ['line', 'circle', 'arc', 'paths', 'poly', 'disk', 'sector'].includes(s.k);
  if (kind === 'curve') return s?.k === 'circle' || s?.k === 'arc' || s?.k === 'sector';
  if (kind === 'polygon') return s?.k === 'poly';
  if (kind === 'axis') return s?.k === 'line'; // 进一步由 toolInputFromHits / applyTool 核对坐标系成员
  if (kind === 'iteration-image') return o.def.k === 'iterimg';
  if (kind === 'plot-path') return o.def.k === 'plot' || o.def.k === 'locus' || o.def.k === 'pcurve';
  if (kind === 'text') return o.def.k === 'text' || isMeasureDef(o.def) || o.def.k === 'func' || o.def.k === 'picfunc';
  return isMeasureDef(o.def) && !(o.def.k === 'measure' && (o.def.m === 'coords' || o.def.m === 'equation'));
}

/** 坐标系本身不画独立轮廓，工具输入通过原点或两根轴找到所属坐标系。 */
export function toolInputFromHits(kind: InputKind, hits: Id[], page: Page, results: Results, used: Id[]): Id | undefined {
  for (const id of hits) {
    const o = page.objects.find(o => o.id === id);
    if (o && !used.includes(id) && acceptsInput(kind, o, results) && (kind !== 'axis' || page.objects.some(s => s.def.k === 'sys' && [s.def.axisX, s.def.axisY].includes(id)))) return id;
    if (kind === 'system') {
      const sys = page.objects.find(o => o.def.k === 'sys' && !used.includes(o.id) && [o.def.origin, o.def.axisX, o.def.axisY].includes(id));
      if (sys) return sys.id;
    }
  }
  return undefined;
}

function visibleLineRange(line: Straight, view: NonNullable<EvalCtx['view']>): [number, number] | undefined {
  let lo = line.ext === 'ray' ? 0 : -Infinity, hi = Infinity;
  for (const [a, b, min, max] of [[line.a.x, line.b.x, view.x0, view.x1], [line.a.y, line.b.y, view.y0, view.y1]]) {
    const delta = b - a;
    if (delta === 0) {
      if (a < min || a > max) return undefined;
      continue;
    }
    const t0 = (min - a) / delta, t1 = (max - a) / delta;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  if (lo <= hi && Number.isFinite(lo) && Number.isFinite(hi)) {
    // 原版会缩短定义点很接近的长线区间，以免初值离开构造附近太远。
    if (Math.abs(line.b.x - line.a.x) < 28 && Math.abs(line.b.y - line.a.y) < 28) {
      if (lo < -1 && hi > 1) lo = -1;
      if (hi > 2 && lo <= 0) hi = 2;
    }
    return [lo, hi];
  }
  return undefined;
}

/**
 * 工具里的函数图像：原版应用时把定义域重设为覆盖当前视口。
 * 依据：44 组工具逐个原版执行的保存结果（tools 对照，见 docs/工具兼容验证.md）。
 */
function toolPlotRange(st: Store, def: Extract<Obj['def'], { k: 'plot' }>): { lo?: number; hi?: number; samples?: number } {
  const view = st.ctx.view!, sys = st.get(def.sys)?.def, func = st.get(def.func)?.def;
  if (!st.results.has(def.sys)) st.recompute();
  if (sys?.k !== 'sys') return {};
  const point = (id: Id) => { const s = st.results.get(id)?.shape; return s?.k === 'pt' ? s.p : undefined; };
  const origin = point(sys.origin), vertical = func?.k === 'func' && func.form === 'x=f(y)';
  const unit = point(vertical ? sys.unitY : sys.unitX);
  if (!origin || !unit) return {};
  const length = Math.hypot(unit.x - origin.x, unit.y - origin.y);
  if (!(length > 0)) return {};
  // 定义域覆盖视口：x=f(y) 按视口高，其余按视口宽；采样数恢复默认 750。
  if (vertical) return { lo: (origin.y - view.y1) / length, hi: (origin.y - view.y0) / length, samples: 750 };
  return { lo: (view.x0 - origin.x) / length, hi: (view.x1 - origin.x) / length, samples: 750 };
}

/** 工具应用时沿可见路径初始化一次。尝试次数有上限，路径完全在屏幕外时仍保留可拖动的点。 */
export function initialToolPathParameter(shape: Shape | undefined, random: () => number = Math.random, view?: EvalCtx['view']): number {
  const unit = () => Math.max(0, Math.min(1, random()));
  const visible = (t: number) => {
    if (!view) return true;
    const p = pathPointAt(shape, t);
    return !!p && p.x >= view.x0 && p.x <= view.x1 && p.y >= view.y0 && p.y <= view.y1;
  };
  if (shape?.k === 'line') {
    if (shape.s.ext === 'segment') {
      let fallback = 0.3;
      for (let i = 0, candidates = 0; i < 128 && candidates < (view ? 15 : 1); i++) {
        const t = 0.1 + 0.8 * unit();
        if (t > 0.4 && t < 0.6) continue;
        if (visible(t)) return t;
        fallback = t;
        candidates++;
      }
      return fallback;
    }
    const [lo, hi] = (view && visibleLineRange(shape.s, view)) ?? [shape.s.ext === 'ray' ? 0 : -1, 2];
    let t = 0;
    for (let i = 0; i < 4; i++) { t = lo + (hi - lo) * unit(); if (Math.abs(t) >= 0.1 && Math.abs(t - 1) >= 0.1) break; }
    return t;
  }
  const circular = shape?.k === 'circle' || shape?.k === 'disk';
  const tries = !view ? 1 : circular || shape?.k === 'arc' || shape?.k === 'sector' ? 26 : shape?.k === 'poly' ? 10 : shape?.k === 'paths' ? 31 : 1;
  let t = 0;
  for (let i = 0; i < tries; i++) {
    t = unit() * (circular ? TAU : 1);
    if (visible(t)) break;
  }
  return t;
}

const unknownNote = (o: Obj) => (o.def.k === 'unknown' ? o.def.note : '');

/** 由解析好的页面和工具元数据装配出工具，并判断能不能用。 */
export function buildTool(meta: Pick<EmbeddedTool, 'name' | 'comment' | 'prereq'>, page: Page, group?: string): Tool {
  const objects = page.objects;
  const inputs: ToolInput[] = [];
  const reasons: string[] = [], keys: string[] = [];
  const block = (key: string, text: string) => { if (!keys.includes(key)) { keys.push(key); reasons.push(text); } };
  for (const idx of meta.prereq) {
    const o = objects.find(x => x.id === idx);
    const kind = o && inputKindOf(o);
    if (!o || !kind) { const r = o && rawOf(o); block(`prereq:${r?.c ?? '?'}/${r?.k ?? '?'}`, `前提条件的类型（大类 ${r?.c ?? '?'} / 类型 ${r?.k ?? '?'}）还没有核对过，暂不支持`); continue; }
    inputs.push({ index: idx, kind, ...(o.label ? { label: o.label } : {}) });
  }
  const isInput = new Set(meta.prereq);
  for (const o of objects) {
    if (isInput.has(o.id)) continue;
    const note = unknownNote(o), r = rawOf(o);
    if (note) { block(`obj:${r ? `${r.m}/${r.c}/${r.k}` : note}`, `含有新版暂不支持的对象（${note}）`); continue; }
    if (o.def.k === 'free') block('free', '工具里有不依赖前提条件的自由点，位置规则还没有核对过，暂不支持');
  }
  if (!meta.prereq.length) block('noprereq', '工具没有前提条件');
  return { name: meta.name, ...(meta.comment ? { comment: meta.comment } : {}), ...(group ? { group } : {}), objects, inputs, ...(reasons.length ? { blocked: reasons[0], blockerKeys: keys } : {}) };
}

/**
 * 应用工具：picks 与 tool.inputs 一一对应（点选顺序）。必须在事务里调用（或像 Store.run 那样由调用方包裹）。
 * 返回新建的、可见的对象（用于选中）。nextPos 给度量、计算等文字型对象分配页面位置。
 */
/** 文字型对象的下一个空位：从视口左上角 (10,5) 起，排在已有可见文字之下。隐藏对象不占位（逐工具实测）。 */
function nextFloatSlot(st: Store): Pt {
  const base = { x: (st.ctx.view?.x0 ?? st.page.scroll?.x ?? 0) + 10, y: (st.ctx.view?.y0 ?? st.page.scroll?.y ?? 0) + 5 };
  const size = st.doc.settings.display?.textStyles?.value?.size ?? 18;
  let y = base.y;
  for (const o of st.page.objects) {
    if (o.hidden) continue;
    const d = o.def, at = o.at ?? (d.k === 'text' && d.anchor === undefined || d.k === 'button' ? d.at : undefined);
    if (!at || Math.abs(at.x - base.x) > 2) continue;
    const h = d.k === 'param' ? size + 13 : d.k === 'text' ? Math.max(d.h, d.text.split('\n').length * d.font.size * 1.33) : d.k === 'button' ? d.h : size + 7;
    y = Math.max(y, at.y + h + 1);
  }
  return { x: base.x, y };
}
const FUNC_NAMES = 'fghjkmnpqrstuvw';
function nextFunctionName(st: Store): string | undefined {
  const used = new Set(st.page.objects.flatMap(o => o.def.k === 'func' ? [o.def.name] : []));
  return [...FUNC_NAMES].find(c => !used.has(c));
}
/** 点空白处新建的前提点：工具里这个前提显示标签时，新点带上同样的标签（逐工具实测，例如“z center”）。 */
export function toolInputLabel(tool: Tool, index: Id): string | undefined {
  const o = tool.objects.find(x => x.id === index);
  return o?.labelShown || o?.toolLabel ? o.label : undefined;
}

/** 工具作品里显示标签的点重新分配字母，保留撇号；不显示的标签不带入（逐工具实测）。 */
function toolObjectLabel(st: Store, def: Def, o: Obj): string | undefined {
  // 计算、度量等文字型对象的名称存在标签里，不管是否“显示标签”都要带上。
  if (o.label && !isPointDef(def) && !isStraightDef(def)) return o.label;
  if (!o.label || !o.labelShown) return undefined;
  if (o.toolLabel) return o.label;   // 作者勾选了“在自定义工具中使用标签”
  if (!isPointDef(def)) return o.label;
  const primes = /'*$/.exec(o.label)?.[0] ?? '';
  return labelFor(st.page.labelCounter++) + primes;
}

export function applyTool(st: Store, tool: Tool, picks: Id[], _nextPos: () => Pt, options: { random?: () => number } = {}): Obj[] {
  if (tool.blocked) throw new Error(tool.blocked);
  if (picks.length !== tool.inputs.length) throw new Error('前提条件没有点选完整');
  tool.inputs.forEach((inp, i) => { const o = st.get(picks[i]); if (!o || !acceptsInput(inp.kind, o, st.results) || inp.kind === 'axis' && !st.page.objects.some(s => s.def.k === 'sys' && [s.def.axisX, s.def.axisY].includes(o.id))) throw new Error(`第 ${i + 1} 个前提条件类型不符：请${inputPrompt[inp.kind]}`); });
  const map = new Map<Id, Id>();
  tool.inputs.forEach((inp, i) => map.set(inp.index, picks[i]));
  const isInput = new Set(tool.inputs.map(i => i.index)), made: Obj[] = [];
  // 按钮、迭代等会引用排在后面的对象，先为整批对象预留映射。
  let next = st.page.nextId;
  for (const o of tool.objects) if (!isInput.has(o.id)) map.set(o.id, next++);
  for (const o of tool.objects) {
    if (isInput.has(o.id)) continue;
    let def = remapDef(JSON.parse(JSON.stringify(o.def)), map);
    const raw = rawOf(o);
    if (def.k === 'onpath' && raw?.m === 15 && raw.withParams === false) {
      if (!st.results.has(def.path)) st.recompute();
      def = { ...def, t: initialToolPathParameter(st.results.get(def.path)?.shape, options.random, st.ctx.view) };
    }
    if (def.k === 'plot' && st.ctx.view) def = { ...def, ...toolPlotRange(st, def) };
    // 原版应用工具时重设轨迹采样数：实测结果只有 125、250、500，规律未明；取相同量级，兼顾平滑和性能。
    if (def.k === 'locus') def = { ...def, samples: Math.min(500, Math.max(250, def.samples)) };
    if (def.k === 'func') { const name = nextFunctionName(st); if (name) def = { ...def, name }; }
    if (def.k === 'button' || (def.k === 'text' && def.anchor === undefined)) def = { ...def, at: nextFloatSlot(st) };
    // 没有自己样式的文本跟随目标文档的“标题”样式
    const titleStyle = st.doc.settings.display?.textStyles?.title;
    if (def.k === 'text' && titleStyle && def.font.name === 'Times New Roman' && def.font.size === 16) {
      const font = { ...def.font, ...titleStyle }; def = { ...def, font, ...(def.runs ? { runs: def.runs.map(run => ({ ...run, font: { ...run.font, ...titleStyle } })) } : {}) };
    }
    if (def.k === 'text' && def.anchor !== undefined) {
      // 附着文本以点为中心；原版按实际文字尺寸计算，这里用字号估计（占位字符的宽度不可用）。
      const lines = def.text.replace(/\ue000\d+\ue001/g, '0').split('\n');
      const unit = (ch: string) => ch.charCodeAt(0) > 255 ? 1 : 0.5;
      const wide = Math.max(...lines.map(t => [...t].reduce((n, ch) => n + unit(ch), 0))) * def.font.size + 6;
      def = { ...def, off: { x: -wide / 2, y: -lines.length * def.font.size * 0.55 } };
    }
    const label = toolObjectLabel(st, def, o);
    // 计算和度量的文字颜色不随工具（原版应用后是默认黑色）
    const style = def.k === 'calc' || def.k === 'measure' ? { ...o.style, color: '#000000' } : { ...o.style };
    const n = st.add(def, { style, hidden: o.hidden, ...(o.toolLabel ? { toolLabel: true } : {}), labelShown: o.labelShown, ...(label ? { label } : {}), ...(o.trace ? { trace: true } : {}), ...(o.decimals !== undefined ? { decimals: o.decimals } : {}), ...(o.at ? { at: nextFloatSlot(st) } : {}) }, false);
    map.set(o.id, n.id);
    made.push(n);
  }
  st.recompute();
  return made.filter(o => !o.hidden);
}

/**
 * 由画板里选中的对象创建工具：选中的对象是“作品”（保持它们的显示状态），它们依赖的对象是中间步骤（隐藏），
 * 不依赖任何对象的自由点和参数作为前提条件（按创建顺序）。其它独立对象暂不支持。
 */
export function createToolObjects(page: Page, selection: Id[]): { objects: Obj[]; prereq: Id[] } | { error: string } {
  if (!selection.length) return { error: '请先选择要做成工具的对象' };
  const sel = new Set(selection), want = new Set<Id>([...selection, ...ancestors(page, selection)]);
  const list = page.objects.filter(o => want.has(o.id));
  for (const o of list) if (o.def.k === 'unknown') return { error: '选中的对象里有新版暂不支持的内容，不能做成工具' };
  const order = new Map(list.map((o, i) => [o.id, i + 1] as const));
  const prereq: Id[] = [];
  for (const o of list) {
    if (parentsOf(o.def).length) continue;
    if (o.def.k !== 'free' && o.def.k !== 'param') return { error: '前提条件目前只支持自由点和参数；选中的对象依赖其它独立对象' };
    prereq.push(order.get(o.id)!);
  }
  if (!prereq.length) return { error: '选中的对象没有可用的前提条件' };
  const map = new Map(order);
  const objects = list.map((o): Obj => {
    const def = remapDef(JSON.parse(JSON.stringify(o.def)), map);
    return { id: order.get(o.id)!, def: o.def.k === 'free' ? { k: 'free', x: 0, y: 0 } : def, style: { ...o.style }, hidden: sel.has(o.id) ? o.hidden : true, labelShown: !!o.toolLabel && o.labelShown, ...(o.toolLabel ? { toolLabel: true } : {}), ...(o.toolLabel && o.label ? { label: o.label } : {}), ...(o.trace ? { trace: true } : {}), ...(o.at ? { at: { ...o.at } } : {}) };
  });
  return { objects, prereq };
}
