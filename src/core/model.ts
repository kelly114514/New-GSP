/** 文档模型：文档 → 页 → 对象。对象用稳定的内部 ID 互相引用，文件中的序号由编解码层映射。 */
import type { Pt } from './geom';
import type { Expr } from './expr';

export type Id = number;
export type Dash = 'solid' | 'dash' | 'dot';
export type UnitKind = 'none' | 'angle' | 'distance';

export interface Style {
  color: string;        // #rrggbb
  pointSize: number;    // 1..4（最小…最大）
  width: number;        // 1..4（极细…粗线）
  dash: Dash;
  fillAlpha?: number;
}

/** 对象定义；每个 k 对应一种构造或度量，字段全是父对象 ID 或标量参数。 */
export type Def =
  // 点
  | { k: 'free'; x: number; y: number }
  | { k: 'onpath'; path: Id; t: number; abs?: boolean; edge?: number }   // edge 存在时 t 是该边的比例。abs 表示线上的页面像素。
  | { k: 'mid'; seg: Id }
  | { k: 'inter'; a: Id; b: Id; branch: number; alternate?: true } // 原版工具的线圆、圆圆求交在首选分支无定义时尝试另一支
  | { k: 'translate'; src: Id; by: TranslateBy }
  | { k: 'rotate'; src: Id; center: Id; angle: AngleBy }
  | { k: 'dilate'; src: Id; center: Id; ratio: RatioBy }
  | { k: 'reflect'; src: Id; mirror: Id }
  | { k: 'axispt'; axis: 'x' | 'y'; value: Id; sys: Id }           // 在轴上按数值画点（原版 109/110）
  | { k: 'plotfix'; sys: Id; x: number; y: number }                // 按坐标系里的固定坐标画点（原版 67）
  | { k: 'plotxy'; x: Id; y: Id; sys: Id; polar?: boolean }                       // 绘制点 (x, y) 或 (r, θ)
  | { k: 'pointval'; path: Id; value?: Id; fixed?: number }   // 值取自数值对象，或固定值（原版 123）                        // 在路径上绘制点（值）
  | { k: 'combine'; src: Id; path: Id }                           // 合并点到路径后的点（与 onpath 同义保留）
  // 线型
  | { k: 'seg' | 'ray' | 'line'; a: Id; b: Id }
  | { k: 'parallel' | 'perp'; pt: Id; line: Id }
  | { k: 'bisect'; a: Id; v: Id; b: Id }
  | { k: 'circle'; c: Id; p: Id }
  | { k: 'circle-seg'; c: Id; seg: Id }
  | { k: 'arc-circle'; circle: Id; a: Id; b: Id }
  | { k: 'arc3'; a: Id; b: Id; c: Id }
  | { k: 'arc-center'; c: Id; a: Id; b: Id }
  | { k: 'axis-line'; axis: 'x' | 'y'; origin?: Id; unit: Id; mode: 'distance' | 'circle'; pi?: true }
  | { k: 'axis-unit'; axis: Id; origin?: Id; distance?: number; direction: 'x' | 'y' }
  | { k: 'colorize'; src: Id; params: Id[]; mode: 'color' | 'gray' | 'rgb' | 'hsv'; cycle: 'none' | 'one' | 'two'; from: number; to: number }
  | { k: 'custom-point'; src: Id; pre: Id; img: Id; body: Id[] }
  | { k: 'angle-mark'; a: Id; v: Id; b: Id; count: number; mode?: AngleMarkMode; appearance?: { size: number; flags: number; reserved: number; fill: number } }
  | { k: 'segment-mark'; seg: Id; t: number; count: number; mode: 'tick' | 'arrow' | 'filled' }
  // 区域
  | { k: 'poly'; pts: Id[] }
  | { k: 'circle-int'; circle: Id }
  | { k: 'arc-int'; arc: Id; mode: 'sector' | 'segment' }
  // 轨迹与函数图像
  | { k: 'locus'; driver: Id; out: Id; samples: number; path?: Id; pathRange?: [number, number]; colored?: true; parameter?: { range: [number, number]; shapes?: true } }
  | { k: 'plot'; func: Id; sys: Id; lo?: number; hi?: number; samples: number }
  // 参数曲线：点 (f(t), g(t))（polar 时是 (r, α)，α 无单位时按弧度），t 在 lo..hi 取样
  | { k: 'pcurve'; fx: Id; fy: Id; sys: Id; lo: number; hi: number; polar: boolean; samples: number }
  // 度量
  | { k: 'measure'; m: MeasureKind; refs: Id[] }
  // 数据
  | { k: 'param'; name: string; value: number; unit: UnitKind; showEdit: boolean }
  | { k: 'calc'; expr: Expr; unit: UnitKind }
  // 绘图函数（图片函数）：手绘的一笔在坐标系里的 y(x)（原版采集 probe_pic：方法 122）
  | { k: 'picfunc'; stroke: Id; sys: Id; profile?: Pt[][]; height?: true; heightRaster?: string }
  | { k: 'func'; name: string; expr: Expr; param: string; derivativeOf?: Id; form?: FuncForm; symbol?: boolean }   // form 缺省为 y=f(x)；symbol：显示成“y = …”而不是“f(x) = …”
  | { k: 'table'; cols: Id[]; rows: number[][]; showEdit?: boolean }
  | { k: 'sys'; origin: Id; unitX: Id; unitY: Id; axisX: Id; axisY: Id; grid: GridStyle; showGrid: boolean; snap: boolean; gridPoints?: true; shift?: number; piX?: true; piY?: true }
  // 杂项
  | { k: 'text'; text: string; at: Pt; w: number; h: number; anchor?: Id; off?: Pt; font: FontSpec; runs?: TextRun[]; refs?: Id[]; math?: import('../gsp/richtext').RichNode; mathText?: string }   // math：含分数、上下标、根号的原版标记结构，text 未改动（等于 mathText）时按它排版   // 附着在点上时位置 = 点 + off；文字里的 k 显示 refs[k] 的数值
  | { k: 'button'; action: ButtonAction; text: string; at: Pt; w: number; h: number }
  | { k: 'image'; data: string; mime: string; at: Pt; w: number; h: number; affine?: import('./image').Affine; clip?: Id; placement?: ImagePlacement }
  | { k: 'image-clip'; src: Id; clip: Id; size: [number, number, number, number] }
  // 自定义变换作用于图片（原版方法 96）：在源图片上取样，把驱动点 pre 放到各取样位置，象点 img 的位置就是该处像素的去处。
  // samples 是采样数，distortion 是允许失真度（0 无 … 1 全部）。
  | { k: 'custom-image'; src: Id; pre: Id; img: Id; body: Id[]; samples: number; distortion: number }
  | { k: 'stroke'; pts: Pt[] }
  // 迭代：pre 是前像（点或数值），maps[j][i] 是第 j 个映射里 pre[i] 的初象，body 是前像的后代里目标和初象依赖的那部分（顺序不重要）
  | { k: 'iterate'; pre: Id[]; maps: Id[][]; body: Id[]; depth: { fixed: number } | { param: Id }; finalOnly?: boolean; salt?: number; random?: true }   // random：前像中的路径点每层取随机位置
  // 迭代象：迭代 iter 把 src 在各次迭代里的像都画出来
  | { k: 'iterimg'; src: Id; iter: Id }
  // 迭代数据表：第一列是迭代序号（列名固定是 n，原版互读时用参数 k 验证过），其后每列是一个数值初象在各层状态下的值（原版采集 probe_itertable：方法 92）
  | { k: 'itertable'; iter: Id; cols: Id[] }
  // 迭代象（点）的最后一个像：度量迭代象上的点时原版建的辅助点
  | { k: 'iterpt'; img: Id }
  | { k: 'unknown'; note: string };

