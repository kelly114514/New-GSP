/** 应用外壳：多文档、菜单、工具箱、状态栏、文件与剪贴板、动画。 */
import { classOf, createSystem, findSys, setGridStyle } from './core/construct';
import { buttonSize } from './core/button';
import { formatQ, parseExpr, usesX, type Expr } from './core/expr';
import { DEFAULT_COLORS, DEFAULT_DISPLAY, TEXT_DEFAULTS, childrenOf, parentsOf, newDoc, pageAutoSnap, pageDisplay, type ButtonAction, type DisplayPrefs, type FontSpec, type Id, type Obj } from './core/model';
import type { Pt } from './core/geom';
import { Store } from './core/store';
import { projectOnPath } from './core/engine';
import { legacyHelpTopic } from './core/link';
import { analyse, executeCommand, fontTargets, mergeTextSource, queryCommand, type Ctx, type Sel } from './commands';
import { Dialogs } from './ui/dialogs';
import { comboOf, SHORTCUTS } from './shortcuts';
import { DocView, type ToolId } from './ui/docview';
import { buildMenus, ContextMenu } from './ui/menus';
import { applyDisplay, measureName, typeName } from './ui/render';
import { remapDef } from './core/remap';
import { playFunctions } from './ui/sound';
import { desktop } from './desktop';
import { decodeFile, encodeFile, encodeNgsp, encodeToolBody, type Source } from './gsp/codec';
import { Animator } from './anim';
import { Mdi } from './ui/mdi';
import { Toolbox } from './ui/toolbox';
import { Motion } from './ui/motion';
import { printDocument } from './ui/print';
import { createToolObjects, toolInputPrompt, type Tool } from './core/tooling';
import { loadToolFile, resolveEmbedded, resolveTool, type ToolGroup, type ToolRef } from './toolkit';

export interface Settings {
  power: 'low' | 'mid' | 'high';
  font: FontSpec;
  polygonBorders: boolean;
  autoSnap: boolean;
  autoLabel: boolean;
  textbarOnEdit: boolean;
  recent: string[];
  doubleClickDeselect: boolean;
  /** 度量时给被度量的对象显示标签。 */
  autoLabelMeasured: boolean;
  /** 新建参数显示编辑框。 */
  paramEdit: boolean;
  /** 新函数默认用“y=”记号。 */
  funcSymbol: boolean;
  /** 新建对象的默认颜色和内部设置。 */
  colors: { point: string; line: string; circle: string; plot: string; locus: string; interior: string; randomInterior: boolean; autoUpdate: boolean; fade: boolean; fadeTime: number };
  /** 新建多边形透明度（百分比，100 = 完全不透明）。 */
  polyOpacity: number;
  marker: { color: string; thick: boolean };
  infoDescribe: 'parents' | 'children' | 'both';
  /** 单位、精度、背景等；“所有新建画板”写这里，“当前画板”写在文档里。 */
  display: DisplayPrefs;
  toolFolder?: string;
}
const DEFAULT_SETTINGS: Settings = {
  power: 'low', font: { name: 'Times New Roman', size: 16, bold: false, italic: false, underline: false, color: '#000000' }, polygonBorders: false, autoSnap: false, autoLabel: false, textbarOnEdit: true, recent: [], doubleClickDeselect: false,
  autoLabelMeasured: true, paramEdit: true, funcSymbol: false,
  colors: { point: '#ff0000', line: '#000080', circle: '#008000', plot: '#000080', locus: '#000080', interior: '#ffff00', randomInterior: true, autoUpdate: true, fade: false, fadeTime: 5 },
  polyOpacity: 50, marker: { color: '#ff0000', thick: true }, infoDescribe: 'parents', display: { ...DEFAULT_DISPLAY },
};

interface Clip { json: string; image?: string; mime?: string }

export class App {
  root: HTMLElement;
  docs: DocView[] = [];
  active!: DocView;
  settings: Settings = { ...DEFAULT_SETTINGS };
  /** 工具文件夹里载入的工具（按文件分组）和当前选用的自定义工具。 */
  toolGroups: ToolGroup[] = [];
  customTool?: Tool;
  dlg = new Dialogs(this);
  anim = new Animator(this);
  mdi: Mdi;
  motion = new Motion(this);
  toolbox: Toolbox;
  status = document.createElement('div');
  textbar = document.createElement('div');
  menubar = document.createElement('nav');
  pagebar = document.createElement('div');
  textbarVisible = false;
  toolboxVisible = true;
  private clip?: Clip;
  private counter = 0;
  private ctxMenu = new ContextMenu(this);
  private flash?: number;

