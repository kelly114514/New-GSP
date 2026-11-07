/** 文档存储：事务、撤消/重做、标签分配、求值缓存。所有文档变更都经过 commit。 */
import { evaluatePage, type EvalCtx, type Results } from './engine';
import { byId, defaultStyle, emptyPage, newDoc, page as curPage, parentsOf, descendants, type Def, type Doc, type Id, type Obj, type Page, type Style } from './model';

export interface Snapshot { doc: string }
interface HistoryEntry { name: string; before: string; after: string }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function labelFor(n: number): string {
  const sub = Math.floor(n / 26), ch = LETTERS[n % 26];
  return sub === 0 ? ch : ch + String(sub).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('');
}

export class Store {
  doc: Doc;
  results: Results = new Map();
  ctx: EvalCtx = {};
  dirty = false;                  // 相对上次保存是否有改动
  private undo: HistoryEntry[] = [];
  private redo: HistoryEntry[] = [];
  private tx?: { name: string; before: string };
  private listeners = new Set<() => void>();
  private savedJson: string;
  /** 恢复文件或打开文件时用于对比的来源（编码层使用）。 */
  source?: unknown;
  /** 文件含新版不能处理的对象时的只读原因；存在时拒绝一切编辑。 */
  protectedReason?: string;

  constructor(doc: Doc = newDoc()) {
    this.doc = doc;
    this.savedJson = JSON.stringify(doc);
    this.recompute();
  }