/** 固定数值或某个度量/参数对象的值。 */
export type Num = { fixed: number } | { m: Id } | { pts: [Id, Id, Id] };
export type TranslateBy =
  | { mode: 'vector'; from: Id; to: Id }
  | { mode: 'polar'; dist: Num; angle: Num }                         // 固定值（cm / 度）或度量 ID
  | { mode: 'rect'; dx: number; dy: number; dxBy?: Id; dyBy?: Id };   // dxBy/dyBy：水平/垂直距离取自标记距离
export type AngleBy = { mode: 'fixed'; deg: number } | { mode: 'marked'; a: Id; v: Id; b: Id } | { mode: 'value'; m: Id } | { mode: 'mark'; m: Id };
export type AngleMarkMode = 'minor' | 'reflex' | 'ccw' | 'cw';
export type ImagePlacement =
  | { kind: 'center'; center: Id; sx: number; sy: number; angle: number }
  | { kind: 'corners'; pts: [Id, Id] | [Id, Id, Id] };
export type RatioBy = { mode: 'fixed'; num: number; den: number } | { mode: 'marked'; a: Id; b: Id; c?: Id } | { mode: 'value'; m: Id };
export type GridStyle = 'square' | 'rect' | 'polar' | 'tri';
export type FuncForm = 'y=f(x)' | 'x=f(y)' | 'r=f(t)' | 't=f(r)';