  constructor(root: HTMLElement) {
    this.root = root;
    this.loadSettings();
    root.className = 'app';
    this.menubar.id = 'menubar';
    const main = document.createElement('div'); main.className = 'main';
    this.toolbox = new Toolbox(this);
    const area = document.createElement('div'); area.className = 'docarea';
    this.mdi = new Mdi(area, this);
    this.textbar.id = 'textbar'; this.textbar.hidden = true;
    this.pagebar.id = 'pagebar'; this.pagebar.hidden = true;
    this.status.id = 'status';
    const right = document.createElement('div'); right.className = 'right'; right.append(area, this.pagebar, this.textbar, this.status);
    main.append(this.toolbox.el, right);
    root.append(this.menubar, main, this.ctxMenu.el);
    this.buildTextbar();
    buildMenus(this);
    window.addEventListener('keydown', e => this.onKey(e), true);
    window.setInterval(() => this.fadeTraces(), 200);
    window.addEventListener('beforeunload', e => { if (this.docs.some(d => d.store.dirty)) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('resize', () => this.docs.forEach(d => d.resize()));
    window.addEventListener('focus', () => { void desktop.readClipboardImage().then(i => { this.sysImage = !!i; }); });
    window.addEventListener('paste', e => { const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/')); if (!f || this.active.textEdit) return; e.preventDefault(); void f.arrayBuffer().then(buf => { const u = new Uint8Array(buf); let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode(...u.subarray(i, i + 0x8000)); this.pasteImage(this.active, btoa(b), f.type); }); });
    desktop.onCloseRequested(async () => this.quit());
    void this.reloadToolFolder();
    this.newDocument();
    this.updateStatus();
  }

  // ---------- 设置 ----------
  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('newgsp.settings') ?? '{}') as Partial<Settings>;
      Object.assign(this.settings, saved);
      // 老设置文件里没有的子项用默认值补齐
      this.settings.colors = { ...DEFAULT_SETTINGS.colors, ...saved.colors };
      this.settings.marker = { ...DEFAULT_SETTINGS.marker, ...saved.marker };
      this.settings.display = { ...DEFAULT_DISPLAY, ...saved.display };
    } catch { /* 用默认值 */ }
    this.applyNewObjectDefaults();
  }
  /** 把参数选项里的默认颜色和透明度用到之后新建的对象上。 */
  applyNewObjectDefaults() {
    const c = this.settings.colors;
    Object.assign(DEFAULT_COLORS, { point: c.point, dependentPoint: c.point, line: c.line, circle: c.circle, arc: c.circle, plot: c.plot, locus: c.locus, interior: c.interior, randomInterior: c.randomInterior, interiorAlpha: Math.max(0, Math.min(100, this.settings.polyOpacity)) / 100 });
  }
  /** 淡入淡出：追踪踪迹按设定的时间逐渐消失。 */
  private fadeTraces() {
    const c = this.settings.colors;
    if (c.fade) for (const d of this.docs) d.fadeTrace(0.2 / Math.max(0.5, c.fadeTime));
  }
  /** 选择工具文件夹：读出里面的工具文件；桌面版可以顺便复制到新版自己的工具文件夹。按住 Shift 选“忽略工具文件夹”。 */
  async chooseToolFolder(ignore = false) {
    if (ignore) { this.toolGroups = []; this.customTool = undefined; delete this.settings.toolFolder; this.saveSettings(); this.setTool('move'); return; }
    let path = await desktop.pickFolder(), files = path ? await desktop.readToolFolder(path) : await desktop.pickBrowserFolder();
    if (!files) return;
    const groups = this.parseToolFiles(files);
    if (!groups.length) { await this.dlg.message('这个文件夹里没有找到带自定义工具的画板文件。'); return; }
    const total = groups.reduce((n, g) => n + g.tools.length, 0);
    if (path && await this.dlg.confirm(`找到 ${groups.length} 个工具文件、${total} 个工具。要把它们复制到新版自己的工具文件夹吗？复制后不再依赖原来的文件夹。`)) {
      const r = await desktop.importToolFolder(path);
      if (r) path = r.path;
    }
    this.toolGroups = groups;
    if (path) this.settings.toolFolder = path;
    this.saveSettings();
    await this.dlg.message(`已载入 ${groups.length} 个工具文件、${total} 个工具，在自定义工具菜单里选用。`);
  }
  private parseToolFiles(files: { name: string; bytes: Uint8Array }[]): ToolGroup[] {
    return files.flatMap(f => { try { const g = loadToolFile(f.name, f.bytes); return g ? [g] : []; } catch { return []; } });
  }
  /** 启动时按上次记下的工具文件夹重新载入（桌面版）。 */
  async reloadToolFolder() {
    const dir = this.settings.toolFolder;
    if (!dir || !desktop.native) return;
    try { this.toolGroups = this.parseToolFiles(await desktop.readToolFolder(dir)); } catch { /* 文件夹没了就当没有 */ }
  }
  /** 选用一个工具：之后在画板里依次点选它的前提条件。 */
  useTool(t: Tool) {
    this.customTool = t;
    this.setTool('custom');
  }
  useToolRef(r: ToolRef) { this.useTool(resolveTool(r)); }
  /** 当前文档里内嵌的工具（解析好的）。 */
  docTools(): Tool[] { return (this.active?.store.doc.tools ?? []).map(t => resolveEmbedded(t)); }
  /** 由当前选中的对象创建工具，放进当前文档，并马上选用。 */
  async createToolFromSelection() {
    const v = this.active; if (!v) return;
    const made = createToolObjects(v.store.page, v.sel);
    if ('error' in made) { await this.dlg.message(made.error); return; }
    const info = await this.dlg.newToolInfo(v.store.doc.tools?.map(t => t.name) ?? []);
    if (!info) return;
    let emb;
    try { emb = encodeToolBody(made.objects, info.name, made.prereq, info.comment || undefined); }
    catch (e) { await this.dlg.message(`这些对象暂时不能做成工具：${(e as Error).message}`); return; }
    v.store.run('创建新工具', () => { (v.store.doc.tools ??= []).push(emb); });
    this.useTool(resolveEmbedded(emb));
  }
  saveSettings() { try { localStorage.setItem('newgsp.settings', JSON.stringify(this.settings)); } catch { /* 无法持久化时忽略 */ } }

  // ---------- 文档 ----------
  get view(): DocView { return this.active; }
  ctx(shift = false): Ctx { return { app: this, view: this.active, shift }; }

  addView(store: Store, path?: string): DocView {
    const v = new DocView(this, store);
    v.path = path;
    v.tool = this.toolbox.current;
    this.docs.push(v);
    this.mdi.add(v);
    this.focusDoc(v);
    v.resize();
    return v;
  }
  newDocument() {
    const doc = newDoc(`未命名${++this.counter}`);
    doc.settings.autoLabelPoints = this.settings.autoLabel;
    doc.settings.display = structuredClone(this.settings.display);
    this.addView(new Store(doc));
  }
  focusDoc(v: DocView) { this.active = v; this.mdi.activate(v); this.refresh(); }

  async openFile(path?: string) {
    const f = await desktop.openFile(path);
    if (!f) return;
    try {
      const r = decodeFile(f.bytes, f.name);
      const store = new Store(r.doc);
      store.source = r.source;
      store.protectedReason = (r.source as Source).protectedReason;
      const v = this.addView(store, f.path);
      v.store.doc.name = f.name.replace(/\.n?gsp$/i, '');
      if (r.notes.length) this.dlg.message(r.notes.join('\n'));
      this.addRecent(f.path ?? f.name);
      v.resize();
      for (const id of store.page.startupButtons ?? []) {
        const button = store.get(id);
        if (button?.def.k !== 'button') continue;
        const action = button.def.action.type;
        if (action === 'animate' || action === 'hideshow' || (action === 'move' && !store.protectedReason)) this.pressButton(v, button);
      }
    } catch (e) { this.dlg.message(`无法打开文件：${e instanceof Error ? e.message : String(e)}`); }
  }
  addRecent(p: string) { this.settings.recent = [p, ...this.settings.recent.filter(x => x !== p)].slice(0, 8); this.saveSettings(); buildMenus(this); }

  async save(v: DocView, saveAs: boolean): Promise<boolean> {
    try {
      const st = v.store;
      let bytes: Uint8Array, ext: 'gsp' | 'ngsp' = 'gsp', notes: string[] = [];
      let src = st.source as Source | undefined;
      if (src?.kind === 'ngsp' && v.path?.toLowerCase().endsWith('.ngsp') && !saveAs) { bytes = encodeNgsp(st.doc); ext = 'ngsp'; }
      else {
        const enc = encodeFile(st.doc, st.source);
        if (enc.ok) { bytes = enc.bytes; src = enc.source; notes = enc.notes ?? []; }
        else {
          const go = await this.dlg.confirm(`${enc.reason}

可以改存为“新版课件”（.ngsp）：它完整保存所有内容，只能用新版打开。要这样保存吗？`);
          if (!go) return false;
          bytes = encodeNgsp(st.doc); ext = 'ngsp'; src = { kind: 'ngsp' };
        }
      }
      const keepPath = !saveAs && v.path && v.path.toLowerCase().endsWith(`.${ext}`) ? v.path : undefined;
      const res = await desktop.saveFile(bytes, keepPath, `${st.doc.name}.${ext}`, ext);
      if (!res) return false;
      v.path = res.path;
      st.doc.name = res.name.replace(/\.n?gsp$/i, '');
      st.source = src;
      st.markSaved();
      if (res.path) this.addRecent(res.path);
      this.setStatus(`已保存 ${res.name}`);
      if (notes.length) void this.dlg.message(`已保存。注意：${notes.join('；')}。`);
      void desktop.deleteRecovery(v.rid);
      return true;
    } catch (e) { this.dlg.message(`保存失败，原文件保持不变：${e instanceof Error ? e.message : String(e)}`); return false; }
  }
  /** 关闭前询问是否保存；返回 false 表示用户取消。 */
  async confirmClose(v: DocView): Promise<boolean> {
    await v.waitForDrag();
    if (!v.store.dirty) return true;
    const r = await this.dlg.ask(`要保存对“${v.store.doc.name}”的修改吗？`, ['保存', '不保存', '取消']);
    if (r === '取消' || r === undefined) return false;
    if (r === '保存') return this.save(v, false);
    return true;
  }
  async closeDocument(v: DocView) {
    if (!(await this.confirmClose(v))) return;
    this.anim.stopView(v);
    v.cancelDrag();
    void desktop.deleteRecovery(v.rid);
    v.dispose();
    this.docs = this.docs.filter(d => d !== v);
    this.mdi.remove(v);
    if (!this.docs.length) this.newDocument();
    else this.focusDoc(this.docs[this.docs.length - 1]);
  }
  async quit(): Promise<boolean> {
    for (const v of [...this.docs]) { this.focusDoc(v); if (!(await this.confirmClose(v))) return false; }
    this.anim.stopAll();
    for (const v of this.docs) await desktop.deleteRecovery(v.rid).catch(() => undefined);
    await desktop.exit();
    return true;
  }
  printPreview(v: DocView) { printDocument(v, true); }
  print(v: DocView) { printDocument(v, false); }

  // ---------- 选择 / 编辑 ----------
  setTool(t: ToolId) {
    this.toolbox.setTool(t);
    for (const d of this.docs) { d.tool = t; d.cancelDrag(); }
    this.updateStatus();
  }
  toolHint(): string {
    const h: Record<string, string> = {
      move: '', rotate: '拖动选中的对象绕标记中心旋转', scale: '拖动选中的对象围绕标记中心缩放', point: '单击放置点；在线或圆上单击放置依附点',
      circle: '单击或按下圆心，再单击或拖到圆周上的点', segment: '单击或按下起点，再单击或拖到终点', ray: '单击或按下起点，再单击或拖向射线方向', line: '单击或按下一点，再单击或拖向直线方向',
      'poly-fill': '依次单击顶点；双击末点或回到首点结束', 'poly-both': '依次单击顶点；双击末点或回到首点结束', 'poly-edges': '依次单击顶点；双击末点或回到首点结束',
      text: '拖动建立文本框，或双击放置文本', marker: '按住拖动绘制笔迹', info: '单击对象查看它的说明', custom: '',
    };
    if (this.toolbox.current === 'custom') {
      const t = this.customTool, v = this.active;
      if (!t) return '从自定义工具菜单里选一个工具';
      v?.fillAutoInputs(t);
      const i = v ? v.nextToolInput(t) ?? t.inputs.length : 0, need = t.inputs[i];
      const label = need?.label ? `（${need.label}）` : '';
      return `${t.name}：${need ? `第 ${i + 1}/${t.inputs.length} 个前提条件${label}，请${toolInputPrompt(need)}` : '单击画板应用工具'}`;
    }
    return h[this.toolbox.current] ?? '';
  }
  toolSelectAllName(v: DocView): string | undefined {
    const m: Partial<Record<ToolId, string>> = { point: '点', circle: '圆', segment: '线段', ray: '射线', line: '直线', 'poly-fill': '多边形', 'poly-both': '多边形', 'poly-edges': '多边形', text: '文本', marker: '标记' };
    return m[v.tool];
  }
  selectAll(v: DocView) {
    const st = v.store;
    const filt: Partial<Record<ToolId, (o: Obj) => boolean>> = {
      point: o => classOf(o) === 'point', circle: o => classOf(o) === 'circle', segment: o => o.def.k === 'seg', ray: o => o.def.k === 'ray', line: o => o.def.k === 'line',
      'poly-fill': o => o.def.k === 'poly', 'poly-both': o => o.def.k === 'poly', 'poly-edges': o => o.def.k === 'poly', text: o => o.def.k === 'text', marker: o => o.def.k === 'stroke',
    };
    const f = filt[v.tool];
    v.setSel(st.page.objects.filter(o => !o.hidden && (f ? f(o) : true)).map(o => o.id));
  }
  clearSelected(v: DocView, name: string) {
    const ids = v.sel.slice();
    v.store.run(`${name}${analyse(v).sameType ?? '对象'}`, () => v.store.remove(ids));
    v.sel = [];
    this.anim.prune(v);
  }

  // ---------- 剪贴板（新版格式，保留内部依赖） ----------
  copy(v: DocView) {
    const st = v.store, sel = new Set(v.sel);
    // 拷贝选中的对象及其所有祖先（作为外部父对象一起复制，保证粘贴后可独立求值）
    const need = new Set<Id>(sel);
    const add = (id: Id) => { for (const p of st.parents(id)) if (!need.has(p)) { need.add(p); add(p); } };
    sel.forEach(add);
    const objs = st.page.objects.filter(o => need.has(o.id)).map(o => ({ ...structuredClone(o), external: !sel.has(o.id) }));
    this.clip = { json: JSON.stringify({ app: 'newgsp', objs }) };
    void desktop.writeClipboardText?.(this.clip.json).catch(() => undefined);
  }
  clipboardIsImage() { return !!this.clip?.image; }
  /** 系统剪贴板里是否有图片（窗口获得焦点时探测）。 */
  sysImage = false;
  /** 桌面版读系统剪贴板要起一个 PowerShell，焦点事件之间剪贴板可能变化，所以桌面版的粘贴始终可用（没有图片时什么也不做）。 */
  canPaste() { return !!this.clip || this.sysImage || desktop.native; }
  paste(v: DocView) {
    if (!this.clip) { void this.pasteFromSystem(v); return; }
    const st = v.store;
    if (this.clip.image) { this.pasteImage(v, this.clip.image, this.clip.mime ?? 'image/png'); return; }
    const data = JSON.parse(this.clip.json) as { objs: (Obj & { external?: boolean })[] };
    const map = new Map<Id, Id>(), made: Id[] = [];
    st.run('粘贴', () => {
      const off = 20;
      for (const src of data.objs) {
        const def = remapDef(structuredClone(src.def), map);
        if (def.k === 'free') { def.x += off; def.y += off; }
        if (def.k === 'text' || def.k === 'button' || (def.k === 'image' && !def.placement)) def.at = { x: def.at.x + off, y: def.at.y + off };
        const o = st.add(def, { style: { ...src.style }, hidden: src.hidden, label: undefined, labelShown: false, at: src.at && { x: src.at.x + off, y: src.at.y + off } });
        map.set(src.id, o.id);
        if (!src.external) made.push(o.id);
      }
    });
    v.setSel(made);
  }
  /** 粘贴图片：统一转成 PNG（原版文件里图片只有 PNG 一种存法），按原始像素大小放在画板左上角（原版默认位置约 (14, 9)）。 */
  pasteImage(v: DocView, data: string, mime: string) {
    void (async () => {
      let png = { data, mime, w: 200, h: 150 };
      try { png = await toPng(data, mime); } catch { /* 解码失败：沿用原数据与默认大小，保存时会提示 */ }
      const st = v.store, k = Math.min(1, 800 / Math.max(png.w, png.h));
      let made: Obj | undefined;
      st.run('粘贴图片', () => { made = st.add({ k: 'image', data: png.data, mime: png.mime, at: { x: 14, y: 9 }, w: Math.round(png.w * k), h: Math.round(png.h * k) }, {}); });
      if (made) v.setSel([made.id]);
    })();
  }
  async pasteFromSystem(v: DocView) {
    const img = await desktop.readClipboardImage?.();
    if (img) { this.clip = { json: '', image: img.data, mime: img.mime }; this.pasteImage(v, img.data, img.mime); }
  }

  /** 分离/合并：合并两点、合并点到路径、从路径分离点、从定义分离点、合并文本到点。 */
  splitMerge(v: DocView, s: Sel, shift: boolean) {
    const st = v.store, pos = (id: Id) => { const r = st.results.get(id)?.shape; return r?.k === 'pt' ? r.p : undefined; };
    const source = shift ? mergeTextSource(s) : undefined;
    if (source && source.def.k !== 'text') {
      const anchor = s.pts[0].id, p = pos(anchor);
      if (!p) return;
      const w = 40, h = 24, off = { x: -w / 2, y: -h / 2 };
      const copy = st.run('合并文本到点', () => st.add({
        k: 'text', text: '0', refs: [source.id], anchor, off,
        at: { x: p.x + off.x, y: p.y + off.y }, w, h, font: { ...this.settings.font },
      }));
      v.setSel([copy.id]);
      return;
    }
    st.run('分离/合并', () => {
      if (s.n === 2 && s.pts.length === 2) {
        // 第一个点并入第二个点：凡是依赖前者的对象改为依赖后者，然后删除前者
        let [from, to] = s.pts;
        if (from.def.k !== 'free') [from, to] = [to, from];
        const order = new Map(st.page.objects.map((o, i) => [o.id, i]));
        const children = st.page.objects.filter(o => o.id !== from.id && st.parents(o.id).includes(from.id));
        if (children.some(c => order.get(c.id)! < order.get(to.id)!)) throw new Error('目标点比依赖它的对象创建得晚，不能合并');
        const map = new Map<Id, Id>([[from.id, to.id]]);
        for (const c of children) c.def = remapDef(structuredClone(c.def), map);
        st.page.objects = st.page.objects.filter(o => o.id !== from.id);
        st.recompute();
      } else if (s.n === 2 && s.pts.length === 1 && s.paths.length === 1) {
        const p = s.pts[0], path = s.paths[0], at = pos(p.id), shape = st.results.get(path.id)?.shape;
        if (p.def.k !== 'free' || !at) throw new Error('只有自由点可以合并到路径上');
        const pr = projectOnPath(st.page, st.results, path.id, at); void shape;
        if (!pr) throw new Error('这个点不能合并到所选路径');
        if (st.page.objects.findIndex(o => o.id === path.id) > st.page.objects.findIndex(o => o.id === p.id)) throw new Error('路径比这个点创建得晚，不能合并');
        st.update(p.id, { k: 'onpath', path: path.id, t: pr.t, ...(pr.side ?? {}), ...(pr.abs ? { abs: true } : {}) });
      } else if (s.n === 1 && s.onpath.length === 1) {
        const p = pos(s.onpath[0].id);
        if (p) st.update(s.onpath[0].id, { k: 'free', x: p.x, y: p.y });
      } else if (shift && s.n === 1 && s.pts.length === 1 && ['rotate', 'reflect', 'dilate', 'translate'].includes(s.pts[0].def.k)) {
        const p = pos(s.pts[0].id);
        if (p) st.update(s.pts[0].id, { k: 'free', x: p.x, y: p.y });
      } else if (source) {
        const t = source;
        const ap = pos(s.pts[0].id), tb = st.results.get(t.id)?.shape;
        if (t.def.k === 'text' && ap && tb?.k === 'box') st.update(t.id, { ...t.def, anchor: s.pts[0].id, off: { x: tb.at.x - ap.x, y: tb.at.y - ap.y } });   // 文本随点移动
      }
    });
  }
  editDefinition(v: DocView, o: Obj) {
    const d = o.def;
    if (d.k === 'param') void this.dlg.editParam(v, o);
    else if (d.k === 'calc') void this.dlg.editCalc(v, o);
    else if (d.k === 'func') void this.dlg.editFunc(v, o);
    else if (d.k === 'text') v.beginTextEdit(o.id);
  }

  // ---------- 创建杂项对象 ----------
  /** 新度量/参数的默认位置：左上角依次排列，避免重叠。 */
  nextTextPos(v: DocView): Pt {
    const n = v.store.page.objects.filter(o => o.at && ['measure', 'param', 'calc', 'table', 'func', 'picfunc'].includes(o.def.k)).length;
    return { x: v.scroll.x + 24, y: v.scroll.y + 24 + n * 24 };
  }
  makeButton(v: DocView, action: ButtonAction, text?: string) {
    const st = v.store;
    const label = text ?? buttonText(v, action);
    const n = st.page.objects.filter(o => o.def.k === 'button').length;
    let made: Obj | undefined;
    st.run('构造按钮', () => { made = st.add({ k: 'button', action, text: label, at: { x: v.scroll.x + 24, y: v.scroll.y + 24 + n * 36 }, ...buttonSize(label) }); });
    if (made) v.setSel([made.id]);
  }
  makeTable(v: DocView, s: Sel) {
    const st = v.store;
    let made: Obj | undefined;
    st.run('制表', () => {
      const cols = s.objs.map(o => o.id);
      const row = cols.map(id => st.results.get(id)?.shape).map(sh => (sh?.k === 'num' ? sh.q.v : 0));
      made = st.add({ k: 'table', cols, rows: [row] }, { at: this.nextTextPos(v) });
    });
    if (made) v.setSel([made.id]);
  }
  async newFunction(v: DocView, plot: boolean) {
    const r = await this.dlg.func(v, undefined);
    if (!r) return;
    const st = v.store;
    const made: Id[] = [];
    st.run(plot ? '绘制新函数' : '新建函数', () => {
      const f = st.add({ k: 'func', name: r.name, expr: r.expr, param: r.variable, ...(r.form !== 'y=f(x)' ? { form: r.form } : {}), ...(r.symbol ? { symbol: true } : {}) }, { at: this.nextTextPos(v), label: r.name });
      made.push(f.id);
      if (plot) {
        const sys = findSys(st) ?? createSystem(st);
        made.push(st.add({ k: 'plot', func: f.id, sys: sys.id, samples: 300 }, { style: { color: '#000080', pointSize: 2, width: 2, dash: 'solid' } }).id);
      }
    });
    v.setSel(made.slice(-1));
  }
  /** 为已有函数画图像（选中函数时的“绘制函数”）。 */
  plotFunction(v: DocView, f: Obj) {
    const st = v.store; let made: Obj | undefined;
    st.run('绘制函数', () => {
      const sys = findSys(st) ?? createSystem(st);
      made = st.add({ k: 'plot', func: f.id, sys: sys.id, samples: 300 }, { style: { color: '#000080', pointSize: 2, width: 2, dash: 'solid' } });
    });
    if (made) v.setSel([made.id]);
  }
  makeParamCurve(v: DocView, r: { fx: Id; fy: Id; polar: boolean; lo: number; hi: number }) {
    const st = v.store;
    let made: Obj | undefined;
    st.run('绘制曲线', () => {
      let sys = findSys(st);
      if (!sys) { sys = createSystem(st); if (r.polar) setGridStyle(st, sys, 'polar'); }   // 没有坐标系时按所选模式建立（原版实测：极坐标建极坐标网格）
      made = st.add({ k: 'pcurve', fx: r.fx, fy: r.fy, sys: sys.id, lo: r.lo, hi: r.hi, polar: r.polar, samples: 750 });
    });
    if (made) v.setSel([made.id]);
  }
  defineSystem(v: DocView, s: Sel) {
    const st = v.store;
    if (findSys(st)) { this.dlg.message('页面上已经有坐标系了。'); return; }
    let m: Obj | undefined;
    st.run('定义坐标系', () => { m = createSystem(st, s.pts[0] && (st.results.get(s.pts[0].id)?.shape as { p: Pt } | undefined)?.p); });
    if (m) v.setSel([m.id]);
  }
  setGrid(v: DocView, grid: 'square' | 'rect' | 'polar' | 'tri') {
    const st = v.store;
    st.run('网格样式', () => setGridStyle(st, findSys(st) ?? createSystem(st), grid));
  }
  toggleGrid(v: DocView, whole: boolean) {
    const st = v.store;
    st.run(whole ? '显示坐标系' : '显示网格', () => {
      const sys = findSys(st);
      if (whole && sys) { st.setHidden([sys.id, (sys.def as { axisX: Id }).axisX, (sys.def as { axisY: Id }).axisY], !sys.hidden); return; }
      const s = sys ?? createSystem(st);
      if (s.def.k === 'sys') st.update(s.id, { ...s.def, showGrid: !s.def.showGrid });
    });
  }
  toggleGridPoints(v: DocView) { const st = v.store; const s = findSys(st); if (!s || s.def.k !== 'sys') return; const d = s.def; st.run('格点', () => st.update(s.id, { ...d, gridPoints: d.gridPoints ? undefined : true })); }
  toggleAutoSnap(v: DocView) { const st = v.store; st.run('自动吸附网格', () => { st.page.autoSnap = !pageAutoSnap(st.page); }); }
  async plotPoint(v: DocView, s: Sel) {
    const st = v.store;
    const sys = findSys(st);
    if (s.n === 2 && s.numeric.length === 2) {
      let m: Obj | undefined;
      st.run('绘制点', () => { const sy = sys ?? createSystem(st); m = st.add({ k: 'plotxy', x: s.numeric[0].id, y: s.numeric[1].id, sys: sy.id }); });
      if (m) v.setSel([m.id]); return;
    }
    const r = await this.dlg.plotXY(v);
    if (!r) return;
    let m: Obj | undefined;
    st.run('绘制点', () => {
      const sy = sys ?? createSystem(st);
      const x = st.add({ k: 'param', name: 'x', value: r.x, unit: 'none', showEdit: false }, { hidden: true });
      const y = st.add({ k: 'param', name: 'y', value: r.y, unit: 'none', showEdit: false }, { hidden: true });
      m = st.add({ k: 'plotxy', x: x.id, y: y.id, sys: sy.id });
    });
    if (m) v.setSel([m.id]);
  }
  plotTable(v: DocView, t: Obj) {
    const st = v.store;
    if (t.def.k !== 'table' || t.def.cols.length < 2) { this.dlg.message('表格至少要有两列数据才能绘图。'); return; }
    const made: Id[] = [], d = t.def;
    st.run('绘制表中数据', () => {
      const sy = findSys(st) ?? createSystem(st);
      for (let r = 0; r < d.rows.length; r++) {
        const x = st.add({ k: 'param', name: `x${r + 1}`, value: d.rows[r][0], unit: 'none', showEdit: false }, { hidden: true });
        const y = st.add({ k: 'param', name: `y${r + 1}`, value: d.rows[r][1], unit: 'none', showEdit: false }, { hidden: true });
        made.push(st.add({ k: 'plotxy', x: x.id, y: y.id, sys: sy.id }).id);
      }
    });
    v.setSel(made);
  }

  // ---------- 文本格式 ----------
  private objectFont(v: DocView, o: Obj): FontSpec {
    if (o.def.k === 'text') return o.def.font;
    const cat = o.def.k === 'button' ? 'button' : o.def.k === 'table' || o.def.k === 'itertable' ? 'table' : 'value';
    return o.font ?? { ...TEXT_DEFAULTS[cat].style, ...pageDisplay(v.store.doc, v.store.page, v.fallbackDisplay).textStyles?.[cat] };
  }
  private formatObjects(v: DocView, apply: (f: FontSpec) => FontSpec) {
    const targets = fontTargets(analyse(v));
    v.store.run('文本格式', () => { for (const o of targets) {
      if (o.def.k === 'text') v.store.update(o.id, { ...o.def, font: apply(o.def.font), ...(o.def.runs ? { runs: o.def.runs.map(r => ({ ...r, font: apply(r.font) })) } : {}) });
      else o.font = apply(this.objectFont(v, o));
    } });
    v.invalidate();
  }
  toggleFont(v: DocView, key: 'bold' | 'italic' | 'underline') {
    const apply = (f: FontSpec) => ({ ...f, [key]: !f[key] });
    if (v.textEdit) {
      const f = v.textEditFont(); if (!f) return;
      const value = !f[key]; v.styleTextSelection(font => ({ ...font, [key]: value }));
      this.settings.font = { ...f, [key]: value }; this.refreshTextbar(); return;
    }
    const sel = fontTargets(analyse(v));
    this.formatObjects(v, apply);
    if (sel[0]?.def.k === 'text') this.settings.font = sel[0].def.font;
    this.refreshTextbar();
  }
  fontSize(v: DocView, delta: number) {
    const apply = (f: FontSpec) => ({ ...f, size: Math.max(6, Math.min(96, f.size + delta)) });
    if (v.textEdit) {
      v.styleTextSelection(apply); this.refreshTextbar(); return;
    }
    this.formatObjects(v, apply);
    this.refreshTextbar();
  }
  setFont(v: DocView, patch: Partial<FontSpec>) {
    if (v.textEdit) v.styleTextSelection(f => ({ ...f, ...patch }));
    else this.formatObjects(v, f => ({ ...f, ...patch }));
    Object.assign(this.settings.font, patch);
    v.store.recompute(); v.invalidate(); this.refreshTextbar();
  }
  private buildTextbar() {
    const bar = this.textbar, mk = <K extends keyof HTMLElementTagNameMap>(t: K, cls = '') => { const e = document.createElement(t); if (cls) e.className = cls; return e; };
    const font = mk('select'), size = mk('select');
    for (const f of ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'Times New Roman', 'Arial', 'Consolas']) font.add(new Option(f, f));
    for (const s of [10, 12, 14, 16, 18, 20, 24, 28, 36, 48]) size.add(new Option(String(s), String(s)));
    const color = mk('input'); color.type = 'color';
    const b = (t: string, k: 'bold' | 'italic' | 'underline') => { const x = mk('button'); x.textContent = t; x.dataset.k = k; x.onmousedown = e => e.preventDefault(); x.onclick = () => this.toggleFont(this.active, k); x.style.fontWeight = k === 'bold' ? 'bold' : ''; x.style.fontStyle = k === 'italic' ? 'italic' : ''; x.style.textDecoration = k === 'underline' ? 'underline' : ''; return x; };
    font.onchange = () => this.setFont(this.active, { name: font.value }); size.onchange = () => this.setFont(this.active, { size: Number(size.value) });
    color.oninput = () => this.setFont(this.active, { color: color.value });
    const sym = mk('button'); sym.textContent = 'Ω'; sym.title = '插入符号'; sym.onmousedown = e => e.preventDefault();
    sym.onclick = () => { const ta = this.active.textEdit?.ta; if (ta) { ta.setRangeText('∠', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); } };
    bar.append(font, size, color, b('B', 'bold'), b('I', 'italic'), b('U', 'underline'), sym);
    this.textbarEls = { font, size, color };
  }
  private textbarEls!: { font: HTMLSelectElement; size: HTMLSelectElement; color: HTMLInputElement };
  refreshTextbar() {
    const v = this.active; if (!v) return;
    const editing = !!v.textEdit, selText = fontTargets(analyse(v))[0];
    const o = editing ? v.store.get(v.textEdit!.id) : selText;
    const f = (editing ? v.textEditFont() : undefined) ?? (o ? this.objectFont(v, o) : this.settings.font);
    const { font, size, color } = this.textbarEls;
    font.value = f.name; size.value = String(f.size); color.value = f.color;
    const on = editing || !!selText;
    for (const el of this.textbar.querySelectorAll<HTMLElement>('select,input,button')) (el as HTMLButtonElement).disabled = !on;
    this.textbar.querySelectorAll<HTMLElement>('button[data-k]').forEach(el => el.classList.toggle('on', !!(f as unknown as Record<string, boolean>)[el.dataset.k!]));
    if (editing && this.settings.textbarOnEdit && !this.textbarVisible) { this.textbarVisible = true; this.textbar.hidden = false; }
  }
  toggleTextbar() { this.textbarVisible = !this.textbarVisible; this.textbar.hidden = !this.textbarVisible; this.refreshTextbar(); this.docs.forEach(d => d.resize()); }
  toggleToolbox() { this.toolboxVisible = !this.toolboxVisible; this.toolbox.el.hidden = !this.toolboxVisible; this.docs.forEach(d => d.resize()); }

