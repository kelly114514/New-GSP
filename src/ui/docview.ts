/** 单个文档窗口：画布、选择、工具交互。几何运算全部在 core 里，这里只做输入到命令的翻译。 */
import { classOf, constructLines, constructInterior, constructPointOnPath, dragSysUnit, type Marks } from '../core/construct';
import * as G from '../core/geom';
import type { Pt } from '../core/geom';
import { hitAll, hitRect, hitRadii, nearestPointId, normRect, view as hitView, type Power, type Rect } from '../core/hit';
import { isLine, projectToPath, projectOnPath, toSys, fromSys } from '../core/engine';
import { byId, type Id, type Obj, type FontSpec, type TextRun } from '../core/model';
import { fontAt, replaceText, styleRange } from '../core/text-runs';
import { Store } from '../core/store';
import { toolInputFromHits, toolInputLabel, acceptsInput, applyTool, type Tool } from '../core/tooling';
import { applyDisplay, clipStraight, drawPage, drawPoint, typeName, wrap, imageLoaded, embeddedButtonAt } from './render';
import { DEFAULT_DISPLAY, type Page } from '../core/model';
import type { Results } from '../core/engine';
import type { App } from '../app';

export type ToolId = 'move' | 'rotate' | 'scale' | 'point' | 'circle' | 'segment' | 'ray' | 'line' | 'poly-fill' | 'poly-both' | 'poly-edges' | 'text' | 'marker' | 'info' | 'custom';
export const CONSTRUCT_TOOLS: ToolId[] = ['point', 'circle', 'segment', 'ray', 'line'];

type Snap = { kind: 'point'; id: Id } | { kind: 'path'; id: Id; p: Pt } | { kind: 'free'; p: Pt };

interface Drag {
  mode: 'none' | 'object' | 'box' | 'construct' | 'poly' | 'text-box' | 'stroke' | 'transform';
  start: Pt; cur: Pt; moved: boolean; shift: boolean;
  down?: { id: Id; wasSelected: boolean };
  base?: Map<Id, { x: number; y: number }>;      // 拖动前自由点坐标
  baseT?: Map<Id, number>;
  first?: Snap;
  rect?: Rect;
  stroke?: Pt[];
  center?: Pt;
  textId?: Id;
  /** 拖动文字型对象（度量值、参数、文本、按钮、图片、表格）时它们的起始位置。 */
  boxes?: Map<Id, Pt>;
  /** 正在拖动坐标系的单位点。 */
  unit?: { sys: Id; point: Id };
}

/** 文字型对象：有自己的页面位置，拖动时只改位置，不牵动父对象。 */
/** 双击标记指示动画时长（毫秒）。原版实测约 0.4–0.45 秒（连拍 10 帧，间隔约 40 ms）。 */
const MARK_FX_MS = 450;
/** 直线型对象落在视图里的可见部分（线段取全长，射线从端点起，直线两头到视图边），完全在外面则 undefined。 */
function visibleSpan(s: { a: Pt; b: Pt; ext: G.Extent }, r: Rect): [Pt, Pt] | undefined {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  let t0 = s.ext === 'line' ? -Infinity : 0, t1 = s.ext === 'segment' ? 1 : Infinity;
  for (const [p, q] of [[-dx, s.a.x - r.x0], [dx, r.x1 - s.a.x], [-dy, s.a.y - r.y0], [dy, r.y1 - s.a.y]] as const) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  return t0 > t1 ? undefined : [{ x: s.a.x + dx * t0, y: s.a.y + dy * t0 }, { x: s.a.x + dx * t1, y: s.a.y + dy * t1 }];
}
const BOXY = new Set(['measure', 'table', 'text', 'button', 'image', 'func']);
const isBoxy = (o: Obj) => BOXY.has(classOf(o));
const boxAt = (o: Obj): Pt | undefined => (o.def.k === 'text' || o.def.k === 'button' || o.def.k === 'image' ? (o.def.k === 'text' && o.def.anchor !== undefined ? o.def.off : o.def.at) : o.at);

export class DocView {
  readonly el = document.createElement('div');
  readonly canvas = document.createElement('canvas');
  readonly trace = document.createElement('canvas');
  readonly overlay = document.createElement('canvas');
  readonly title = document.createElement('div');
  store: Store;
  sel: Id[] = [];
  marks: Marks = {};
  /** 双击标记后的指示动画状态（只在预览层绘制，不属于文档）。 */
  private markFx?: { kind: 'center' | 'mirror'; id: Id; t0: number };
  path?: string;
  /** 恢复快照的名字（每个窗口唯一）。 */
  readonly rid = `doc-${Math.random().toString(36).slice(2, 10)}`;
  tool: ToolId = 'move';
  /** 自定义工具已经点选的前提条件（对象 ID，按点选顺序）。 */
  toolPicks: (Id | undefined)[] = [];
  private drag: Drag = { mode: 'none', start: { x: 0, y: 0 }, cur: { x: 0, y: 0 }, moved: false, shift: false };
  private poly: Id[] = [];
  /** 作图工具单击放下的起点：下一次单击连到这里（线段、射线、直线、圆都可以“点两下”作图）。 */
  private pendingFirst?: Id;
  /** 对话框里的变换预览（浅色画在预览层）。 */
  ghost?: { page: Page; results: Results };
  private hoverId?: Id;
  private bubbles: { at: Pt; text: string; age: number }[] = [];
  private raf = 0;
  private pointer: Pt = { x: 0, y: 0 };
  private tracedLast = new Map<Id, string>();
  private disposed = false;
  private stopStore: () => void;
  private resizeObserver: ResizeObserver;
  private onImageLoaded = () => this.invalidate();
  textEdit?: { id: Id; ta: HTMLTextAreaElement; runs: TextRun[]; originalRuns?: TextRun[]; composing: boolean };
  /** 迭代面板等：打开时接管画板上的单击（返回 true 表示已处理）。 */
  pickHook?: (p: Pt) => boolean;
  scroll: Pt = { x: 0, y: 0 };
  tChanges = new Map<Id, number>();       // 动画运行时覆盖（不写入定义）