export type MeasureKind =
  | 'length' | 'distance' | 'perimeter' | 'circumference' | 'angle' | 'markedangle' | 'area' | 'arcangle' | 'arclength' | 'radius' | 'ratio' | 'pointvalue'
  | 'coords' | 'abscissa' | 'ordinate' | 'coorddist' | 'coordradius' | 'coordangle' | 'slope' | 'equation';

export type ButtonAction =
  | { type: 'hideshow'; targets: Id[]; mode: 'toggle' | 'show' | 'hide'; first?: 'hide' | 'show'; fade?: boolean; select?: boolean }   // toggle 时 first 是当前将执行的动作；fade/select 缺省为 true（原版默认）
  | { type: 'animate'; targets: Id[]; speed: 'slow' | 'medium' | 'fast' | number; direction: 'forward' | 'backward' | 'bounce' | 'random'; once?: boolean; stopMode?: 'toggle' }
  | { type: 'move'; from: Id; to: Id; pairs?: [Id, Id][]; speed: 'slow' | 'medium' | 'fast' | 'high'; toInitial?: boolean; legacyFinal?: true }
  | { type: 'link'; page: number; url?: string }      // url 存在时是超链接按钮（page 无意义）
  | { type: 'scroll'; point: Id; where: 'topleft' | 'center' }
  | { type: 'sound'; funcs: Id[] }      // 声音按钮：函数当波形播放（原版采集 probe_misc2：A=8）
  | { type: 'series'; buttons: Id[]; mode: 'together' | 'seq'; deselect?: boolean; stopAnim?: boolean; clearTraces?: boolean; after?: 'last' | 'first' | 'duration'; seconds?: number }   // 系列按钮：执行其它按钮的动作；seconds 在“依序”时是动作之间的暂停，在“持续时间”时是总时长

export interface FontSpec { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string }
/** 文本段按顺序拼接后等于 text；样式完整保存，避免受默认字体后续修改影响。 */
export interface TextRun { text: string; font: FontSpec }
/** 私用区标记中的数字是 refs 下标。A 显示标签，D 显示带运算符的数值。 */
export const TEXT_REF = /(\d+)(?::([AD]))?/g;
export const VALUE_DISPLAYS = ['expression', 'number', 'equals', 'label'] as const;
export type ValueDisplay = typeof VALUE_DISPLAYS[number];
export const AUTO_MEASURE_NAME = /^m\[\d+\]$/;

export interface Obj {
  id: Id;
  def: Def;
  style: Style;
  hidden: boolean;
  label?: string;
  labelShown: boolean;
  /** 创建工具时保留该对象的标签；新版规则，原版对应位尚待确认。 */
  toolLabel?: boolean;
  labelDx?: number; labelDy?: number;
  /** 属性里取消“可以被选中”：单击和框选都选不到。 */
  unselectable?: boolean;
  trace?: boolean;
  /** 按参数着色：显示颜色随参数值变化（颜色 → 参数…）。 */
  colorBy?: ColorBy;
  /** 显示精度（小数位数）；来自文件的参数、计算。缺省用文档选项。 */
  decimals?: number;
  /** 原版度量和计算的数值显示方式。 */
  valueDisplay?: ValueDisplay;
  /** 度量值、参数、计算、表格等文字型对象在页面上的位置。 */
  at?: Pt;
  /** 数值、按钮和表格的独立字体；不支持原版编码时由保存完整性检查保护。 */
  font?: FontSpec;
  anim?: AnimDef;               // 此对象上的动画设置（路径点/参数）
  /** 来自文件的原始记录，供编码层原样写回（未知字段）。 */
  src?: unknown;
}