  // ---------- 按钮、信息 ----------
  pressButton(v: DocView, o: Obj, path: readonly Id[] = []) {
    if (o.def.k !== 'button' || path.includes(o.id)) return;
    const a = o.def.action, st = v.store;
    switch (a.type) {
      case 'hideshow': {
        const targets = a.targets.map(id => st.get(id)).filter((x): x is Obj => !!x);
        const hide = a.mode === 'toggle' ? (a.first ? a.first === 'hide' : !targets.every(t => t.hidden)) : a.mode === 'hide';
        for (const t of targets) t.hidden = hide;
        if (a.mode === 'toggle' && a.first) a.first = hide ? 'show' : 'hide';   // 切换按钮：按下后下一次执行相反的动作（原版文件里同样记在按钮里）
        st.recompute();
        if (!hide && a.select !== false) v.setSel(targets.map(t => t.id));
        v.invalidate(); break;
      }
      case 'animate': this.anim.toggle(v, a.targets.map(id => st.get(id)).filter((x): x is Obj => !!x), a.speed, a.direction); break;
      case 'move': {
        for (const [from, to] of [[a.from, a.to], ...(a.pairs ?? [])]) this.anim.moveTo(v, from, to, a.speed, a.toInitial);
        break;
      }
      case 'link': {
        const topic = a.url && legacyHelpTopic(a.url);
        if (topic) void this.dlg.message(topic);
        else if (a.url) void desktop.openUrl(a.url).catch(() => this.dlg.message('系统未能打开这个链接。'));
        else if (a.page >= 1 && a.page <= st.doc.pages.length) { st.switchPage(a.page - 1); v.sel = []; this.refresh(); }
        break;
      }
      case 'scroll': { const s = st.results.get(a.point)?.shape; if (s?.k === 'pt') { v.scroll = a.where === 'center' ? { x: s.p.x - (v.canvas.width / v.dpr) / 2, y: s.p.y - (v.canvas.height / v.dpr) / 2 } : { x: s.p.x, y: s.p.y }; v.updateView(); v.eraseTraces(); v.invalidate(); } break; }
      case 'sound': playFunctions(v, a.funcs); break;
      case 'series': {
        // 开始前：取消选定 / 停止动画 / 清除追踪；然后同时或依序执行各按钮；“持续时间”到点后停止动画
        if (a.deselect) v.setSel([]);
        if (a.stopAnim) this.anim.stopView(v);
        if (a.clearTraces) v.eraseTraces();
        const steps = a.buttons.map(id => st.get(id)).filter((x): x is Obj => !!x && x.def.k === 'button');
        // 只拦截当前执行路径上的循环，允许一个系列正常重复执行同一按钮。
        const nextPath = [...path, o.id];
        const press = (b: Obj) => this.pressButton(v, b, nextPath);
        if (a.mode === 'seq') { let t = 0; for (const b of steps) { window.setTimeout(() => press(b), t); t += (a.seconds ?? 0) * 1000 + (b.def.k === 'button' && (b.def.action.type === 'move' || b.def.action.type === 'animate') ? 1000 : 0); } }
        else steps.forEach(press);
        if (a.after === 'duration' && a.seconds) window.setTimeout(() => this.anim.stopView(v), a.seconds * 1000);
        break;
      }
    }
  }
  describe(v: DocView, id: Id): string {
    const st = v.store, o = st.get(id)!;
    const nm = (i: Id) => { const x = st.get(i); return x ? (x.label ?? `${typeName(x)}#${this.ordinal(v, x)}`) : '?'; };
    const head = `${typeName(o)} #${this.ordinal(v, o)}`;
    const d = o.def;
    switch (d.k) {
      case 'free': return `${head}\n独立的点`;
      case 'onpath': return `${head}\n依附于 ${nm(d.path)} 的点`;
      case 'mid': return `${head}\n${nm(d.seg)} 的中点`;
      case 'inter': return `${head}\n${nm(d.a)} 与 ${nm(d.b)} 的交点`;
      case 'seg': case 'ray': case 'line': return `${head}\n经过 ${nm(d.a)} 和 ${nm(d.b)}`;
      case 'circle': return `${head}\n圆心 ${nm(d.c)}，经过 ${nm(d.p)}`;
      default: { const ps = parentsOf(d); return ps.length ? `${head}\n由 ${ps.map(nm).join('、')} 确定` : head; }
    }
  }
  /** 信息工具的气泡：按参数选项描述父对象、子对象或两者。 */
  describeForInfo(v: DocView, id: Id): string {
    const mode = this.settings.infoDescribe, st = v.store;
    const base = this.describe(v, id);
    if (mode === 'parents') return base;
    const kids = childrenOf(st.page, id).map(o => o.label ?? `${typeName(o)} #${this.ordinal(v, o)}`);
    const kidLine = kids.length ? `子对象：${kids.join('、')}` : '没有子对象';
    return mode === 'children' ? `${base.split('\n')[0]}\n${kidLine}` : `${base}\n${kidLine}`;
  }
  /** 对象的序号（属性对话框标题用）。 */
  ordinalOf(v: DocView, o: Obj): number { return this.ordinal(v, o); }
  private ordinal(v: DocView, o: Obj): number { return v.store.page.objects.filter(x => typeName(x) === typeName(o)).indexOf(o) + 1; }