  constructor(public app: App, store: Store) {
    this.store = store;
    this.el.className = 'docwin';
    this.title.className = 'doctitle';
    this.canvas.className = 'cv'; this.trace.className = 'cv'; this.overlay.className = 'cv';
    const box = document.createElement('div'); box.className = 'cvbox';
    box.append(this.trace, this.canvas, this.overlay);
    // 文档窗口右侧、底部的滚动条（原版空白文档也显示）
    const wrap = document.createElement('div'); wrap.className = 'cvwrap';
    this.sbV.className = 'sb sbv'; this.sbH.className = 'sb sbh';
    this.sbV.append(this.sbVin); this.sbH.append(this.sbHin);
    const corner = document.createElement('div'); corner.className = 'sbcorner';
    wrap.append(box, this.sbV, this.sbH, corner);
    this.el.append(this.title, wrap);
    this.sbV.addEventListener('scroll', () => this.onBar());
    this.sbH.addEventListener('scroll', () => this.onBar());
    this.bind(this.overlay);
    this.scroll = { ...(store.page.scroll ?? { x: 0, y: 0 }) };
    let shownPage = store.doc.current;
    this.stopStore = store.on(() => {
      if (store.doc.current !== shownPage) { shownPage = store.doc.current; this.scroll = { ...(store.page.scroll ?? { x: 0, y: 0 }) }; this.updateView(); this.eraseTraces(); }
      this.invalidate();
    });
    imageLoaded.add(this.onImageLoaded);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(box);
  }