export function defaultValueDisplay(o: Obj): ValueDisplay {
  return o.label && (o.hidden || o.toolLabel || !AUTO_MEASURE_NAME.test(o.label)) ? 'label' : 'expression';
}

export interface CustomTransform { name: string; src: Id; img: Id }
export interface ColorBy { param: Id; from: number; to: number; mode: 'color' | 'gray'; cycle: 'none' | 'one' | 'two' }
export interface AnimDef { speed: 'slow' | 'medium' | 'fast' | number; direction: 'forward' | 'backward' | 'bounce' | 'random' }

export interface Page {
  name: string;
  objects: Obj[];
  nextId: Id;
  labelCounter: number;      // 点标签的分配序号（不回收）
  /** 原版页级自动吸附；未设置时兼容早期新版课件中坐标系的 snap。 */
  autoSnap?: boolean;
  /** 原版可为不同页面保存不同的显示设置；未提供的项目继承文档设置。 */
  display?: Partial<DisplayPrefs>;
  /** 自定义变换：由原象点 src 到象点 img 的一串构造，可以重放到别的对象上（原版采集：文件里记 9009）。 */
  transforms?: CustomTransform[];
  /** 原版文件打开时触发的操作按钮，按文件记录顺序。 */
  startupButtons?: Id[];
  scroll: Pt;
  /** 本页绘图区背景色（原版每页有自己的颜色表 10020，第 7 项）；缺省用文档显示设置。 */
  background?: string;
}

export interface DocSettings {
  gridShown: boolean;
  autoLabelPoints: boolean;
  fillPolygonBorders: boolean;
  /** 单位、精度、颜色等显示设置（参数选项“当前画板”）；缺省时用程序设置。 */
  display?: DisplayPrefs;
  /** 文档选项的“显示页切换”；缺省为显示。 */
  showPageTabs?: boolean;
}