  // ---------- 状态与刷新 ----------
  setStatus(t: string) { this.status.textContent = t; }
  /** 状态栏：有选择时显示选择的数量和类型（如“2 点”“3 对象”），否则显示当前工具的提示；箭头工具没有提示。 */
  updateStatus() {
    if (this.flash) return;
    const v = this.active, s = v ? analyse(v) : undefined;
    this.setStatus(this.toolbox.current === 'custom' ? this.toolHint() : s && s.n ? `${s.n} ${s.sameType ?? '对象'}` : this.toolHint());
  }
  flashStatus(t: string) { this.setStatus(t); window.clearTimeout(this.flash); this.flash = window.setTimeout(() => { this.flash = undefined; this.updateStatus(); }, 2500); }
  setCoordHint(_p: Pt) { /* 状态栏保持工具提示，不随鼠标闪烁 */ }
  refresh() {
    this.docs.forEach(d => d.store.syncAngleUnit(d.fallbackDisplay.angleUnit));
    if (this.active) applyDisplay(pageDisplay(this.active.store.doc, this.active.store.page, this.active.fallbackDisplay));
    buildMenus(this, true);
    this.refreshTextbar();
    this.refreshPageBar();
    this.mdi.titles();
    this.docs.forEach(d => d.invalidate());
    this.motion.refresh();
    const title = this.active ? `${this.active.store.doc.name}${this.active.store.dirty ? ' *' : ''} - 新版` : '新版';
    if (title !== document.title) desktop.setTitle(title);
    this.updateStatus();
  }
  refreshPageBar() {
    const v = this.active; if (!v) return;
    const doc = v.store.doc, show = doc.pages.length > 1 && doc.settings.showPageTabs !== false;
    this.pagebar.hidden = !show;
    if (!show) return;
    this.pagebar.replaceChildren(...doc.pages.map((p, i) => { const b = document.createElement('button'); b.textContent = p.name; b.className = i === doc.current ? 'on' : ''; b.onclick = () => { v.store.switchPage(i); v.sel = []; v.eraseTraces(); this.refresh(); }; return b; }));
  }
  showContextMenu(v: DocView, e: MouseEvent, p: Pt) {
    // 右键不会经过 DocView.onDown 的前台切换；先激活目标文档，避免从另一个文档取命令状态或执行目标。
    if (this.active !== v) this.focusDoc(v);
    // 右键先选中被点的对象
    const hit = (hitFirst(v, p));
    if (hit !== undefined && !v.sel.includes(hit)) v.setSel([hit]);
    else if (hit === undefined) v.setSel([]);
    this.ctxMenu.show(v, e.clientX, e.clientY);
  }