  dispose() {
    this.disposed = true;
    this.stopStore();
    imageLoaded.delete(this.onImageLoaded);
    this.resizeObserver.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const c of [this.canvas, this.trace, this.overlay]) { c.width = 1; c.height = 1; }
  }

  private sbV = document.createElement('div');
  private sbH = document.createElement('div');
  private sbVin = document.createElement('div');
  private sbHin = document.createElement('div');
  private barMin: Pt = { x: 0, y: 0 };
  private barSync = false;

  /** 滚动范围：内容范围与当前视图的并集，四周留些余量。 */
  private syncBars() {
    const vr = this.viewRect(), w = vr.x1 - vr.x0, h = vr.y1 - vr.y0;
    let x0 = Math.min(0, vr.x0), y0 = Math.min(0, vr.y0), x1 = Math.max(w, vr.x1), y1 = Math.max(h, vr.y1);
    const grow = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // 发散迭代可得到极大的有限坐标；滚动条不能按这些值分配原生布局范围。
      x = Math.max(vr.x0 - 1e6, Math.min(vr.x1 + 1e6, x));
      y = Math.max(vr.y0 - 1e6, Math.min(vr.y1 + 1e6, y));
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    for (const o of this.store.page.objects) {
      if (o.hidden) continue;
      const s = this.store.results.get(o.id)?.shape;
      if (s?.k === 'pt') grow(s.p.x, s.p.y);
      else if (s?.k === 'box') { grow(s.at.x, s.at.y); grow(s.at.x + s.w, s.at.y + s.h); }
      else if (s?.k === 'circle') { grow(s.c.c.x - s.c.r, s.c.c.y - s.c.r); grow(s.c.c.x + s.c.r, s.c.c.y + s.c.r); }
      else if (o.at) grow(o.at.x, o.at.y);
    }
    this.barMin = { x: x0, y: y0 };
    this.barSync = true;
    this.sbVin.style.height = `${Math.ceil(y1 - y0)}px`; this.sbHin.style.width = `${Math.ceil(x1 - x0)}px`;
    this.sbV.scrollTop = this.scroll.y - y0; this.sbH.scrollLeft = this.scroll.x - x0;
    this.barSync = false;
  }
  private onBar() {
    if (this.disposed || this.barSync) return;
    const nx = this.barMin.x + this.sbH.scrollLeft, ny = this.barMin.y + this.sbV.scrollTop;
    if (Math.abs(nx - this.scroll.x) < 0.5 && Math.abs(ny - this.scroll.y) < 0.5) return;
    this.scroll = { x: nx, y: ny }; this.updateView(); this.eraseTraces(); this.invalidate();
  }

  get dpr() { return window.devicePixelRatio || 1; }
  get power(): Power { return this.app.settings.power; }
  get box() { return this.canvas.parentElement!; }

  resize() {
    if (this.disposed) return;
    const r = this.box.getBoundingClientRect(), d = this.dpr;
    hitView.zoom = d;
    for (const c of [this.canvas, this.trace, this.overlay]) {
      c.style.width = `${r.width}px`; c.style.height = `${r.height}px`;
      const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    this.updateView();
    this.invalidate();
  }
  /** 页面坐标：1 单位 = 1 个 96 dpi 的逻辑像素（CSS 像素），和原版文件里的坐标一致；屏幕缩放 150% 时画出来是 1.5 个物理像素。 */
  toPage(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left + this.scroll.x, y: e.clientY - r.top + this.scroll.y };
  }
  viewRect(): Rect { const d = this.dpr; return { x0: this.scroll.x, y0: this.scroll.y, x1: this.scroll.x + this.canvas.width / d, y1: this.scroll.y + this.canvas.height / d }; }
  updateView() { this.store.setView(this.viewRect()); }

  invalidate() { if (!this.disposed && !this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); }

  private paint() {
    const ctx = this.canvas.getContext('2d')!, page = this.store.page;
    const prefs = this.store.doc.settings.display ?? this.app.settings.display ?? DEFAULT_DISPLAY;
    applyDisplay(prefs);
    this.box.style.background = prefs.background;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, -this.scroll.x * this.dpr, -this.scroll.y * this.dpr);
    const hl = this.hoverId !== undefined ? [this.hoverId] : [];
    if (this.drag.mode === 'construct' && this.drag.first) { const s = this.snapAt(this.drag.cur); if (s.kind !== 'free') hl.push(s.kind === 'point' || s.kind === 'path' ? s.id : 0); }
    drawPage(ctx, page, this.store.results, { selection: new Set(this.sel), highlight: hl, hideHidden: true, skip: this.textEdit ? new Set([this.textEdit.id]) : undefined, view: this.viewRect() });
    this.paintTrace();
    this.paintOverlay();
    this.syncBars();
    this.title.textContent = this.store.doc.name + (this.store.dirty ? ' *' : '');
  }

  // ------------- 追踪 -------------
  private paintTrace() {
    const ctx = this.trace.getContext('2d')!;
    const view = this.viewRect();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, -this.scroll.x * this.dpr, -this.scroll.y * this.dpr);
    for (const o of this.store.page.objects) {
      if (!o.trace || o.hidden) continue;
      const s = this.store.results.get(o.id)?.shape;
      if (!s) continue;
      const key = JSON.stringify(s);
      if (this.tracedLast.get(o.id) === key) continue;
      this.tracedLast.set(o.id, key);
      ctx.save(); ctx.strokeStyle = o.style.color; ctx.fillStyle = o.style.color; ctx.lineWidth = 1;
      if (s.k === 'pt' && s.p.x >= view.x0 - 5 && s.p.x <= view.x1 + 5 && s.p.y >= view.y0 - 5 && s.p.y <= view.y1 + 5) { ctx.beginPath(); ctx.arc(s.p.x, s.p.y, 2, 0, G.TAU); ctx.fill(); }
      else if (s.k === 'line') { const line = clipStraight({ ...s.s, ext: 'segment' }, view); if (line) { ctx.beginPath(); ctx.moveTo(line[0].x, line[0].y); ctx.lineTo(line[1].x, line[1].y); ctx.stroke(); } }
      else if (s.k === 'circle') { ctx.beginPath(); ctx.arc(s.c.c.x, s.c.c.y, s.c.r, 0, G.TAU); ctx.stroke(); }
      ctx.restore();
    }
  }
  eraseTraces() {
    const c = this.trace, g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    // 擦除后当前位置不重画：下一次对象移动才会继续留下痕迹
    this.tracedLast.clear();
    for (const o of this.store.page.objects) if (o.trace) this.tracedLast.set(o.id, JSON.stringify(this.store.results.get(o.id)?.shape));
  }
  /** 淡入淡出：把已有踪迹按比例擦淡一点。 */
  fadeTrace(k: number) {
    if (!this.hasTraces) return;
    const g = this.trace.getContext('2d')!;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out'; g.fillStyle = `rgba(0,0,0,${Math.max(0.02, Math.min(1, k))})`; g.fillRect(0, 0, this.trace.width, this.trace.height); g.restore();
  }
  get hasTraces() { return this.store.page.objects.some(o => o.trace); }

  // ------------- 预览层 -------------
  private paintOverlay() {
    const ctx = this.overlay.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, -this.scroll.x * this.dpr, -this.scroll.y * this.dpr);
    const d = this.drag;
    ctx.save();
    if (this.ghost) { ctx.save(); ctx.globalAlpha = 0.4; drawPage(ctx, this.ghost.page, this.ghost.results, { selection: new Set(), hideHidden: true, view: this.viewRect() }); ctx.restore(); }
    if (d.mode === 'box' && d.rect) {
      ctx.fillStyle = 'rgba(200,200,200,0.35)'; ctx.strokeStyle = '#e060a0'; ctx.lineWidth = 1;
      ctx.fillRect(d.rect.x0, d.rect.y0, d.rect.x1 - d.rect.x0, d.rect.y1 - d.rect.y0); ctx.strokeRect(d.rect.x0 + .5, d.rect.y0 + .5, d.rect.x1 - d.rect.x0, d.rect.y1 - d.rect.y0);
    }
    const liveFirst: Snap | undefined = d.mode === 'construct' && d.first ? d.first : this.pendingFirst !== undefined ? { kind: 'point', id: this.pendingFirst } : undefined;
    if (liveFirst && ['segment', 'ray', 'line', 'circle'].includes(this.tool)) {
      const a = this.snapPoint(liveFirst), s = this.snapAt(d.mode === 'construct' ? d.cur : this.pointer), b = this.snapPoint(s);
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (this.tool === 'circle') ctx.arc(a.x, a.y, G.dist(a, b), 0, G.TAU);
      else {
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        const p0 = this.tool === 'line' ? { x: a.x - dx / l * 4000, y: a.y - dy / l * 4000 } : a;
        const p1 = this.tool === 'segment' ? b : { x: a.x + dx / l * 4000, y: a.y + dy / l * 4000 };
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      }
      ctx.stroke();
      if (s.kind === 'point') { const o = this.store.get(s.id)!, p = this.snapPoint(s); drawPoint(ctx, { ...o, style: { ...o.style, pointSize: 3 } }, p, false, true); }
    }
    if (d.mode === 'poly' || (this.tool.startsWith('poly') && this.poly.length)) {
      const pts = this.poly.map(id => this.store.results.get(id)?.shape).map(s => (s?.k === 'pt' ? s.p : undefined)).filter(Boolean) as Pt[];
      const cur = this.snapPoint(this.snapAt(this.pointer));
      if (pts.length >= 1) {
        ctx.fillStyle = 'rgba(128,128,128,0.35)';
        ctx.beginPath(); [...pts, cur].forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); if (pts.length >= 1) ctx.fill();
        ctx.strokeStyle = '#666'; ctx.setLineDash([3, 3]); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.lineTo(cur.x, cur.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (d.mode === 'stroke' && d.stroke) {
      ctx.strokeStyle = this.app.settings.marker.color; ctx.lineWidth = this.app.settings.marker.thick ? 4 : 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); d.stroke.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    }
    if (d.mode === 'text-box' && d.rect) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#333'; ctx.strokeRect(d.rect.x0 + .5, d.rect.y0 + .5, d.rect.x1 - d.rect.x0, d.rect.y1 - d.rect.y0); }
    // 信息气泡
    ctx.font = "13px 'Microsoft YaHei',sans-serif"; ctx.textBaseline = 'top';
    this.bubbles.forEach((b, i) => {
      const last = i === this.bubbles.length - 1;
      ctx.globalAlpha = last ? 1 : 0.45;
      const lines = b.text.split('\n'), w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14, h = lines.length * 18 + 10;
      ctx.fillStyle = '#fffbe0'; ctx.strokeStyle = '#888'; ctx.beginPath(); ctx.roundRect(b.at.x + 12, b.at.y + 12, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#000'; lines.forEach((l, j) => ctx.fillText(l, b.at.x + 19, b.at.y + 17 + j * 18));
    });
    this.paintMarkFx(ctx);
    ctx.restore();
  }

  // ------------- 吸附与命中 -------------
  snapPoint(s: Snap): Pt {
    if (s.kind === 'point') { const r = this.store.results.get(s.id)?.shape; return r?.k === 'pt' ? r.p : { x: 0, y: 0 }; }
    return s.p;
  }
  /** 构造工具终点吸附：10 px 内的点 > 路径（依附点）> 自由。 */
  snapAt(p: Pt): Snap {
    const st = this.store, rad = 10;
    const id = nearestPointId(st.page, st.results, p, rad);
    if (id !== undefined) return { kind: 'point', id };
    const paths = hitAll(st.page, st.results, p, this.power, { classes: ['straight', 'circle', 'arc', 'locus', 'plot', 'interior'] }).filter(i => classOf(st.get(i)!) !== 'interior' || false);
    if (paths.length) { const pr = projectToPath(st.results.get(paths[0])?.shape, p); if (pr) return { kind: 'path', id: paths[0], p: pr.p }; }
    return { kind: 'free', p: this.gridSnap(p) };
  }
  gridSnap(p: Pt): Pt {
    const sys = this.store.page.objects.find(o => o.def.k === 'sys' && o.def.snap && o.def.showGrid);
    const sh = sys && this.store.results.get(sys.id)?.shape;
    if (sh?.k !== 'sys') return p;
    const c = toSys(sh, p); if (!c) return p;
    return fromSys(sh, Math.round(c.x), Math.round(c.y));
  }
  /** 把 Snap 变成对象：点直接用，路径上放依附点，空白处放自由点。必须在事务内。 */
  materialize(s: Snap): Id {
    if (s.kind === 'point') return s.id;
    if (s.kind === 'path') { const o = constructPointOnPath(this.store, s.id, s.p); if (o) return o.id; }
    const p = s.kind === 'free' ? s.p : s.p;
    return this.store.add({ k: 'free', x: p.x, y: p.y }).id;
  }

  // ------------- 选择 -------------
  setSel(ids: Id[]) { this.sel = [...new Set(ids)].filter(i => this.store.get(i)); this.app.refresh(); this.invalidate(); }
  clearSel() { if (this.sel.length) this.setSel([]); }

  // ------------- 指针事件 -------------
  private bind(el: HTMLElement) {
    el.addEventListener('pointerdown', e => this.onDown(e));
    el.addEventListener('pointermove', e => this.onMove(e));
    el.addEventListener('pointerup', e => this.onUp(e));
    el.addEventListener('pointercancel', () => this.cancelDrag());
    el.addEventListener('pointerleave', () => { this.hoverId = undefined; this.invalidate(); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); this.app.showContextMenu(this, e, this.toPage(e)); });
    el.addEventListener('dblclick', e => this.onDouble(e));
    el.addEventListener('wheel', e => { this.scroll = { x: this.scroll.x + (e.shiftKey ? e.deltaY : e.deltaX), y: this.scroll.y + (e.shiftKey ? 0 : e.deltaY) }; this.updateView(); this.eraseTraces(); this.invalidate(); e.preventDefault(); }, { passive: false });
  }

  cancelDrag() {
    if (this.store.inTransaction) this.store.cancel();
    this.drag = { ...this.drag, mode: 'none' };
    this.poly = [];
    this.pendingFirst = undefined;
    this.toolPicks = [];
    this.invalidate();
  }

  private onDown(e: PointerEvent) {
    if (e.button === 2) return;
    this.overlay.setPointerCapture(e.pointerId);
    this.app.focusDoc(this);
    this.commitText();
    const p = this.toPage(e), shift = e.shiftKey;
    if (this.pickHook?.(p)) return;
    this.pointer = p;
    this.drag = { mode: 'none', start: p, cur: p, moved: false, shift };
    const tool = this.tool;
    if (tool === 'move' || tool === 'rotate' || tool === 'scale') return this.downSelect(p, shift);
    if (tool === 'point') return; // 在松开时放置
    if (tool === 'segment' || tool === 'ray' || tool === 'line' || tool === 'circle') {
      if (this.pendingFirst !== undefined && !this.store.get(this.pendingFirst)) this.pendingFirst = undefined;   // 起点已被撤消或删除
      this.drag.mode = 'construct'; this.drag.first = this.pendingFirst !== undefined ? { kind: 'point', id: this.pendingFirst } : this.snapAt(p); this.invalidate(); return;
    }
    if (tool === 'marker') { this.drag.mode = 'stroke'; this.drag.stroke = [p]; return; }
    if (tool === 'text') {
      const hit = hitAll(this.store.page, this.store.results, p, this.power, { classes: ['text'] })[0];
      if (hit !== undefined) { this.setSel([hit]); this.beginTextEdit(hit); return; }
      this.drag.mode = 'text-box'; this.drag.rect = normRect(p, p); return;
    }
    if (tool.startsWith('poly')) { this.drag.mode = 'poly'; return; }
    if (tool === 'info') { this.infoAt(p); return; }
  }

  private downSelect(p: Pt, shift: boolean) {
    const st = this.store;
    const hits = hitAll(st.page, st.results, p, this.power);
    if (hits.length) {
      const id = hits[0], was = this.sel.includes(id);
      // 点与点以外的路径相交处：当场产生交点
      if (classOf(st.get(id)!) !== 'point') {
        const created = this.intersectionAt(p, hits.filter(i => classOf(st.get(i)!) !== 'point' && st.results.get(i)?.shape?.k !== 'poly'));
        if (created !== undefined) { this.setSel([...this.sel, created]); this.drag = { ...this.drag, mode: 'none' }; return; }
      }
      this.drag.mode = 'object'; this.drag.down = { id, wasSelected: was };
      if (!was) this.setSel([...this.sel, id]);
      this.drag.base = new Map(); this.drag.baseT = new Map();
      if (this.tool === 'rotate' || this.tool === 'scale') this.beginTransform(p);
      return;
    }
    this.drag.mode = 'box'; this.drag.rect = normRect(p, p);
    void shift;
  }

  /** 若点击处同时靠近两个路径对象且它们相交，建立交点。 */
  private intersectionAt(p: Pt, paths: Id[]): Id | undefined {
    if (paths.length < 2) return undefined;
    const st = this.store;
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i], b = paths[j];
      for (let branch = 0; branch < 2; branch++) {
        const trial = { k: 'inter' as const, a, b, branch };
        let found: Id | undefined;
        st.run('构造交点', () => {
          const o = st.add(trial);
          const s = st.results.get(o.id)?.shape;
          if (s?.k === 'pt' && G.dist(s.p, p) <= 12) found = o.id;
          else { st.page.objects.pop(); st.page.nextId--; st.recompute(); }
        });
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  private onMove(e: PointerEvent) {
    const p = this.toPage(e);
    this.pointer = p;
    const d = this.drag;
    this.app.setCoordHint(p);
    if (d.mode === 'none' && !(e.buttons & 1)) { this.updateHover(p); if ((this.tool.startsWith('poly') && this.poly.length) || this.pendingFirst !== undefined) this.invalidate(); return; }
    d.cur = p;
    if (!d.moved && G.dist(d.start, p) < 3) return;
    d.moved = true;
    switch (d.mode) {
      case 'box': d.rect = normRect(d.start, p); this.previewBox(d.rect, e.shiftKey); break;
      case 'object': this.dragObjects(p); break;
      case 'construct': this.invalidate(); break;
      case 'stroke': d.stroke!.push(p); this.invalidate(); break;
      case 'text-box': d.rect = normRect(d.start, p); this.invalidate(); break;
      case 'transform': this.transformDrag(p); break;
    }
    this.invalidate();
  }

  private updateHover(p: Pt) {
    const h = hitAll(this.store.page, this.store.results, p, this.power)[0];
    if (h !== this.hoverId) { this.hoverId = this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale' || this.tool === 'info' ? undefined : h; this.overlay.style.cursor = h !== undefined && (this.tool === 'move' || this.tool === 'info') ? 'var(--cursor-on)' : 'default'; this.invalidate(); }
    if (this.tool === 'point' || this.tool === 'circle' || this.tool === 'segment' || this.tool === 'ray' || this.tool === 'line') {
      const s = this.snapAt(p), hid = s.kind === 'free' ? undefined : s.id;
      if (hid !== this.hoverId) { this.hoverId = hid; this.invalidate(); }
    }
  }

  private previewBox(r: Rect, shift: boolean) {
    const hit = hitRect(this.store.page, this.store.results, r);
    const base = shift ? this.sel : [];
    this.selTemp = [...new Set([...base, ...hit])];
    this.sel = this.selTemp;
  }
  private selTemp: Id[] = [];

  // ---- 拖动对象 ----
  /** 一个对象依赖的自由点（沿依赖链向上直到自由点或路径点）。 */
  private roots(ids: Id[]): { free: Set<Id>; path: Set<Id> } {
    const free = new Set<Id>(), path = new Set<Id>(), seen = new Set<Id>();
    const walk = (id: Id) => {
      if (seen.has(id)) return; seen.add(id);
      const o = this.store.get(id); if (!o) return;
      if (o.def.k === 'free') { free.add(id); return; }
      if (o.def.k === 'onpath') { path.add(id); return; }
      for (const p of this.store.parents(id)) walk(p);
    };
    ids.forEach(walk);
    return { free, path };
  }

  private dragObjects(p: Pt) {
    const d = this.drag, st = this.store;
    if (!d.down) return;
    if (d.unit) { const sys = st.get(d.unit.sys); if (sys) { dragSysUnit(st, sys, d.unit.point, p); st.recompute(); } return; }
    if (d.boxes) { this.moveBoxes(p); return; }
    if (!d.base!.size && !d.baseT!.size) {
      // 第一次移动：确定要移动谁
      const clicked = st.get(d.down.id)!;
      // 坐标系的单位点：拖动改变单位长度
      const sys = classOf(clicked) === 'point' ? st.page.objects.find(o => o.def.k === 'sys' && (o.def.unitX === clicked.id || o.def.unitY === clicked.id)) : undefined;
      if (sys) { st.begin('移动点'); d.unit = { sys: sys.id, point: clicked.id }; dragSysUnit(st, sys, clicked.id, p); st.recompute(); return; }
      // 按在文字型对象上：只移动选中的文字型对象本身；按在几何对象上：只移动几何对象（选中的度量值不把它度量的点一起带走）
      const selected = (this.sel.includes(d.down.id) ? this.sel : [d.down.id]).map(id => st.get(id)).filter((o): o is Obj => !!o);
      if (isBoxy(clicked)) {
        const boxes = new Map<Id, Pt>();
        for (const o of selected) { const at = isBoxy(o) ? boxAt(o) : undefined; if (at) boxes.set(o.id, { ...at }); }
        if (!boxes.size) { d.mode = 'none'; return; }
        st.begin(`移动${typeName(clicked)}`); d.boxes = boxes; this.moveBoxes(p); return;
      }
      const target = selected.filter(o => !isBoxy(o)).map(o => o.id);
      const r = this.roots(target);
      // 在点上拖动：只动它；路径点沿路径滑动
      if (classOf(clicked) === 'point' && target.length <= 1) {
        const pr = this.roots([d.down.id]);
        r.free = pr.free; r.path = pr.path;
        if (clicked.def.k !== 'free' && clicked.def.k !== 'onpath') { r.free = new Set(); r.path = new Set(); }
      }
      if (!r.free.size && !r.path.size) { d.mode = 'none'; return; }
      st.begin(this.dragName(clicked));
      for (const id of r.free) { const o = st.get(id)!; if (o.def.k === 'free') d.base!.set(id, { x: o.def.x, y: o.def.y }); }
      for (const id of r.path) { const o = st.get(id)!; if (o.def.k === 'onpath') d.baseT!.set(id, o.def.t); }
    }
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    const direct = classOf(st.get(d.down.id)!) === 'point' && (st.get(d.down.id)!.def.k === 'onpath');
    for (const [id, b] of d.base!) {
      const at = d.base!.size === 1 && classOf(st.get(d.down.id)!) === 'point' ? this.gridSnap({ x: b.x + dx, y: b.y + dy }) : { x: b.x + dx, y: b.y + dy };
      st.moveFree(id, at.x, at.y);
    }
    for (const [id] of d.baseT!) {
      const o = st.get(id)!; if (o.def.k !== 'onpath') continue;
      const path = st.results.get(o.def.path)?.shape;
      const target = direct ? p : { x: p.x, y: p.y };
      const pr = projectOnPath(st.page, st.results, o.def.path, target); void path;
      if (pr) { st.update(id, { ...o.def, t: pr.t, ...(pr.abs ? { abs: true } : {}) }); }
    }
    st.recompute([...d.base!.keys(), ...d.baseT!.keys()]);
    void dy;
  }
  private moveBoxes(p: Pt) {
    const d = this.drag, st = this.store, dx = p.x - d.start.x, dy = p.y - d.start.y;
    for (const [id, b] of d.boxes!) {
      const o = st.get(id); if (!o) continue;
      const at = { x: b.x + dx, y: b.y + dy };
      if (o.def.k === 'text' && o.def.anchor !== undefined) st.update(id, { ...o.def, off: at });
      else if (o.def.k === 'image' && o.def.affine) { const m = [...o.def.affine] as import('../core/image').Affine; m[2] += at.x - o.def.at.x; m[5] += at.y - o.def.at.y; st.update(id, { ...o.def, at, affine: m }); }
      else if (o.def.k === 'text' || o.def.k === 'button' || o.def.k === 'image') st.update(id, { ...o.def, at });
      else o.at = at;
    }
    st.recompute([...d.boxes!.keys()]);
  }
  private dragName(o: Obj): string { const c = classOf(o); return c === 'point' ? '移动点' : `平移${typeName(o)}`; }

  // ---- 旋转 / 缩放工具 ----
  private transformDrag(p: Pt) {
    const d = this.drag, st = this.store;
    if (!d.base || !d.center) return;
    if (!st.inTransaction) st.begin(this.tool === 'rotate' ? '旋转' : '缩放');
    const c = d.center;
    const a0 = G.angleOf(c, d.start), a1 = G.angleOf(c, p), k = G.dist(c, p) / Math.max(1e-6, G.dist(c, d.start));
    for (const [id, b] of d.base) {
      const np = this.tool === 'rotate' ? G.rotatePt(b, c, a1 - a0) : G.dilatePt(b, c, k);
      st.moveFree(id, np.x, np.y);
    }
    st.recompute([...d.base.keys()]);
  }

  private onUp(e: PointerEvent) {
    const d = this.drag, p = this.toPage(e), st = this.store;
    try { this.overlay.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    const tool = this.tool;
    if (tool === 'move' || tool === 'rotate' || tool === 'scale') {
      if ((tool === 'rotate' || tool === 'scale') && d.mode === 'transform' && !d.moved) { this.finishSelectClick(d, e); }
      else if (d.mode === 'object') {
        const pressed = d.down && !d.moved ? st.get(d.down.id) : undefined;
        if (d.moved && st.inTransaction) st.commit();
        else if (pressed?.def.k === 'button' && tool === 'move') this.app.pressButton(this, pressed);     // 箭头单击按钮即执行
        else if (pressed?.def.k === 'text' && tool === 'move') {
          const button = embeddedButtonAt(this.canvas.getContext('2d')!, st.page, st.results, pressed, p);
          if (button) this.app.pressButton(this, button); else this.finishSelectClick(d, e);
        }
        else this.finishSelectClick(d, e);
      } else if (d.mode === 'box') {
        if (d.moved) { this.sel = this.selTemp; this.app.refresh(); }
        else if (!e.shiftKey) this.clearSel();
      } else if (d.mode === 'transform' && st.inTransaction) st.commit();
      this.drag = { ...d, mode: 'none' };
      this.invalidate();
      return;
    }
    this.drag = { ...d, mode: 'none' };
    if (tool === 'point') { this.placePoint(p); return; }
    if (tool === 'custom') { this.customClick(p); return; }
    if (d.mode === 'construct' && d.first) { this.finishConstruct(d, p); return; }
    if (d.mode === 'stroke' && d.stroke && d.stroke.length > 1) {
      const pts = d.stroke;
      const mk = this.app.settings.marker;
      const o = st.run('构造绘图', () => st.add({ k: 'stroke', pts }, { style: { color: mk.color, pointSize: 2, width: mk.thick ? 3 : 1, dash: 'solid' } }));
      this.setSel([o.id]); return;
    }
    if (d.mode === 'text-box') { this.createText(d.rect && (d.rect.x1 - d.rect.x0 > 8 || d.rect.y1 - d.rect.y0 > 8) ? d.rect : { x0: p.x, y0: p.y, x1: p.x + 120, y1: p.y + 24 }); return; }
    if (d.mode === 'poly') this.polyClick(p, e.detail >= 2);
    this.invalidate();
  }

  /** 选择工具下的单击收尾：已选中的对象再次单击取消选中。 */
  private finishSelectClick(d: Drag, e: PointerEvent) {
    if (!d.down) return;
    if (d.down.wasSelected) this.setSel(this.sel.filter(i => i !== d.down!.id));
    void e;
  }

  private onDouble(e: MouseEvent) {
    const p = this.toPage(e);
    if (this.tool === 'text') { this.createText({ x0: p.x, y0: p.y, x1: p.x + 120, y1: p.y + 24 }); return; }
    const st = this.store, selTool = this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale';
    // 选择类工具下双击：点 → 标记中心；直线型（线段/射线/直线）→ 标记镜面。点和线分开记录，可以同时有。
    const markHit = (cls: string) => hitAll(st.page, st.results, p, this.power, { classes: [cls] })[0];
    const pt = selTool ? markHit('point') : undefined;
    if (pt !== undefined) { this.markCenter(pt); return; }
    const hit = hitAll(st.page, st.results, p, this.power, { classes: ['text', 'button'] })[0];
    if (hit !== undefined) { const o = st.get(hit)!; if (o.def.k === 'text') this.beginTextEdit(hit); else this.app.pressButton(this, o); return; }
    const ln = selTool ? markHit('straight') : undefined;
    if (ln !== undefined) this.markMirror(ln);
  }

  /** 双击点：标记为变换中心，并播放同心圆扩散的指示动画。 */
  markCenter(id: Id) {
    this.marks.center = id;
    this.markFx = { kind: 'center', id, t0: performance.now() };
    this.app.flashStatus('已标记中心');
    this.invalidate();
  }
  /** 双击直线型对象：标记为镜面，并播放两侧平行线外扩的指示动画。 */
  markMirror(id: Id) {
    this.marks.mirror = id;
    this.markFx = { kind: 'mirror', id, t0: performance.now() };
    this.app.flashStatus('已标记镜面');
    this.invalidate();
  }
  /** 标记指示动画（外观按原版真实鼠标连拍复刻，见 canvas-interactions.md §22）：当前时刻画在预览层，未结束就继续要求重绘。 */
  private paintMarkFx(ctx: CanvasRenderingContext2D) {
    const fx = this.markFx; if (!fx) return;
    const u = (performance.now() - fx.t0) / MARK_FX_MS;
    if (u >= 1) { this.markFx = undefined; return; }
    const sh = this.store.results.get(fx.id)?.shape;
    // 脉动：0→0.4 向外扩、0.4→1 收回；外圈只在中段（0.2–0.6）出现
    const a = u < 0.4 ? u / 0.4 : (1 - u) / 0.6;
    const inner = 4 + 7 * a, outer = u > 0.2 && u < 0.6 ? inner + 9 * Math.min(1, (u - 0.2) / 0.15) * Math.min(1, (0.6 - u) / 0.15 + 0.3) : 0;
    ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
    const ring = (x: number, y: number, r: number, square: boolean) => { ctx.beginPath(); if (square) ctx.rect(x - r, y - r, 2 * r, 2 * r); else ctx.arc(x, y, r, 0, G.TAU); ctx.stroke(); };
    if (fx.kind === 'center' && sh?.k === 'pt') {
      ring(sh.p.x, sh.p.y, inner + 4, false); if (outer) ring(sh.p.x, sh.p.y, outer + 4, false);
      ctx.strokeStyle = '#ff40ff'; ctx.lineWidth = 2; ring(sh.p.x, sh.p.y, 5, false);          // 点本身反色闪一下
    } else if (fx.kind === 'mirror' && sh?.k === 'line') {
      const span = visibleSpan(sh.s, this.viewRect());
      if (span) {
        ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = '#ff40ff'; ctx.lineWidth = 5;     // 线本身反色高亮
        ctx.beginPath(); ctx.moveTo(span[0].x, span[0].y); ctx.lineTo(span[1].x, span[1].y); ctx.stroke(); ctx.restore();
        for (const k of [1 / 3, 2 / 3]) {                                                       // 可见部分三等分处各一组嵌套方框
          const x = span[0].x + (span[1].x - span[0].x) * k, y = span[0].y + (span[1].y - span[0].y) * k;
          ring(x, y, inner + 2, true); if (outer) ring(x, y, outer + 2, true);
        }
      }
    }
    ctx.restore();
    this.invalidate();
  }

  // ---- 自定义工具 ----
  /** 显式匹配选中的对象；每个前提必须有唯一候选，歧义时不执行。 */
  matchSelectedToolInputs() {
    const tool = this.app.customTool, st = this.store;
    if (!tool) return;
    const picks: Id[] = [];
    for (const input of tool.inputs) {
      const candidates = this.sel.filter(id => !picks.includes(id)).filter(id => {
        const o = st.get(id);
        return !!o && acceptsInput(input.kind, o, st.results) && (input.kind !== 'axis' || st.page.objects.some(s => s.def.k === 'sys' && [s.def.axisX, s.def.axisY].includes(id)));
      });
      if (candidates.length !== 1) { void this.app.dlg.message('无法唯一匹配所有前提条件，请逐一点选或调整选择。'); return; }
      picks.push(candidates[0]);
    }
    this.toolPicks = picks;
    this.runTool(tool);
    this.app.updateStatus();
  }
  /** 页面已有坐标系时，“坐标系”前提由原版自动匹配到最近的坐标系，不提示（真实鼠标逐工具实测）。 */
  fillAutoInputs(tool: Tool) {
    const systems = this.store.page.objects.filter(o => o.def.k === 'sys');
    if (!systems.length) return;
    tool.inputs.forEach((inp, i) => { if (inp.kind === 'system' && this.toolPicks[i] === undefined) this.toolPicks[i] = systems.at(-1)!.id; });
  }
  /** 下一个还没匹配的前提条件序号；全部匹配时为 undefined。 */
  nextToolInput(tool: Tool): number | undefined {
    const i = tool.inputs.findIndex((_, n) => this.toolPicks[n] === undefined);
    return i < 0 ? undefined : i;
  }
  /**
   * 自定义工具下的单击。原版不严格按顺序：点中的对象匹配第一个种类相符的前提，
   * 点空白处匹配第一个“点”前提（逐工具实测：数值前提排在前面时，先点空白也会先放点）。
   */
  private customClick(p: Pt) {
    const tool = this.app.customTool, st = this.store;
    if (!tool) { this.app.status.textContent = '先从自定义工具菜单里选一个工具'; return; }
    this.fillAutoInputs(tool);
    if (this.nextToolInput(tool) === undefined) { this.runTool(tool); this.app.updateStatus(); return; }
    const used = this.toolPicks.filter((id): id is Id => id !== undefined);
    const hits = hitAll(st.page, st.results, p, this.power);
    let slot = -1, id: Id | undefined;
    tool.inputs.forEach((inp, i) => {
      if (slot >= 0 || this.toolPicks[i] !== undefined || inp.kind === 'point') return;
      const found = toolInputFromHits(inp.kind, hits, st.page, st.results, used);
      if (found !== undefined) { slot = i; id = found; }
    });
    if (slot < 0) {
      slot = tool.inputs.findIndex((inp, i) => inp.kind === 'point' && this.toolPicks[i] === undefined);
      if (slot < 0) return;
      const snap = this.snapAt(p);
      if (snap.kind === 'point' && used.includes(snap.id)) return;   // 同一个点不重复当前提条件（推测，待原版验证）
      id = snap.kind === 'point' ? snap.id : st.run('构造点', () => {
        const made = this.materialize(snap), label = toolInputLabel(tool, tool.inputs[slot].index), o = st.get(made);
        if (label && o && !o.labelShown) { o.label = label; o.labelShown = true; }
        return made;
      });
    }
    this.toolPicks[slot] = id!;
    this.fillAutoInputs(tool);
    this.setSel(this.toolPicks.filter((x): x is Id => x !== undefined));
    if (this.nextToolInput(tool) === undefined) this.runTool(tool);
    this.app.updateStatus();
  }
  private runTool(tool: Tool) {
    const picks = this.toolPicks.slice() as Id[], st = this.store;
    this.toolPicks = [];
    let made: Obj[] = [];
    try { st.run(tool.name, () => { made = applyTool(st, tool, picks, () => this.app.nextTextPos(this)); }); }
    catch (e) { void this.app.dlg.message(`这个工具没能用上：${(e as Error).message}`); return; }
    this.setSel(made.map(o => o.id));
  }

  // ---- 点工具 ----
  private placePoint(p: Pt) {
    const st = this.store, snap = this.snapAt(p);
    if (snap.kind === 'point') { this.setSel([...this.sel, snap.id]); return; }
    const o = st.run('构造点', () => this.materialize(snap));
    this.setSel([o]);
  }

  // ---- 线段/射线/直线/圆 ----
  private finishConstruct(d: Drag, p: Pt) {
    const st = this.store;
    const first = d.first!;
    const end = this.snapAt(p);
    const pending = this.pendingFirst;
    if (!d.moved && pending === undefined) {
      // 单击：放下起点，下一次单击（或拖动）在这里结束
      const id = st.run('构造点', () => this.materialize(first));
      this.pendingFirst = id;
      this.setSel([id]); return;
    }
    this.pendingFirst = undefined;
    if (pending !== undefined && end.kind === 'point' && end.id === pending) { this.invalidate(); return; }   // 又点回起点：不作图
    const tool = this.tool as 'segment' | 'ray' | 'line' | 'circle';
    let made: Obj | undefined;
    st.run(`构造${tool === 'segment' ? '线段' : tool === 'ray' ? '射线' : tool === 'line' ? '直线' : '圆'}`, () => {
      const a = this.materialize(first);
      let b = this.materialize(end);
      if (a === b) { b = this.materialize({ kind: 'free', p: { x: p.x, y: p.y } }); }
      made = tool === 'circle' ? st.add({ k: 'circle', c: a, p: b }) : constructLines(st, tool === 'segment' ? 'seg' : tool, [a, b])[0];
    });
    if (made) this.setSel([made.id]);
  }

  // ---- 多边形 ----
  private polyClick(p: Pt, dbl: boolean) {
    const st = this.store, snap = this.snapAt(p);
    // 点回第一个顶点或双击：完成
    if (this.poly.length >= 2 && ((snap.kind === 'point' && snap.id === this.poly[0]) || (dbl))) {
      if (dbl && !(snap.kind === 'point' && snap.id === this.poly[0])) {
        const last = st.run('构造点', () => this.materialize(snap)); if (this.poly[this.poly.length - 1] !== last) this.poly.push(last);
      }
      return this.finishPoly();
    }
    const id = st.run('构造点', () => this.materialize(snap));
    if (this.poly.includes(id)) return;
    this.poly.push(id);
    this.setSel(this.poly.slice());
    this.invalidate();
  }
  private finishPoly() {
    const st = this.store, pts = this.poly.slice();
    this.poly = [];
    if (pts.length < 3) { this.setSel(pts); return; }
    const kind = this.tool;
    const name = pts.length === 3 ? '构造三角形' : pts.length === 4 ? '构造四边形' : `构造${pts.length}边形`;
    let made: Obj[] = [];
    st.run(name, () => {
      if (kind !== 'poly-edges') made = constructInterior(st, pts.map(i => st.get(i)!));
      if (kind !== 'poly-fill' || this.app.settings.polygonBorders) made.push(...constructLines(st, 'seg', pts));
      if (kind === 'poly-edges') { /* 只有边 */ }
    });
    this.setSel(made.map(o => o.id));
  }

  // ---- 信息工具 ----
  private infoAt(p: Pt) {
    const hit = hitAll(this.store.page, this.store.results, p, this.power)[0];
    if (hit === undefined) return;
    this.bubbles.push({ at: p, text: this.app.describeForInfo(this, hit), age: 0 });
    if (this.bubbles.length > 8) this.bubbles.shift();
    this.invalidate();
  }
  clearBubbles() { this.bubbles = []; this.invalidate(); }

  // ---- 文本 ----
  createText(r: Rect) {
    const st = this.store;
    const o = st.run('构造说明', () => st.add({ k: 'text', text: '', at: { x: r.x0, y: r.y0 }, w: Math.max(40, r.x1 - r.x0), h: Math.max(24, r.y1 - r.y0), font: { ...this.app.settings.font } }, { style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } }));
    this.setSel([o.id]);
    this.beginTextEdit(o.id);
  }
  beginTextEdit(id: Id) {
    this.commitText();
    const o = this.store.get(id); if (!o || o.def.k !== 'text') return;
    const ta = document.createElement('textarea');
    ta.className = 'textedit';
    const f = o.def.font;
    ta.value = o.def.text;
    Object.assign(ta.style, { left: `${o.def.at.x - this.scroll.x}px`, top: `${o.def.at.y - this.scroll.y}px`, width: `${Math.max(o.def.w, 60)}px`, height: `${Math.max(o.def.h, 28)}px`, font: `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.name}, 'Microsoft YaHei'`, color: f.color, textDecoration: f.underline ? 'underline' : 'none' });
    this.box.append(ta);
    this.textEdit = { id, ta, runs: structuredClone(o.def.runs ?? [{ text: o.def.text, font: f }]), originalRuns: o.def.runs && structuredClone(o.def.runs), composing: false };
    ta.addEventListener('compositionstart', () => { if (this.textEdit?.ta === ta) this.textEdit.composing = true; });
    ta.addEventListener('compositionend', () => { if (this.textEdit?.ta === ta) this.textEdit.composing = false; });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.isComposing && !this.textEdit?.composing) { ev.preventDefault(); this.commitText(); } ev.stopPropagation(); });
    ta.addEventListener('blur', ev => { if (this.textEdit?.ta === ta && !this.app.textbar.contains(ev.relatedTarget as Node | null)) this.commitText(); });
    ta.addEventListener('input', () => { const te = this.textEdit; if (te?.ta === ta) te.runs = replaceText(te.runs, ta.value, f); this.app.refreshTextbar(); });
    ta.addEventListener('select', () => this.app.refreshTextbar());
    ta.focus();
    this.app.refreshTextbar();
    this.invalidate();
  }
  textEditFont(): FontSpec | undefined {
    const te = this.textEdit, o = te && this.store.get(te.id);
    return te && o?.def.k === 'text' ? fontAt(te.runs, te.ta.selectionStart, o.def.font) : undefined;
  }
  styleTextSelection(apply: (f: FontSpec) => FontSpec) {
    const te = this.textEdit; if (!te) return;
    let start = te.ta.selectionStart, end = te.ta.selectionEnd;
    // 没有选区时沿用文本框整体格式操作；有选区时只改所选文字。
    if (start === end) { start = 0; end = te.ta.value.length; }
    te.runs = styleRange(te.runs, start, end, apply);
    this.app.refreshTextbar();
  }
  commitText() {
    const te = this.textEdit; if (!te) return;
    this.textEdit = undefined;
    const text = te.ta.value;
    te.ta.remove();
    const st = this.store, o = st.get(te.id);
    if (o?.def.k === 'text') {
      if (!text.trim()) {
        st.run('清除说明', () => st.remove([te.id]));
        this.sel = this.sel.filter(i => i !== te.id);
      } else if (text !== o.def.text || JSON.stringify(te.runs) !== JSON.stringify(te.originalRuns ?? [{ text: o.def.text, font: o.def.font }])) {
        const ctx = this.canvas.getContext('2d')!, f = o.def.font;
        ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.name}`;
        const lines = wrap(ctx, text, o.def.w - 6), h = Math.max(24, lines.length * f.size * 1.3 + 8);
        const w = Math.min(o.def.w, Math.max(...lines.map(l => ctx.measureText(l).width)) + 10);
        const def = o.def;
        const runs = te.runs.length === 1 && JSON.stringify(te.runs[0].font) === JSON.stringify(def.font) ? undefined : te.runs;
        st.run('编辑说明', () => st.update(te.id, { ...def, text, runs, h, w: Math.max(30, w) }));
      }
    }
    this.app.refreshTextbar();
    this.app.refresh();
    this.invalidate();
  }

  // ------------- 键盘 -------------
  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.pendingFirst = undefined;
      if (this.textEdit) { this.commitText(); return true; }
      if (this.drag.mode !== 'none' || this.poly.length) { this.poly = []; this.cancelDrag(); this.setSel([]); this.app.setTool('move'); return true; }
      this.setSel([]);
      this.app.setTool('move');
      return true;
    }
    if (e.key === 'Tab') { this.tabSelect(e.shiftKey); return true; }
    return false;
  }
  /** Tab：只在同类对象之间轮换，顺序是创建顺序的倒序循环。 */
  private tabSelect(back: boolean) {
    const objs = this.store.page.objects.filter(o => !o.hidden);
    const cls = this.sel.length ? classOf(this.store.get(this.sel[this.sel.length - 1])!) : 'point';
    const pool = objs.filter(o => classOf(o) === cls);
    if (!pool.length) return;
    let idx = -1;
    if (this.sel.length) idx = pool.findIndex(o => o.id === this.sel[this.sel.length - 1]);
    const n = pool.length;
    const next = idx < 0 ? (back ? 0 : n - 2 < 0 ? n - 1 : n - 2) : (((idx - (back ? -1 : 1)) % n) + n) % n;
    this.setSel([pool[(next + n) % n].id]);
  }

  /** 旋转/缩放工具：以标记中心（没有则取所选对象自由点的重心）为中心，记录自由点初始位置。 */
  private beginTransform(p: Pt) {
    const st = this.store, d = this.drag;
    const roots = this.roots(this.sel.length ? this.sel : []).free;
    if (!roots.size) return;
    const base = new Map<Id, Pt>();
    for (const id of roots) { const o = st.get(id); if (o?.def.k === 'free') base.set(id, { x: o.def.x, y: o.def.y }); }
    const mc = this.marks.center !== undefined ? this.store.results.get(this.marks.center)?.shape : undefined;
    const center = mc?.k === 'pt' ? mc.p : [...base.values()].reduce((a, q) => ({ x: a.x + q.x / base.size, y: a.y + q.y / base.size }), { x: 0, y: 0 });
    d.mode = 'transform'; d.base = base; d.center = center; d.start = p;
  }
}

export { isLine, byId, hitRadii };