  get page(): Page { return curPage(this.doc); }
  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const f of this.listeners) f(); }

  recompute(changed?: Iterable<Id>) {
    this.results = evaluatePage(this.page, changed, changed ? this.results : undefined, this.ctx);
  }
  setView(view: EvalCtx['view']) {
    if (JSON.stringify(view) === JSON.stringify(this.ctx.view)) return;
    this.ctx = { ...this.ctx, view };
    if (this.page.objects.some(o => o.def.k === 'plot')) { this.recompute(this.page.objects.filter(o => o.def.k === 'plot').map(o => o.id)); this.emit(); }
  }

  // ---------- 事务 ----------
  /** 开始一次可撤消的操作；拖动期间连续调用 update，结束时 commit。 */
  begin(name: string) {
    if (this.protectedReason) throw new Error(`${this.protectedReason}，已按只读打开，不能修改`);
    if (!this.tx) this.tx = { name, before: JSON.stringify(this.doc) };
  }
  get inTransaction() { return !!this.tx; }
  commit(name?: string) {
    if (!this.tx) return;
    const after = JSON.stringify(this.doc);
    if (after !== this.tx.before) {
      this.undo.push({ name: name ?? this.tx.name, before: this.tx.before, after });
      if (this.undo.length > 200) this.undo.shift();
      this.redo = [];
      this.markDirty();
    }
    this.tx = undefined;
    this.emit();
  }
  cancel() {
    if (!this.tx) return;
    this.doc = JSON.parse(this.tx.before);
    this.tx = undefined;
    this.recompute();
    this.emit();
  }
  /** 一次性事务：fn 内修改文档，返回后提交。出错则回滚。 */
  run<T>(name: string, fn: () => T): T {
    const owned = !this.tx;
    this.begin(name);
    try { const r = fn(); if (owned) this.commit(); return r; }
    catch (e) { if (owned) this.cancel(); throw e; }
  }

  get canUndo() { return this.undo.length > 0; }
  get canRedo() { return this.redo.length > 0; }
  get undoName() { return this.undo[this.undo.length - 1]?.name; }
  get redoName() { return this.redo[this.redo.length - 1]?.name; }
  doUndo() {
    const e = this.undo.pop(); if (!e) return;
    this.redo.push(e); this.restore(e.before);
  }
  doRedo() {
    const e = this.redo.pop(); if (!e) return;
    this.undo.push(e); this.restore(e.after);
  }
  private restore(json: string) {
    this.doc = JSON.parse(json);
    this.recompute();
    this.markDirty();
    this.emit();
  }
  private markDirty() { this.dirty = JSON.stringify(this.doc) !== this.savedJson; }
  markSaved() { this.savedJson = JSON.stringify(this.doc); this.dirty = false; this.emit(); }
  resetHistory() { this.undo = []; this.redo = []; }

  // ---------- 对象操作（须在事务内调用） ----------
  get(id: Id): Obj | undefined { return byId(this.page, id); }

  add(def: Def, partial: Partial<Obj> = {}, recompute = true): Obj {
    const p = this.page;
    const obj: Obj = { id: p.nextId++, def, style: { ...defaultStyle(def), ...partial.style }, hidden: false, labelShown: false, ...partial };
    if (partial.style) obj.style = { ...defaultStyle(def), ...partial.style };
    p.objects.push(obj);
    if (recompute) this.recompute([obj.id]);
    if (this.doc.settings.autoLabelPoints && this.isPoint(obj)) this.showLabel(obj.id, true);
    return obj;
  }

  private isPoint(o: Obj) { return ['free', 'onpath', 'mid', 'inter', 'translate', 'rotate', 'dilate', 'reflect', 'plotxy', 'plotfix', 'axispt', 'pointval', 'combine', 'iterpt'].includes(o.def.k); }

  update(id: Id, def: Def) {
    const o = this.get(id); if (!o) return;
    o.def = def;
    this.ctx.tOverride?.delete(id); this.ctx.valOverride?.delete(id);
    this.recompute([id]);
  }
  /** 拖动用：只改自由点坐标，立即重算受影响的对象。 */
  moveFree(id: Id, x: number, y: number) {
    const o = this.get(id); if (!o || o.def.k !== 'free') return;
    o.def = { k: 'free', x, y };
    this.ctx.posOverride?.delete(id);
    this.recompute([id]);
  }
  setStyle(ids: Iterable<Id>, patch: Partial<Style>) { for (const id of ids) { const o = this.get(id); if (o) o.style = { ...o.style, ...patch }; } }
  setHidden(ids: Iterable<Id>, hidden: boolean) { for (const id of ids) { const o = this.get(id); if (o) o.hidden = hidden; } }

  /** 显示或隐藏标签；第一次显示时按给定的顺序分配字母（点），其他对象沿用既有名字。 */
  showLabel(id: Id, show: boolean) {
    const o = this.get(id); if (!o) return;
    if (show && o.label === undefined) o.label = this.defaultLabel(o);
    o.labelShown = show && o.label !== undefined;
  }
  defaultLabel(o: Obj): string | undefined {
    if (this.isPoint(o)) return labelFor(this.page.labelCounter++);
    if (o.def.k === 'param') return o.def.name;
    return undefined;
  }

  /** 删除对象及其所有后代；返回被删除的 ID。 */
  remove(ids: Iterable<Id>): Set<Id> {
    const p = this.page, start = new Set(ids), gone = new Set<Id>([...start, ...descendants(p, start)]);
    // 删除多边形顶点时，多边形内部一并删除（已由 parentsOf 覆盖）
    p.objects = p.objects.filter(o => !gone.has(o.id));
    this.recompute();
    return gone;
  }

  parents(id: Id): Id[] { const o = this.get(id); return o ? parentsOf(o.def) : []; }

  // ---------- 页面与文档 ----------
  addPage(copy: boolean, from = this.doc.current) {
    const base = this.doc.pages[from] ?? this.page, np = copy ? JSON.parse(JSON.stringify(base)) as Page : emptyPage();
    np.name = String(this.doc.pages.length + 1);
    this.doc.pages.splice(this.doc.current + 1, 0, np);
    this.doc.current++;
    this.recompute();
  }
  removePage(i: number) {
    if (this.doc.pages.length <= 1) return;
    this.doc.pages.splice(i, 1);
    this.doc.current = Math.min(this.doc.current, this.doc.pages.length - 1);
    this.recompute();
  }
  switchPage(i: number) {
    if (i < 0 || i >= this.doc.pages.length) return;
    this.doc.current = i;
    this.recompute();
    this.emit();
  }
  replaceDoc(doc: Doc, source?: unknown) {
    this.doc = doc; this.source = source; this.undo = []; this.redo = []; this.tx = undefined;
    this.savedJson = JSON.stringify(doc); this.dirty = false;
    this.recompute(); this.emit();
  }
}