  // ---------- 键盘 ----------
  private onKey(e: KeyboardEvent) {
    const v = this.active; if (!v) return;
    if (e.isComposing || v.textEdit?.composing) return;
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (this.dlg.open || v.dragCompleting || (v.backgroundDragging && e.key !== 'Escape')) return;
    if (typing && target !== v.textEdit?.ta) return;
    const combo = comboOf(e);
    // 菜单快捷键
    const id = SHORTCUTS.get(combo);
    if (id !== undefined) {
      if (v.textEdit && ['Ctrl+Z', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+A'].includes(combo)) return; // 文本编辑里交给浏览器
      e.preventDefault();
      void executeCommand(id, this.ctx(e.shiftKey));
      return;
    }
    if (v.textEdit) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (v.sel.length) { e.preventDefault(); void executeCommand(36881, this.ctx()); } return; }
    if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); void executeCommand(36890, this.ctx()); return; }
    if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); void executeCommand(36891, this.ctx()); return; }
    if (v.onKey(e)) e.preventDefault();
  }

  queryMenu(id: number, shift = false) { return queryCommand(id, this.ctx(shift)); }
  exec(id: number, shift = false) { return executeCommand(id, this.ctx(shift)); }
  parseText(v: DocView, text: string, variable?: string): Expr {
    const st = v.store, named = st.page.objects.filter(o => ['param', 'calc', 'measure', 'func', 'picfunc'].includes(o.def.k));
    const nameOf = (o: Obj) => (o.def.k === 'param' ? o.def.name : o.def.k === 'func' ? o.def.name : o.label ?? measureName(st.page, st.results, o));
    const names = named.map(nameOf);
    return parseExpr(text, { names, variable, resolve: n => named.find(o => nameOf(o) === n && classOf(o) !== 'func')?.id, funcs: n => named.find(o => classOf(o) === 'func' && nameOf(o) === n)?.id });
  }
}