/** 文本样式的六个类别（参数选项 → 文本 → 改变对象属性…，原版采集 probe_misc2）。 */
export type TextCat = 'label' | 'title' | 'value' | 'button' | 'table' | 'axis';
export interface TextStyle { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string }
export const TEXT_CATS: [TextCat, string][] = [['label', '标签'], ['title', '标题'], ['value', '数值&函数'], ['button', '操作类按钮'], ['table', '表格'], ['axis', '坐标轴上的数字']];
/** 原版对话框里各类别的出厂样式；px 是新版当前画出来的像素大小（已与原版像素对照），改样式时按大小比例缩放。 */
export const TEXT_DEFAULTS: Record<TextCat, { style: TextStyle; px: number }> = {
  label: { style: { name: 'Times New Roman', size: 24, bold: true, italic: false, underline: false, color: '#000000' }, px: 24 },
  title: { style: { name: 'Times New Roman', size: 16, bold: false, italic: false, underline: false, color: '#000000' }, px: 16 },
  value: { style: { name: 'Arial', size: 18, bold: false, italic: false, underline: false, color: '#000000' }, px: 18 },
  button: { style: { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' }, px: 16 },
  table: { style: { name: 'Arial', size: 14, bold: false, italic: false, underline: false, color: '#000000' }, px: 14 },
  axis: { style: { name: 'Arial', size: 14, bold: false, italic: false, underline: false, color: '#404040' }, px: 11 },
};
export interface DisplayPrefs {
  angleUnit: 'deg' | 'rad' | 'dir'; anglePrec: number;
  distUnit: 'cm' | 'in' | 'px'; distPrec: number;
  otherPrec: number;
  background: string; selected: string;
  mathItalic: boolean;
  /** 显示设置来自原版文件；未找到可靠记录的数学标签斜体选项继承程序默认值。用户修改后去掉标记。 */
  fromFile?: boolean;
  /** 与出厂样式不同的那些项；没有的类别按原样画。 */
  textStyles?: Partial<Record<TextCat, Partial<TextStyle>>>;
}
export const DEFAULT_DISPLAY: DisplayPrefs = { angleUnit: 'deg', anglePrec: 2, distUnit: 'cm', distPrec: 2, otherPrec: 2, background: '#ffffff', selected: '#d000d0', mathItalic: true };

export function pageDisplay(doc: Doc, page: Page, fallback: DisplayPrefs = DEFAULT_DISPLAY): DisplayPrefs {
  const source = doc.settings.display;
  // 原版文本样式表记录的是标签字体的斜体，不能据此推断程序的“数学标签用斜体”选项。
  return { ...DEFAULT_DISPLAY, ...fallback, ...source, ...(source?.fromFile ? { mathItalic: fallback.mathItalic } : {}), ...page.display };
}

/** 文档内嵌的自定义工具：文件里的 1002…1003 记录原样保存（base64），要用时再解析；序号都是工具内部的 1 起序号。 */
export interface EmbeddedTool { name: string; prereq: number[]; comment?: string; data: string; legacy?: true }

export interface Doc {
  pages: Page[];
  /** 随文档保存的自定义工具（原版把它们放在所有页之后）。 */
  tools?: EmbeddedTool[];
  current: number;
  name: string;
  settings: DocSettings;
  /** 页面设置（单位 0.1mm 无关；用纸方向/边距）。 */
  paper: { landscape: boolean; marginMm: number; size?: string };
}

export const DEFAULT_COLORS = {
  point: '#ff0000', dependentPoint: '#ff0000', line: '#000080', circle: '#008000', arc: '#008000', interior: '#ffff00', text: '#000000', measure: '#606060', locus: '#000080', plot: '#000080',
  /** 新建内部用随机颜色（程序设置；核心默认关闭，保证构造可重复）。 */
  randomInterior: false, interiorAlpha: 0.5,
};
const randomInteriorColor = () => { const h = Math.random() * 6, f = h - Math.floor(h), v = [255, Math.round(255 * (1 - f)), 96, Math.round(96 + 159 * f)], i = Math.floor(h); const rgb = [[0, 3, 2], [1, 0, 2], [2, 0, 3], [2, 1, 0], [3, 2, 0], [0, 2, 1]][i].map(k => v[k]); return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`; };

export function defaultStyle(def: Def): Style {
  const base: Style = { color: '#000000', pointSize: 2, width: 2, dash: 'solid' };
  switch (def.k) {
    case 'free': case 'onpath': case 'mid': case 'inter': case 'translate': case 'rotate': case 'dilate': case 'reflect': case 'plotxy': case 'plotfix': case 'axispt': case 'pointval': case 'combine': case 'iterpt':
      return { ...base, color: DEFAULT_COLORS.point };
    case 'seg': case 'ray': case 'line': case 'parallel': case 'perp': case 'bisect': return { ...base, color: DEFAULT_COLORS.line };
    case 'circle': case 'circle-seg': case 'arc-circle': case 'arc3': return { ...base, color: DEFAULT_COLORS.circle };
    case 'poly': case 'circle-int': case 'arc-int': return { ...base, color: DEFAULT_COLORS.randomInterior ? randomInteriorColor() : DEFAULT_COLORS.interior, fillAlpha: DEFAULT_COLORS.interiorAlpha };
    case 'locus': return { ...base, color: DEFAULT_COLORS.locus };
    case 'plot': return { ...base, color: DEFAULT_COLORS.plot };
    case 'pcurve': return { ...base, color: '#800080' };
    case 'button': return { ...base, color: '#ff8000' };   // 原版新建按钮的缺省颜色（全库按钮对象头里最常见的值）
    case 'iterate': return { ...base, color: '#ff00ff', pointSize: 1 };
    default: return base;
  }
}

export function emptyPage(name = '1'): Page { return { name, objects: [], nextId: 1, labelCounter: 0, scroll: { x: 0, y: 0 } }; }
export function newDoc(name = '未命名1'): Doc {
  return { pages: [emptyPage()], current: 0, name, settings: { gridShown: false, autoLabelPoints: false, fillPolygonBorders: false }, paper: { landscape: false, marginMm: 10 } };
}

export const page = (d: Doc) => d.pages[d.current];
export const pageAutoSnap = (p: Page): boolean => p.autoSnap ?? p.objects.some(o => o.def.k === 'sys' && o.def.snap);
/**
 * 按 ID 取对象。求值和绘制每帧调用很多次，线性查找会让大课件的拖动变成 O(n²)，所以按数组建索引。
 * 对象数组会被就地 push/pop/替换：长度变了就重建；命中后再核对 ID；没命中时退回线性查找，保证结果与 find 一致。
 */
const idIndex = new WeakMap<Obj[], { len: number; at: Map<Id, number> }>();
export function byId(p: Page, id: Id): Obj | undefined {
  const objs = p.objects;
  let ix = idIndex.get(objs);
  if (!ix || ix.len !== objs.length) {
    const at = new Map<Id, number>();
    for (let i = objs.length - 1; i >= 0; i--) at.set(objs[i].id, i);   // 倒序：重复 ID 时第一个优先，和 find 相同
    idIndex.set(objs, ix = { len: objs.length, at });
  }
  const i = ix.at.get(id);
  if (i !== undefined && objs[i].id === id) return objs[i];
  return objs.find(o => o.id === id);
}

/** 一个定义直接依赖的对象 ID（顺序与文件中父对象顺序一致）。 */
export function parentsOf(d: Def): Id[] {
  switch (d.k) {
    case 'free': case 'param': case 'text': case 'button': case 'stroke': case 'unknown': return d.k === 'text' ? (d.anchor ? [d.anchor, ...(d.refs ?? [])] : d.refs ?? []) : d.k === 'button' ? buttonRefs(d.action) : [];
    case 'image': {
      const placement = d.placement;
      const pts = placement?.kind === 'center' ? [placement.center] : placement?.pts ?? [];
      return d.clip === undefined ? pts : [...pts, d.clip];
    }
    case 'image-clip': return [d.src, d.clip];
    case 'custom-image': return [d.src, d.pre, d.img, ...d.body];
    case 'onpath': return [d.path];
    case 'mid': return [d.seg];
    case 'inter': return [d.a, d.b];
    case 'translate': return [d.src, ...(d.by.mode === 'vector' ? [d.by.from, d.by.to] : []), ...(d.by.mode === 'polar' ? [d.by.dist, d.by.angle].flatMap(n => ('m' in n ? [n.m] : 'pts' in n ? n.pts : [])) : []), ...(d.by.mode === 'rect' ? [d.by.dxBy, d.by.dyBy].filter((x): x is Id => x !== undefined) : [])];
    case 'rotate': return [d.src, d.center, ...(d.angle.mode === 'marked' ? [d.angle.a, d.angle.v, d.angle.b] : 'm' in d.angle ? [d.angle.m] : [])];
    case 'dilate': return [d.src, d.center, ...(d.ratio.mode === 'marked' ? [d.ratio.a, d.ratio.b, ...(d.ratio.c !== undefined ? [d.ratio.c] : [])] : d.ratio.mode === 'value' ? [d.ratio.m] : [])];
    case 'reflect': return [d.src, d.mirror];
    case 'colorize': return [d.src, ...d.params];
    case 'custom-point': return [d.src, d.pre, d.img, ...d.body];
    case 'angle-mark': return [d.a, d.v, d.b];
    case 'segment-mark': return [d.seg];
    case 'axis-line': return [...(d.origin !== undefined ? [d.origin] : []), d.unit];
    case 'axis-unit': return [d.axis, ...(d.origin !== undefined ? [d.origin] : [])];
    case 'plotxy': return [d.x, d.y, d.sys];
    case 'plotfix': return [d.sys];
    case 'axispt': return [d.value, d.sys];
    case 'pointval': return d.value !== undefined ? [d.path, d.value] : [d.path];
    case 'combine': return [d.src, d.path];
    case 'seg': case 'ray': case 'line': return [d.a, d.b];
    case 'parallel': case 'perp': return [d.pt, d.line];
    case 'bisect': return [d.a, d.v, d.b];
    case 'circle': return [d.c, d.p];
    case 'circle-seg': return [d.c, d.seg];
    case 'arc-circle': return [d.circle, d.a, d.b];
    case 'arc3': return [d.a, d.b, d.c];
    case 'arc-center': return [d.c, d.a, d.b];
    case 'poly': return [...d.pts];
    case 'circle-int': return [d.circle];
    case 'arc-int': return [d.arc];
    case 'locus': return [d.driver, d.out, ...(d.path === undefined ? [] : [d.path])];
    case 'plot': return [d.func, d.sys];
    case 'pcurve': return [d.fx, d.fy, d.sys];
    case 'picfunc': return [d.stroke, d.sys];
    case 'measure': return [...d.refs];
    case 'calc': return exprRefs(d.expr);
    case 'func': return d.derivativeOf !== undefined ? [d.derivativeOf] : exprRefs(d.expr);
    case 'table': return [...d.cols];
    case 'sys': return [d.origin, d.unitX, d.unitY, d.axisX, d.axisY];
    case 'iterate': return [...('param' in d.depth ? [d.depth.param] : []), ...d.pre, ...d.maps.flat(), ...d.body];
    case 'iterimg': return [d.src, d.iter];
    case 'itertable': return [d.iter, ...d.cols];
    case 'iterpt': return [d.img];
  }
}

function buttonRefs(a: ButtonAction): Id[] {
  switch (a.type) {
    case 'hideshow': case 'animate': return [...a.targets];
    case 'move': return [a.from, a.to, ...(a.pairs ?? []).flat()];
    case 'scroll': return [a.point];
    case 'sound': return [...a.funcs];
    case 'series': return [...a.buttons];
    default: return [];
  }
}

import { exprRefs } from './expr';

export function childrenOf(p: Page, id: Id): Obj[] { return p.objects.filter(o => parentsOf(o.def).includes(id)); }

/** 传递闭包：依赖于 ids 中任何一个对象的所有对象 ID（不含 ids 自身）。 */
export function descendants(p: Page, ids: Iterable<Id>): Set<Id> {
  const set = new Set<Id>(ids), out = new Set<Id>();
  for (const o of p.objects) {
    if (set.has(o.id)) continue;
    if (parentsOf(o.def).some(x => set.has(x))) { set.add(o.id); out.add(o.id); }
  }
  return out;
}

export function ancestors(p: Page, ids: Iterable<Id>): Set<Id> {
  const want = new Set<Id>(), out = new Set<Id>();
  const map = new Map(p.objects.map(o => [o.id, o]));
  const visit = (id: Id) => { for (const par of parentsOf(map.get(id)?.def ?? { k: 'unknown', note: '' })) if (!out.has(par)) { out.add(par); visit(par); } };
  for (const id of ids) { want.add(id); visit(id); }
  return out;
}

export const isPointDef = (d: Def) => ['free', 'onpath', 'mid', 'inter', 'translate', 'rotate', 'dilate', 'reflect', 'plotxy', 'plotfix', 'axispt', 'axis-unit', 'pointval', 'combine', 'iterpt', 'custom-point'].includes(d.k);
export const isStraightDef = (d: Def) => ['seg', 'ray', 'line', 'parallel', 'perp', 'bisect', 'axis-line'].includes(d.k);
export const isCircleDef = (d: Def) => d.k === 'circle' || d.k === 'circle-seg';
export const isArcDef = (d: Def) => d.k === 'arc-circle' || d.k === 'arc3' || d.k === 'arc-center';
export const isInteriorDef = (d: Def) => d.k === 'poly' || d.k === 'circle-int' || d.k === 'arc-int';
export const isPathDef = (d: Def) => isStraightDef(d) || isCircleDef(d) || isArcDef(d) || isInteriorDef(d) || d.k === 'locus' || d.k === 'plot' || d.k === 'pcurve';
export const isMeasureDef = (d: Def) => d.k === 'measure' || d.k === 'param' || d.k === 'calc';
export const isGeometryDef = (d: Def) => isPointDef(d) || isPathDef(d);