function hitFirst(v: DocView, p: Pt): Id | undefined {
  return hitAllFirst(v, p);
}
import { hitAll } from './core/hit';
function hitAllFirst(v: DocView, p: Pt): Id | undefined { return hitAll(v.store.page, v.store.results, p, v.app.settings.power)[0]; }

function buttonText(v: DocView, a: ButtonAction): string {
  const names = (ids: Id[]) => { const o = v.store.get(ids[0]); return o ? (o.label ?? typeName(o)) : '对象'; };
  switch (a.type) {
    case 'hideshow': return a.mode === 'show' ? `显示${names(a.targets)}` : a.mode === 'hide' ? `隐藏${names(a.targets)}` : a.first === 'show' ? `显示${names(a.targets)}` : `隐藏${names(a.targets)}`;
    case 'animate': return `动画${names(a.targets)}`;
    case 'move': return `移动${names([a.from])}到${names([a.to])}`;
    case 'link': return a.url ?? `第${a.page}页`;
    case 'scroll': return `滚动到${names([a.point])}`;
    case 'sound': return `听到函数 ${a.funcs.map(id => { const o = v.store.get(id); return o?.def.k === 'func' ? o.def.name : o?.label ?? 'f'; }).join(' ')}`;
    case 'series': return `系列${a.buttons.length}个动作`;
    default: return '按钮';
  }
}

export { formatQ, usesX };

/** 把任意浏览器能解码的图片转成 PNG，并返回原始像素大小。 */
async function toPng(data: string, mime: string): Promise<{ data: string; mime: string; w: number; h: number }> {
  const img = new Image(); img.src = `data:${mime};base64,${data}`; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  if (mime === 'image/png') return { data, mime, w, h };
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d')!.drawImage(img, 0, 0);
  return { data: cv.toDataURL('image/png').split(',')[1], mime: 'image/png', w, h };
}
