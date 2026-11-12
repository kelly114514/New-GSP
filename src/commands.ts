/** 命令注册表：菜单、快捷键、右键、工具按钮共用。queryCommand 给出名称/可用/勾选，executeCommand 执行。 */
import type { Store } from './core/store';
import { imagePixelSize } from './core/image';
import {
  classOf, constructArcOnCircle, constructBisector, constructIntersections, constructLines, constructLocus, constructMidpoints, constructParallelPerp, constructPointOnPath,
  applyCustomTransform, customChain, constructInterior, createSystem, dilateBy, findSys, intersectionCount, labelMeasured, reflectBy, rotateBy, translateBy,
} from './core/construct';
import { derive, q } from './core/expr';
import { evaluateExpression, functionExpression } from './core/engine';
import type { Obj, Id, MeasureKind, Def } from './core/model';
import { ancestors, descendants, isPathDef, pageAutoSnap, parentsOf } from './core/model';
import { typeName } from './ui/render';
import { canBePreimage, changeDepth } from './core/iterate';
import { runIteration } from './ui/iterate';
import { isAudible } from './ui/sound';
import { bitmapAsPng } from './ui/bitmap-function';
import { readHeightMask } from './core/image-height';
import type { App } from './app';
import type { DocView } from './ui/docview';

export interface Ctx { app: App; view: DocView; shift: boolean }
export interface CmdState { enabled: boolean; name?: string; checked?: boolean }
export interface CmdDef {
  name?: (c: Ctx, s: Sel) => string;
  enabled?: (c: Ctx, s: Sel) => boolean;
  checked?: (c: Ctx, s: Sel) => boolean;
  run: (c: Ctx, s: Sel) => void | Promise<void>;
  /** 本版暂缓：保留在原位置并禁用。 */
  deferred?: string;
}

/** 选择的分类统计（保持选择顺序）。 */
export interface Sel {
  objs: Obj[];
  n: number;
  pts: Obj[]; straights: Obj[]; circles: Obj[]; arcs: Obj[]; interiors: Obj[];
  segs: Obj[]; measures: Obj[]; geo: Obj[]; paths: Obj[]; locus: Obj[]; tables: Obj[]; texts: Obj[]; images: Obj[]; buttons: Obj[]; funcs: Obj[]; plots: Obj[]; syss: Obj[];
  onpath: Obj[];
  numeric: Obj[];          // 度量/参数/计算：带数值的对象
  sameType: string | undefined;
}

export function analyse(view: DocView): Sel {
  const st = view.store;
  const objs = view.sel.map(id => st.get(id)).filter((o): o is Obj => !!o);
  const objectClass = (o: Obj) => { const shape = st.results.get(o.id)?.shape; return shape?.k === 'box' && shape.image ? 'image' : classOf(o); };
  const by = (c: string) => objs.filter(o => objectClass(o) === c);
  const types = new Set(objs.map(typeName));
  const num = objs.filter(o => o.def.k === 'measure' || o.def.k === 'param' || o.def.k === 'calc');
  return {
    objs, n: objs.length, pts: by('point'), straights: by('straight'), circles: by('circle'), arcs: by('arc'), interiors: by('interior'),
    segs: objs.filter(o => o.def.k === 'seg'), measures: by('measure'), geo: objs.filter(o => ['point', 'straight', 'circle', 'arc', 'interior', 'locus', 'plot', 'stroke'].includes(objectClass(o))),
    paths: objs.filter(o => isPathDef(o.def)), locus: objs.filter(o => o.def.k === 'locus'), tables: by('table'), texts: by('text'), images: by('image'), buttons: by('button'), funcs: by('func'),
    plots: by('plot'), syss: by('sys'), onpath: objs.filter(o => o.def.k === 'onpath'), numeric: num, sameType: types.size === 1 ? [...types][0] : undefined,
  };
}

const allOf = (s: Sel, list: Obj[]) => s.n > 0 && list.length === s.n;

/** “应用于度量过的对象”：度量后给对象显示标签，度量值的名字才用得上它们。 */
const autoLabel = (c: Ctx, refs: Id[]) => { if (c.app.settings.autoLabelMeasured) labelMeasured(c.view.store, refs); };
/** 重做：恢复的对象（新出现的）成为选择；否则保持原选择。 */
function redoSelect(c: Ctx, before: Set<Id>) {
  const back = c.view.store.page.objects.filter(o => !before.has(o.id)).map(o => o.id);
  c.view.setSel(back.length ? back : c.view.sel);
}
/** 变换的中心：有标记就用标记；否则选择里的第一个点成为中心（只选一个点时可以直接旋转、缩放）。 */
function transformCenter(c: Ctx, s: Sel): Id | undefined {
  const st = c.view.store, m = c.view.marks.center;
  if (m !== undefined && st.get(m)) return m;
  const p = s.pts[0]; if (!p) return undefined;
  if (p.label === undefined) p.label = st.defaultLabel(p);
  c.view.marks.center = p.id;
  return p.id;
}
function setStyleCmd(patch: (c: Ctx) => Partial<Obj['style']>, name: string, filter: (s: Sel) => Obj[]): CmdDef {
  return {
    enabled: (_c, s) => filter(s).length > 0,
    run: (c, s) => { const ids = filter(s).map(o => o.id); c.view.store.run(name, () => c.view.store.setStyle(ids, patch(c))); },
  };
}

const pointSized = (s: Sel) => [...s.pts, ...s.objs.filter(o => o.def.k === 'iterimg')];
const lineTyped = (s: Sel) => [...s.straights, ...s.circles, ...s.arcs, ...s.locus, ...s.plots];

function addMeasure(c: Ctx, m: MeasureKind, refs: Id[], name: string): Obj | undefined {
  const st = c.view.store;
  let made: Obj | undefined;
  st.run(name, () => {
    const needSys = ['abscissa', 'ordinate', 'coords', 'coorddist', 'slope', 'equation'].includes(m);
    let sys = needSys ? findSys(st) : undefined;
    if (needSys && !sys) sys = createSystem(st);
    const full = needSys ? [...refs, sys!.id] : refs;
    const at = c.app.nextTextPos(c.view);
    autoLabel(c, refs);
    made = st.add({ k: 'measure', m, refs: full }, { at, style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } });
  });
  if (made) c.view.setSel([made.id]);
  return made;
}

function measureCmd(m: MeasureKind, label: string, ok: (c: Ctx, s: Sel) => boolean, refs: (s: Sel) => Id[], multi = false): CmdDef {
  return {
    name: (c, s) => (m === 'coords' && c.shift && s.pts.length ? '横&纵坐标' : label),
    enabled: ok,
    run: (c, s) => {
      if (multi) { // 对每个对象各建立一个度量
        const made: Id[] = [];
        c.view.store.run(`度量${label}`, () => {
          autoLabel(c, refs(s));
          for (const o of refs(s)) { const at = c.app.nextTextPos(c.view); made.push(c.view.store.add({ k: 'measure', m, refs: [o] }, { at, style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } }).id); }
        });
        c.view.setSel(made); return;
      }
      if (m === 'coords' && c.shift) {
        const made: Id[] = [];
        c.view.store.run('度量横纵坐标', () => {
          const st = c.view.store; let sys = findSys(st) ?? createSystem(st);
          for (const p of s.pts) for (const k of ['abscissa', 'ordinate'] as const) made.push(st.add({ k: 'measure', m: k, refs: [p.id, sys.id] }, { at: c.app.nextTextPos(c.view), style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } }).id);
        });
        c.view.setSel(made); return;
      }
      addMeasure(c, m, refs(s), `度量${label}`);
    },
  };
}

export const CMD_CUSTOM = 3201;
export const commands = new Map<number, CmdDef>();
const def = (id: number, d: CmdDef) => commands.set(id, d);
/** 三个点共线（原版：三点标记比只在三点共线时可用，样本里选中 3 个不共线的自由点时命令是灰的）。 */
function collinear3(st: Store, pts: Obj[]): boolean {
  const ps = pts.map(o => { const r = st.results.get(o.id)?.shape; return r?.k === 'pt' ? r.p : undefined; });
  if (ps.some(p => !p)) return false;
  const [a, b, c] = ps as { x: number; y: number }[], d = Math.hypot(c.x - a.x, c.y - a.y) || 1;
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / d < 0.5;
}

// ---------------- 文件 ----------------
def(36864, { run: c => c.app.newDocument() });
def(36865, { run: c => c.app.openFile() });
// 原版在新建且尚无改动的空白文档中将“保存”置灰；首次落盘使用“另存为”。
def(36868, { enabled: c => c.view.store.dirty, run: async c => { await c.app.save(c.view, false); } });
def(36869, { run: async c => { await c.app.save(c.view, true); } });
def(36870, { run: async c => { await c.app.closeDocument(c.view); } });
def(36871, { run: c => c.app.dlg.docOptions(c.view) });
def(36872, { run: c => c.app.dlg.pageSetup(c.view) });
def(36873, { run: c => c.app.printPreview(c.view) });
def(36874, { run: c => c.app.print(c.view) });
def(36875, { run: async c => { await c.app.quit(); } });

// ---------------- 编辑 ----------------
def(36876, { name: c => (c.shift && c.view.store.canUndo ? '撤消所有' : c.view.store.undoName ? `撤消${c.view.store.undoName}` : '撤消'), enabled: c => c.view.store.canUndo && !c.view.textEdit, run: c => { if (c.shift) while (c.view.store.canUndo) c.view.store.doUndo(); else c.view.store.doUndo(); c.view.setSel(c.view.sel); } });
def(36877, { name: c => (c.shift && c.view.store.canRedo ? '重做所有' : c.view.store.redoName ? `重做${c.view.store.redoName}` : '重做'), enabled: c => c.view.store.canRedo && !c.view.textEdit, run: c => { const before = new Set(c.view.store.page.objects.map(o => o.id)); if (c.shift) while (c.view.store.canRedo) c.view.store.doRedo(); else c.view.store.doRedo(); redoSelect(c, before); } });
def(36878, { enabled: (_c, s) => s.n > 0, run: c => { c.app.copy(c.view); c.app.clearSelected(c.view, '剪切'); } });
def(36879, { enabled: (_c, s) => s.n > 0, run: c => c.app.copy(c.view) });
def(36880, { name: c => (c.app.clipboardIsImage() ? (analyse(c.view).images.length ? '粘贴替换图片' : '粘贴图片') : '粘贴'), enabled: c => c.app.canPaste(), run: c => c.app.paste(c.view) });
def(36881, { name: (_c, s) => (s.n ? `清除${s.sameType ?? '对象'}` : '清除'), enabled: (_c, s) => s.n > 0, run: c => c.app.clearSelected(c.view, '清除') });
def(36889, {
  name: c => { const t = c.app.toolSelectAllName(c.view); return t ? `选择所有${t}` : '全选'; },
  run: c => c.app.selectAll(c.view),
});
def(36890, { enabled: (_c, s) => s.objs.some(o => parentsOf(o.def).length > 0), run: (c, s) => { const ids = new Set<Id>(); for (const o of s.objs) for (const p of parentsOf(o.def)) ids.add(p); c.view.setSel([...ids]); } });
def(36891, { enabled: (c, s) => s.objs.some(o => c.view.store.page.objects.some(x => parentsOf(x.def).includes(o.id))), run: (c, s) => { const ids = new Set<Id>(); for (const o of s.objs) for (const x of c.view.store.page.objects) if (parentsOf(x.def).includes(o.id)) ids.add(x.id); c.view.setSel([...ids]); } });
def(36892, {
  name: (_c, s) => (s.interiors.length ? `剪裁图片到${typeName(s.interiors[0]).replace('内部', '')}` : '剪裁图片到多边形'),
  enabled: (_c, s) => s.images.length === 1 && s.interiors.some(o => o.def.k === 'poly') && s.n === 2,
  // 原版：隐藏源图片，新增方法 108 的剪裁图片（父对象 [源图片, 多边形内部]，2316 = [源宽, 源高, 剪裁宽, 剪裁高] 像素）
  run: (c, s) => {
    const st = c.view.store, img = s.images[0], poly = s.interiors.find(o => o.def.k === 'poly')!;
    let made: Obj | undefined;
    st.run('剪裁图片', () => {
      const shape = st.results.get(img.id)?.shape, mask = st.results.get(poly.id)?.shape;
      const root = (() => { let d = img.def; for (let k = 0; k < 32 && d.k !== 'image'; k++) { const next = 'src' in d ? st.get(d.src as Id) : undefined; if (!next) break; d = next.def; } return d.k === 'image' ? d : undefined; })();
      const px = root ? imagePixelSize(root.data, root.mime) ?? { w: root.w, h: root.h } : { w: 0, h: 0 };
      let cw = px.w, ch = px.h;
      if (shape?.k === 'box' && shape.image && mask?.k === 'poly') {
        // 剪裁尺寸：多边形与图片相交部分的外包矩形，换算到源图片像素
        const [p0, p1, , p3] = shape.image.corners, ex = { x: p1.x - p0.x, y: p1.y - p0.y }, ey = { x: p3.x - p0.x, y: p3.y - p0.y }, det = ex.x * ey.y - ex.y * ey.x;
        if (Math.abs(det) > 1e-9) {
          const uv = mask.pts.map(p => ({ u: ((p.x - p0.x) * ey.y - (p.y - p0.y) * ey.x) / det, v: (ex.x * (p.y - p0.y) - ex.y * (p.x - p0.x)) / det }));
          const clamp = (t: number) => Math.min(1, Math.max(0, t));
          cw = Math.max(1, Math.round((clamp(Math.max(...uv.map(q => q.u))) - clamp(Math.min(...uv.map(q => q.u)))) * px.w));
          ch = Math.max(1, Math.round((clamp(Math.max(...uv.map(q => q.v))) - clamp(Math.min(...uv.map(q => q.v)))) * px.h));
        }
      }
      made = st.add({ k: 'image-clip', src: img.id, clip: poly.id, size: [px.w, px.h, cw, ch] }, { style: { ...img.style }, hidden: false });
      img.hidden = true;
    });
    if (made) c.view.setSel([made.id]);
  },
});
export function mergeTextSource(s: Sel): Obj | undefined {
  if (s.n !== 2 || s.pts.length !== 1) return undefined;
  if (s.texts.length) return s.texts[0];
  // 数值快照里，先选点再选参数可用，先选度量再选点为灰。
  const last = s.objs[1];
  return s.numeric.includes(last) || s.funcs.includes(last) ? last : undefined;
}

def(36893, {
  name: (c, s) => {
    if (c.shift && mergeTextSource(s)) return '合并文本到点';
    if (s.n === 2 && s.pts.length === 2) return '合并点';
    if (s.n === 2 && s.pts.length === 1 && s.paths.length === 1) return `合并点到${typeName(s.paths[0])}`;
    if (s.n === 1 && s.onpath.length === 1) return `从${typeName(c.view.store.get((s.onpath[0].def as { path: Id }).path)!)}分离点`;
    if (c.shift && s.n === 1 && s.pts.length === 1 && ['rotate', 'reflect', 'dilate', 'translate'].includes(s.pts[0].def.k)) return '从定义分离点';
    return '分离/合并';
  },
  enabled: (c, s) => (s.n === 2 && s.pts.length === 2 && s.pts.some(p => p.def.k === 'free') && !ancestors(c.view.store.page, [s.pts[0].id]).has(s.pts[1].id) && !ancestors(c.view.store.page, [s.pts[1].id]).has(s.pts[0].id)) || (s.n === 2 && s.pts.length === 1 && s.paths.length === 1 && s.pts[0].def.k === 'free') || (s.n === 1 && s.onpath.length === 1) || (c.shift && s.n === 1 && s.pts.length === 1 && ['rotate', 'reflect', 'dilate', 'translate'].includes(s.pts[0].def.k)) || (c.shift && !!mergeTextSource(s)),
  run: (c, s) => c.app.splitMerge(c.view, s, c.shift),
});
def(36894, {
  name: (_c, s) => (s.n === 1 ? (s.objs[0].def.k === 'param' ? '编辑参数' : s.objs[0].def.k === 'calc' ? '编辑计算' : s.objs[0].def.k === 'func' ? '编辑函数' : s.objs[0].def.k === 'text' ? '编辑说明' : '编辑定义') : '编辑定义'),
  enabled: (_c, s) => s.n === 1 && ['param', 'calc', 'func', 'text'].includes(s.objs[0].def.k),
  run: (c, s) => c.app.editDefinition(c.view, s.objs[0]),
});
def(36895, { enabled: (_c, s) => s.n === 1, run: (c, s) => c.app.dlg.properties(c.view, s.objs[0]) });
def(36896, { run: c => c.app.dlg.preferences() });
def(68035, { run: () => undefined });
def(36882, { name: (c) => (c.shift ? '显示&隐藏' : '隐藏/显示'), enabled: (_c, s) => s.n > 0, run: (c, s) => c.app.makeButton(c.view, { type: 'hideshow', targets: s.objs.map(o => o.id), mode: 'toggle', first: c.shift ? 'show' : 'hide' }) });
def(36883, { enabled: (_c, s) => s.geo.length > 0 || s.syss.length > 0 || s.objs.some(o => o.def.k === 'param'), run: (c, s) => c.app.dlg.animateButton(c.view, s) });
def(36884, { enabled: (_c, s) => s.n === 2 && s.pts.length === 2, run: (c, s) => c.app.dlg.moveButton(c.view, s) });
def(36885, { enabled: (_c, s) => s.n > 0 && s.buttons.length === s.n, run: (c, s) => void c.app.dlg.seriesButton(c.view, s) });
def(36886, {
  enabled: (_c, s) => (s.n >= 1 && s.n <= 2 && s.objs.every(o => o.def.k === 'func' || o.def.k === 'picfunc')) || (s.n === 1 && s.objs[0].def.k === 'plot'),
  run: async (c, s) => {
    const ids = s.objs.map(o => (o.def.k === 'plot' ? o.def.func : o.id));
    if (!isAudible(c.view, ids) && !(await c.app.dlg.ask('这个函数几乎没有振荡，多半不是可以听的声音函数。仍然要建立声音按钮吗？', ['是(Y)', '否(N)']) === '是(Y)')) return;
    c.app.makeButton(c.view, { type: 'sound', funcs: ids });
  },
});
def(36887, { run: c => c.app.dlg.linkButton(c.view) });
def(36888, { enabled: (_c, s) => s.n === 1 && s.pts.length === 1, run: (c, s) => c.app.dlg.scrollButton(c.view, s) });
def(36890 + 0, commands.get(36890)!);

// ---------------- 显示 ----------------
[36897, 36898, 36899, 36900].forEach((id, i) => def(id, { ...setStyleCmd(() => ({ pointSize: i }), '点型', pointSized), checked: (_c, s) => pointSized(s).length > 0 && pointSized(s).every(p => p.style.pointSize === i) }));
[36901, 36902, 36903, 36904].forEach((id, i) => def(id, { ...setStyleCmd(() => ({ width: i }), '线型', lineTyped), checked: (_c, s) => lineTyped(s).length > 0 && lineTyped(s).every(p => p.style.width === i) }));
(['solid', 'dash', 'dot'] as const).forEach((d, i) => def(36905 + i, { ...setStyleCmd(() => ({ dash: d }), '线型', lineTyped), checked: (_c, s) => lineTyped(s).length > 0 && lineTyped(s).every(p => p.style.dash === d) }));
def(36908, {
  enabled: (_c, s) => s.n > 0 && !s.objs.every(o => o.def.k === 'image'),
  run: async (c, s) => {
    const param = s.objs.find(o => o.def.k === 'param' || o.def.k === 'calc' || (o.def.k === 'measure'));
    const targets = s.objs.filter(o => o !== param && o.def.k !== 'param' && o.def.k !== 'calc' && o.def.k !== 'measure');
    const r = await c.app.dlg.colorParam(c.view, !!param && targets.length > 0);
    if (r && param) c.view.store.run('颜色', () => { for (const o of targets) o.colorBy = { ...r, param: param.id }; });
  },
});
def(36909, { enabled: (_c, s) => s.n > 0 && !s.objs.every(o => o.def.k === 'image'), run: async (c, s) => { const col = await c.app.dlg.color(s.objs[0].style.color); if (col) c.view.store.run('颜色', () => c.view.store.setStyle(s.objs.map(o => o.id), { color: col })); } });
def(68057, { run: () => undefined }); def(68037, { run: () => undefined }); def(68039, { run: () => undefined }); def(68041, { run: () => undefined }); def(68045, { run: () => undefined });
export const fontTargets = (s: Sel) => s.objs.filter(o => ['text', 'measure', 'param', 'calc', 'func', 'picfunc', 'button', 'table', 'itertable'].includes(o.def.k));
for (const [id, key] of [[32882, 'bold'], [32884, 'italic'], [32883, 'underline']] as const) {
  def(id, { enabled: (c, s) => !!c.view.textEdit || fontTargets(s).length > 0, checked: (_c, s) => fontTargets(s).length > 0 && fontTargets(s).every(o => o.def.k === 'text' ? o.def.font[key] : !!o.font?.[key]), run: c => c.app.toggleFont(c.view, key) });
}
def(32892, { enabled: (c, s) => !!c.view.textEdit || fontTargets(s).length > 0, run: c => c.app.fontSize(c.view, 2) });
def(32893, { enabled: (c, s) => !!c.view.textEdit || fontTargets(s).length > 0, run: c => c.app.fontSize(c.view, -2) });
def(36911, {
  name: (_c, s) => (s.n ? `隐藏${s.sameType ?? '对象'}` : '隐藏对象'),
  enabled: (_c, s) => s.n > 0,
  run: (c, s) => { const ids = s.objs.map(o => o.id); c.view.store.run(`隐藏${s.sameType ?? '对象'}`, () => c.view.store.setHidden(ids, true)); c.view.setSel([]); },
});
function hiddenUserObjects(st: Store): Obj[] {
  // 方形坐标系的纵向单位点默认隐藏，是内部构造对象，不算“隐藏对象”；显示全部隐藏也不能改动它。
  const implicit = new Set(st.page.objects.flatMap(o => o.def.k === 'sys' ? [o.def.unitY] : []));
  return st.page.objects.filter(o => o.hidden && !implicit.has(o.id));
}
def(36912, { enabled: c => hiddenUserObjects(c.view.store).length > 0, run: c => { const hidden = hiddenUserObjects(c.view.store); c.view.store.run('显示所有隐藏', () => c.view.store.setHidden(hidden.map(o => o.id), false)); } });
def(36913, {
  name: (_c, s) => (s.geo.length && s.geo.every(o => o.labelShown) ? '隐藏标签' : '显示标签'),
  enabled: (_c, s) => s.geo.length > 0,
  run: (c, s) => {
    const st = c.view.store, target = s.geo;
    const show = !target.every(o => o.labelShown);
    // 标签第一次分配时按选择顺序：最后选中的排在最前（原版实测）
    st.run(show ? '显示标签' : '隐藏标签', () => { const order = show ? [...target].reverse() : target; for (const o of order) st.showLabel(o.id, show); });
  },
});
def(36914, {
  name: (c, s) => (s.n === 0 ? (c.shift ? '重设下一标签…' : '标签…') : `${s.sameType ?? '对象'}的标签…`),
  enabled: (c, s) => s.n ? !s.objs.some(o => ['image', 'table', 'sys'].includes(o.def.k)) : c.shift && c.view.store.page.objects.length > 0,
  run: (c, s) => c.app.dlg.label(c.view, s),
});
def(36915, {
  name: (_c, s) => (s.geo.length && s.geo.every(o => o.trace) ? '取消追踪' : '追踪'),
  enabled: (_c, s) => s.geo.length > 0 || s.objs.some(o => o.def.k === 'iterimg'),
  checked: (_c, s) => [...s.geo, ...s.objs.filter(o => o.def.k === 'iterimg')].every(o => o.trace),
  run: (c, s) => { const targets = [...s.geo, ...s.objs.filter(o => o.def.k === 'iterimg')]; const on = !targets.every(o => o.trace); c.view.store.run('追踪', () => { for (const o of targets) o.trace = on; }); },
});
def(36916, { enabled: c => c.view.hasTraces, run: c => c.view.eraseTraces() });
/** 动画命令（原版采集 probe_animstate）：有动画在跑且没有选择时，四个命令管全部（暂停动画、全部加速、全部减速、停止所有运动）；
 *  选中了正在运动的对象时只管它们，而“动画”本身变灰；选中没在动的对象时“动画”照常，加速、减速、停止灰。 */
const animSel = (c: Ctx, s: Sel) => s.n > 0 && c.app.anim.involves(c.view, s.objs);
def(36917, {
  name: (c, s) => (s.n === 0 && c.app.anim.running ? (c.app.anim.paused ? '继续动画' : '暂停动画') : animSel(c, s) ? '动画' : '动画'),
  enabled: (c, s) => (s.n === 0 ? c.app.anim.running : !animSel(c, s) && (s.geo.length > 0 || s.syss.length > 0 || s.objs.some(o => o.def.k === 'param' || o.def.k === 'iterimg'))),
  run: (c, s) => (s.n === 0 ? c.app.anim.setPaused(!c.app.anim.paused) : c.app.anim.toggle(c.view, s.objs.filter(o => o.def.k !== 'measure' && o.def.k !== 'calc'))),
});
def(36918, { name: (_c, s) => (s.n === 0 ? '全部加速' : '加速'), enabled: (c, s) => (s.n === 0 ? c.app.anim.running : animSel(c, s)), run: (c, s) => (s.n === 0 ? c.app.anim.speedUp(1.5) : c.app.anim.speedFor(c.view, s.objs, 1.5)) });
def(36919, { name: (_c, s) => (s.n === 0 ? '全部减速' : '减速'), enabled: (c, s) => (s.n === 0 ? c.app.anim.running : animSel(c, s)), run: (c, s) => (s.n === 0 ? c.app.anim.speedUp(1 / 1.5) : c.app.anim.speedFor(c.view, s.objs, 1 / 1.5)) });
def(36920, {
  name: (c, s) => (c.shift ? '停止所有画板' : s.n === 0 ? '停止所有运动' : '停止动画'),
  enabled: (c, s) => (s.n === 0 ? c.app.anim.running : animSel(c, s)),
  run: (c, s) => (c.shift || s.n === 0 ? c.app.anim.stopAll() : c.app.anim.stopFor(c.view, s.objs)),
});
def(36921, { checked: c => c.app.textbarVisible, run: c => c.app.toggleTextbar() });
def(36922, { checked: c => c.app.motion.visible, run: c => c.app.motion.toggle() });
def(36923, { name: c => (c.app.toolboxVisible ? '隐藏工具箱' : '显示工具箱'), run: c => c.app.toggleToolbox() });

// ---------------- 构造 ----------------
def(36924, {
  name: (_c, s) => (s.paths.length === 1 ? `${typeName(s.paths[0])}上的点` : '对象上的点'),
  enabled: (_c, s) => allOf(s, s.paths.filter(o => o.def.k !== 'locus' || true)) && s.n > 0,
  run: (c, s) => { const made: Id[] = []; c.view.store.run('构造点', () => { for (const o of s.paths) { const p = constructPointOnPath(c.view.store, o.id); if (p) made.push(p.id); } }); c.view.setSel(made); },
});
def(36925, { enabled: (_c, s) => allOf(s, s.segs), run: (c, s) => { let made: Obj[] = []; c.view.store.run('构造中点', () => { made = constructMidpoints(c.view.store, s.segs.map(o => o.id)); }); c.view.setSel(made.map(o => o.id)); } });
def(36926, {
  enabled: (c, s) => s.n === 2 && s.objs.every(o => ['straight', 'circle', 'arc'].includes(classOf(o))) && intersectionCount(c.view.store, s.objs[0].id, s.objs[1].id) > 0,
  run: (c, s) => { let made: Obj[] = []; c.view.store.run('构造交点', () => { made = constructIntersections(c.view.store, s.objs[0].id, s.objs[1].id); }); c.view.setSel(made.map(o => o.id)); },
});
for (const [id, kind, label] of [[36927, 'seg', '线段'], [36928, 'ray', '射线'], [36929, 'line', '直线']] as const) {
  def(id, { enabled: (_c, s) => allOf(s, s.pts) && s.n >= 2, run: (c, s) => { let made: Obj[] = []; c.view.store.run(`构造${label}`, () => { made = constructLines(c.view.store, kind, s.pts.map(o => o.id)); }); c.view.setSel(made.map(o => o.id)); } });
}
for (const [id, kind, label] of [[36930, 'parallel', '平行线'], [36931, 'perp', '垂线']] as const) {
  def(id, {
    enabled: (_c, s) => s.n >= 2 && s.pts.length === 1 && s.straights.length === s.n - 1 && s.straights.length >= 1,
    run: (c, s) => { const made: Id[] = []; c.view.store.run(`构造${label}`, () => { for (const l of s.straights) made.push(constructParallelPerp(c.view.store, kind, s.pts[0].id, l.id).id); }); c.view.setSel(made); },
  });
}
def(36932, { enabled: (_c, s) => allOf(s, s.pts) && s.n === 3, run: (c, s) => { let m: Obj | undefined; c.view.store.run('构造角平分线', () => { m = constructBisector(c.view.store, s.pts[0].id, s.pts[1].id, s.pts[2].id); }); if (m) c.view.setSel([m.id]); } });
def(36933, { enabled: (_c, s) => allOf(s, s.pts) && s.n === 2, run: (c, s) => { let m: Obj | undefined; c.view.store.run('构造圆', () => { m = c.view.store.add({ k: 'circle', c: s.pts[0].id, p: s.pts[1].id }); }); if (m) c.view.setSel([m.id]); } });
function circleRadii(st: Store, selected: Obj[]): Obj[] {
  return selected.filter(o => {
    if (o.def.k === 'seg') return true;
    const value = st.results.get(o.id)?.shape;
    // 计算结果可能从操作数继承长度单位，以求值结果为准。
    return value?.k === 'num' && value.q.u === 'distance' && Number.isFinite(value.q.v) && value.q.v >= 0;
  });
}
def(36934, {
  enabled: (c, s) => {
    const centers = s.pts.length;
    if (!centers || centers === s.n) return false;
    const radii = circleRadii(c.view.store, s.objs).length;
    return centers + radii === s.n && (centers === 1 || radii === 1);
  },
  run: (c, s) => {
    const st = c.view.store, radii = circleRadii(st, s.objs);
    const made: Id[] = [];
    st.run('构造圆', () => {
      for (const center of s.pts) for (const radius of radii) {
        made.push(st.add({ k: 'circle-seg', c: center.id, seg: radius.id }, {}, false).id);
      }
      st.recompute(made);
    });
    c.view.setSel(made);
  },
});
def(36935, {
  enabled: (_c, s) => s.n === 3 && s.circles.length === 1 && s.pts.length === 2,
  run: (c, s) => { let m: Obj | undefined; c.view.store.run('构造弧', () => { m = constructArcOnCircle(c.view.store, s.circles[0].id, s.pts[0].id, s.pts[1].id); s.circles[0].style.dash = 'dash'; }); if (m) c.view.setSel([m.id]); },
});
def(36936, { enabled: (_c, s) => allOf(s, s.pts) && s.n === 3, run: (c, s) => { let m: Obj | undefined; c.view.store.run('构造弧', () => { m = c.view.store.add({ k: 'arc3', a: s.pts[0].id, b: s.pts[1].id, c: s.pts[2].id }); }); if (m) c.view.setSel([m.id]); } });
def(36937, {
  name: (_c, s) => (s.pts.length >= 3 && s.pts.length === s.n ? (s.n === 3 ? '三角形的内部' : s.n === 4 ? '四边形的内部' : '多边形的内部') : s.circles.length ? '圆内部' : s.arcs.length ? '扇形内部' : '内部'),
  enabled: (_c, s) => (allOf(s, s.pts) && s.n >= 3) || (s.n > 0 && s.objs.every(o => ['circle', 'arc'].includes(classOf(o)))),
  run: (c, s) => { let m: Obj[] = []; c.view.store.run('构造内部', () => { m = constructInterior(c.view.store, s.objs); }); c.view.setSel(m.map(o => o.id)); },
});
def(36938, {
  enabled: (c, s) => s.n === 2 && s.onpath.length >= 1 && s.pts.length === 2 && locusPair(c, s) !== undefined,
  run: (c, s) => { const pair = locusPair(c, s)!; let m: Obj | undefined; c.view.store.run('构造轨迹', () => { m = constructLocus(c.view.store, pair[0], pair[1]); }); if (m) c.view.setSel([m.id]); },
});
function locusPair(c: Ctx, s: Sel): [Id, Id] | undefined {
  const st = c.view.store;
  const [a, b] = s.pts;
  const dependsOn = (x: Obj, root: Id): boolean => x.id !== root && (() => { const seen = new Set<Id>(); const walk = (id: Id): boolean => { if (id === root) return true; if (seen.has(id)) return false; seen.add(id); const o = st.get(id); return !!o && parentsOf(o.def).some(walk); }; return walk(x.id); })();
  if (a.def.k === 'onpath' && dependsOn(b, a.id)) return [a.id, b.id];
  if (b.def.k === 'onpath' && dependsOn(a, b.id)) return [b.id, a.id];
  return undefined;
}

// ---------------- 变换 ----------------
def(36939, { enabled: (_c, s) => s.pts.length > 0, run: (c, s) => { c.view.marks.center = s.pts[0].id; c.app.flashStatus('已标记中心'); } });
def(36940, { enabled: (_c, s) => s.straights.length > 0, run: (c, s) => { c.view.marks.mirror = s.straights[0].id; c.app.flashStatus('已标记镜面'); } });
const angleMeasure = (s: Sel) => s.objs.find(o => o.def.k === 'measure' && ['angle', 'arcangle', 'coordangle'].includes(o.def.m));
def(36941, { enabled: (_c, s) => (allOf(s, s.pts) && s.n === 3) || !!angleMeasure(s), run: (c, s) => { const m = angleMeasure(s); c.view.marks.angle = m ? { m: m.id } : [s.pts[0].id, s.pts[1].id, s.pts[2].id]; c.app.flashStatus('已标记角度'); } });
def(36942, {
  name: (_c, s) => (s.segs.length === 2 ? '标记线段比' : unitlessLast(s) ? '标记比值' : '标记比'),
  enabled: (c, s) => (s.n === 2 && s.segs.length === 2) || (s.n === 3 && s.pts.length === 3 && collinear3(c.view.store, s.pts)) || unitlessLast(s),
  run: (c, s) => { c.view.marks.ratio = s.segs.length === 2 ? { segs: [s.segs[0].id, s.segs[1].id] } : s.n === 3 && s.pts.length === 3 && collinear3(c.view.store, s.pts) ? { pts: [s.pts[0].id, s.pts[1].id, s.pts[2].id] } : { m: s.objs[s.n - 1].id }; c.app.flashStatus('已标记比'); },
});
/** 最后选中的是无单位的数值（参数、计算、比）。 */
function unitlessLast(s: Sel): boolean {
  const o = s.objs[s.n - 1];
  if (!o) return false;
  if (o.def.k === 'param') return o.def.unit === 'none';
  if (o.def.k === 'calc') return true;
  return o.def.k === 'measure' && o.def.m === 'ratio';
}
def(36943, { enabled: (_c, s) => s.pts.length >= 2, run: (c, s) => { c.view.marks.vector = [s.pts[0].id, s.pts[1].id]; c.app.flashStatus('已标记向量'); } });
const distanceMeasure = (s: Sel) => s.objs.find(o => o.def.k === 'measure' && ['distance', 'length', 'radius', 'circumference'].includes(o.def.m));
def(36944, { enabled: (_c, s) => !!distanceMeasure(s), run: (c, s) => { c.view.marks.distance = distanceMeasure(s)!.id; c.app.flashStatus('已标记距离'); } });
/** 可以被平移/旋转/缩放/反射的几何对象：函数图像不行（它由函数定义）。 */
const transformable = (s: Sel) => [...s.geo.filter(o => o.def.k !== 'plot' && o.def.k !== 'pcurve'), ...s.images];
def(36945, {
  enabled: (_c, s) => transformable(s).length > 0,
  run: async (c, s) => {
    const ids = transformable(s).map(o => o.id);
    const by = await c.app.dlg.translate(c.view, b => translateBy(c.view.store, ids, b));
    if (!by) return;
    let m: Obj[] = []; c.view.store.run('平移', () => { m = translateBy(c.view.store, ids, by); }); c.view.setSel(m.map(o => o.id));
  },
});
def(36946, {
  enabled: (_c, s) => transformable(s).length > 0,
  run: async (c, s) => {
    const center = transformCenter(c, s);
    if (center === undefined) { c.app.dlg.message('请先选中一个点并执行“标记中心”，再旋转。'); return; }
    const ids = transformable(s).map(o => o.id);
    const by = await c.app.dlg.rotate(c.view, center, b => rotateBy(c.view.store, ids, center, b));
    if (by) { let m: Obj[] = []; c.view.store.run('旋转', () => { m = rotateBy(c.view.store, ids, center, by); }); c.view.setSel(m.map(o => o.id)); }
  },
});
def(36947, {
  enabled: (_c, s) => transformable(s).length > 0,
  run: async (c, s) => {
    const center = transformCenter(c, s);
    if (center === undefined) { c.app.dlg.message('请先选中一个点并执行“标记中心”，再缩放。'); return; }
    const ids = transformable(s).map(o => o.id);
    const by = await c.app.dlg.dilate(c.view, center, b => dilateBy(c.view.store, ids, center, b));
    if (by) { let m: Obj[] = []; c.view.store.run('缩放', () => { m = dilateBy(c.view.store, ids, center, by); }); c.view.setSel(m.map(o => o.id)); }
  },
});
def(36948, {
  enabled: (_c, s) => transformable(s).length > 0,
  run: (c, s) => {
    const mirror = c.view.marks.mirror;
    if (mirror === undefined || !c.view.store.get(mirror)) { c.app.dlg.message('请先选中一条直线型对象并执行“标记镜面”，再反射。'); return; }
    let m: Obj[] = []; c.view.store.run('反射', () => { m = reflectBy(c.view.store, transformable(s).map(o => o.id), mirror); }); c.view.setSel(m.map(o => o.id));
  },
});
/** 迭代的原象：选中的自由点、路径上的点、参数、计算结果；按住 Shift 且最后选的是参数时，参数是迭代次数（深度迭代）。 */
function iterationInputs(c: Ctx, s: Sel): { pre: Obj[]; depth?: Obj } {
  const last = s.objs[s.objs.length - 1];
  const cand = s.objs.filter(canBePreimage);
  if (c.shift && last && last.def.k === 'param' && cand.length >= 2 && cand.slice(0, -1).some(o => o.def.k !== 'param' && o.def.k !== 'calc')) return { pre: cand.filter(o => o !== last), depth: last };
  return { pre: cand };
}
def(36949, {
  name: (c, s) => (iterationInputs(c, s).depth ? '深度迭代…' : '迭代…'),
  enabled: (c, s) => iterationInputs(c, s).pre.length > 0,
  run: (c, s) => { const r = iterationInputs(c, s); void runIteration(c.app, c.view, r.pre, r.depth); },
});
/** 两个点相关：一个由另一个构造出来，或者有共同的后代（原版采集 probe_custom3：两个不相干的自由点时灰，A、B 与线段 AB 同在时可用）。 */
function relatedPoints(st: Store, a: Obj, b: Obj): boolean {
  const da = descendants(st.page, [a.id]), db = descendants(st.page, [b.id]);
  return da.has(b.id) || db.has(a.id) || [...da].some(x => db.has(x));
}
def(36950, {
  enabled: (c, s) => s.n === 2 && s.pts.length === 2 && relatedPoints(c.view.store, s.pts[0], s.pts[1]),
  run: async (c, s) => {
    const st = c.view.store, [a, b] = s.pts;
    const from = descendants(st.page, [a.id]).has(b.id) ? [a, b] : descendants(st.page, [b.id]).has(a.id) ? [b, a] : undefined;
    if (!from) { await c.app.dlg.message('请先选原象点，再选由它经过构造得到的象点（象点要依赖原象点）。'); return; }
    const name = await c.app.dlg.customTransformName();
    if (name) { st.run('创建自定义变换', () => { (st.page.transforms ??= []).push({ name, src: from[0].id, img: from[1].id }); }); c.view.marks = { ...c.view.marks }; }
  },
});
def(36951, { enabled: c => !!c.view.store.page.transforms?.length, run: c => c.app.dlg.editCustomTransforms(c.view) });
// “变换”菜单底部：本页每个自定义变换一项（ID 从 3201 起，原版采集）
for (let k = 0; k < 32; k++) {
  def(CMD_CUSTOM + k, {
    name: c => c.view.store.page.transforms?.[k]?.name ?? '',
    enabled: (c, s) => { const t = c.view.store.page.transforms?.[k]; return !!t && (s.geo.length > 0 || s.images.length > 0) && !!customChain(c.view.store, t); },
    run: (c, s) => {
      const st = c.view.store, t = st.page.transforms![k]; let made: Obj[] = [];
      const targets = s.objs.filter(o => s.geo.includes(o) || s.images.includes(o)).map(o => o.id);
      st.run(t.name, () => { made = applyCustomTransform(st, t, targets); });
      c.view.setSel(made.map(o => o.id));
    },
  });
}

// ---------------- 度量 ----------------
/** 弧，或 圆 + 圆上 2 点。 */
function arcSel(_c: Ctx, s: Sel) { return (s.n >= 1 && allOf(s, s.arcs)) || (s.n === 3 && s.circles.length === 1 && s.pts.length === 2); }
function arcRefs(s: Sel): Id[] { return s.arcs.length ? [s.arcs[0].id] : [s.circles[0].id, s.pts[0].id, s.pts[1].id]; }
const pathIs = (o: Obj, ...k: string[]) => k.includes(o.def.k);
def(36953, measureCmd('length', '长度', (_c, s) => allOf(s, s.segs), s => s.segs.map(o => o.id), true) as CmdDef);
def(36954, measureCmd('distance', '距离', (_c, s) => (s.n === 2 && s.pts.length === 2) || (s.n === 2 && s.pts.length === 1 && s.straights.length === 1), s => (s.pts.length === 2 ? [s.pts[0].id, s.pts[1].id] : [s.pts[0].id, s.straights[0].id])));
def(36955, measureCmd('perimeter', '周长', (_c, s) => allOf(s, s.interiors) && s.interiors.every(o => o.def.k === 'poly'), s => s.interiors.map(o => o.id), true));
def(36956, measureCmd('circumference', '圆周长', (_c, s) => allOf(s, s.circles), s => s.circles.map(o => o.id), true));
def(36957, measureCmd('angle', '角度', (_c, s) => allOf(s, s.pts) && s.n === 3, s => s.pts.map(o => o.id)));
def(36958, measureCmd('area', '面积', (_c, s) => s.n > 0 && s.objs.every(o => classOf(o) === 'interior' || classOf(o) === 'circle'), s => s.objs.map(o => o.id), true));
def(36959, measureCmd('arcangle', '弧度角', arcSel, arcRefs, false));
def(36960, measureCmd('arclength', '弧长', arcSel, arcRefs, false));
def(36961, measureCmd('radius', '半径', (_c, s) => s.n > 0 && s.objs.every(o => ['circle', 'arc'].includes(classOf(o))), s => s.objs.map(o => o.id), true));
def(36962, measureCmd('ratio', '比', (_c, s) => s.n === 2 && s.segs.length === 2, s => s.segs.map(o => o.id)));
def(36963, {
  name: () => '点的值',
  enabled: (c, s) => (s.n > 0 && s.onpath.length === s.n) || (c.shift && s.paths.length === 1 && s.pts.length > 0 && s.n === s.pts.length + 1),
  run: (c, s) => {
    const st = c.view.store, made: Id[] = [];
    st.run('度量点的值', () => {
      for (const p of s.pts) {
        const path = s.paths[0]?.id ?? (p.def.k === 'onpath' ? p.def.path : undefined);
        if (path !== undefined) made.push(st.add({ k: 'measure', m: 'pointvalue', refs: [p.id, path] }, { at: c.app.nextTextPos(c.view) }).id);
      }
    });
    c.view.setSel(made);
  },
});
def(36964, measureCmd('coords', '坐标', (_c, s) => allOf(s, s.pts), s => s.pts.map(o => o.id), true));
def(36965, measureCmd('abscissa', '横坐标', (_c, s) => allOf(s, s.pts), s => s.pts.map(o => o.id), true));
def(36966, measureCmd('ordinate', '纵坐标', (_c, s) => allOf(s, s.pts), s => s.pts.map(o => o.id), true));
def(36967, measureCmd('coorddist', '坐标距离', (_c, s) => allOf(s, s.pts) && s.n === 2, s => s.pts.map(o => o.id)));
def(36968, measureCmd('slope', '斜率', (_c, s) => allOf(s, s.straights), s => s.straights.map(o => o.id), true));
def(36969, measureCmd('equation', '方程', (_c, s) => s.n > 0 && s.objs.every(o => pathIs(o, 'line', 'parallel', 'perp') || o.def.k === 'circle' || o.def.k === 'circle-seg'), s => s.objs.map(o => o.id), true));

// 带坐标系的度量需要 sys 作为额外引用：multi 模式下统一补上
for (const id of [36964, 36965, 36966, 36968, 36969]) {
  const d = commands.get(id)!, m = ({ 36964: 'coords', 36965: 'abscissa', 36966: 'ordinate', 36968: 'slope', 36969: 'equation' } as Record<number, MeasureKind>)[id];
  d.run = (c, s) => {
    const st = c.view.store, made: Id[] = [];
    const list = id === 36964 || id === 36965 || id === 36966 ? s.pts : id === 36968 ? s.straights : s.objs;
    st.run(`度量${id === 36964 ? '坐标' : id === 36965 ? '横坐标' : id === 36966 ? '纵坐标' : id === 36968 ? '斜率' : '方程'}`, () => {
      const sys = findSys(st) ?? createSystem(st);
      autoLabel(c, list.map(o => o.id));
      if (m === 'coords' && c.shift) { for (const p of list) for (const k of ['abscissa', 'ordinate'] as const) made.push(st.add({ k: 'measure', m: k, refs: [p.id, sys.id] }, { at: c.app.nextTextPos(c.view), style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } }).id); return; }
      for (const o of list) made.push(st.add({ k: 'measure', m, refs: [o.id, sys.id] }, { at: c.app.nextTextPos(c.view), style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } }).id);
    });
    c.view.setSel(made);
  };
}
{
  const d = commands.get(36967)!;
  d.run = (c, s) => { const st = c.view.store; let made: Obj | undefined; st.run('度量坐标距离', () => { const sys = findSys(st) ?? createSystem(st); autoLabel(c, [s.pts[0].id, s.pts[1].id]); made = st.add({ k: 'measure', m: 'coorddist', refs: [s.pts[0].id, s.pts[1].id, sys.id] }, { at: c.app.nextTextPos(c.view), style: { color: '#000000', pointSize: 2, width: 2, dash: 'solid' } }); }); if (made) c.view.setSel([made.id]); };
}

// ---------------- 数据 ----------------
def(36970, {
  run: async c => {
    const r = await c.app.dlg.newParam(c.view);
    if (!r) return;
    let m: Obj | undefined;
    c.view.store.run('新建参数', () => { m = c.view.store.add({ k: 'param', name: r.name, value: r.value, unit: r.unit, showEdit: c.app.settings.paramEdit }, { at: c.app.nextTextPos(c.view), label: r.name, labelShown: false }); });
    if (m) c.view.setSel([m.id]);
  },
});
def(36971, {
  run: async c => {
    const r = await c.app.dlg.calc(c.view, undefined);
    if (!r) return;
    let m: Obj | undefined;
    // 计算的类型号就是结果单位（无单位 / 距离 / 角度），按当前值定下来；求不出值时按无单位。
    const st = c.view.store, unit = evaluateExpression(st.page, st.results, r.expr, st.ctx.angleUnit)?.u ?? 'none';
    st.run('新建计算', () => { m = st.add({ k: 'calc', expr: r.expr, unit }, { at: c.app.nextTextPos(c.view) }); });
    if (m) c.view.setSel([m.id]);
  },
});
def(36972, {
  enabled: (_c, s) => s.n > 0 && s.objs.every(o => ['measure', 'param', 'calc', 'func'].includes(o.def.k)),
  run: (c, s) => c.app.makeTable(c.view, s),
});
def(36973, { enabled: (_c, s) => s.n === 1 && s.tables.length === 1 && s.tables[0].def.k === 'table', run: (c, s) => c.app.dlg.addTableData(c.view, s.tables[0]) });
def(36974, { enabled: (_c, s) => s.n === 1 && s.tables.length === 1 && s.tables[0].def.k === 'table' && s.tables[0].def.rows.length > 0, run: (c, s) => c.app.dlg.deleteTableData(c.view, s.tables[0]) });
def(36975, { run: c => c.app.newFunction(c.view, false) });
def(36976, {
  enabled: (_c, s) => s.n === 1 && s.funcs.length === 1,
  run: (c, s) => {
    const f = s.funcs[0]; if (f.def.k !== 'func') return;
    const st = c.view.store, expression = functionExpression(st.page, f.id), e = expression && derive(expression);
    if (!e) { c.app.dlg.message('这个函数里有无法求导的部分（调用了其它函数，或用了取整、符号函数）。'); return; }
    const used = new Set(st.page.objects.filter(o => o.def.k === 'func').map(o => (o.def as { name: string }).name));
    let name = `${f.def.name}'`; while (used.has(name)) name += "'";
    const d = f.def; let m: Obj | undefined;
    st.run('定义导函数', () => { m = st.add({ ...d, name, expr: e, derivativeOf: f.id }, { at: c.app.nextTextPos(c.view), label: name }); });
    if (m) c.view.setSel([m.id]);
  },
});
def(36977, {
  name: (_c, s) => (s.images.length ? '定义图片函数' : '定义绘图函数'),
  enabled: (_c, s) => s.n === 1 && (s.objs[0].def.k === 'stroke' || s.images.length === 1),
  run: async (c, s) => {
    const st = c.view.store, stroke = s.objs[0]; let made: Obj | undefined;
    const shape = st.results.get(stroke.id)?.shape;
    let heightRaster: string | undefined;
    if (shape?.k === 'box' && shape.image) {
      try {
        if (shape.image.mime !== 'image/png') heightRaster = await bitmapAsPng(shape.image.data, shape.image.mime);
      } catch { c.app.dlg.message('不能读取这张图片的像素。'); return; }
      const mask = readHeightMask(heightRaster ?? shape.image.data);
      if (!mask) { c.app.dlg.message('不能读取这张图片的像素。'); return; }
      if (mask.solid && !(shape.image.clips?.length) &&
        !await c.app.dlg.confirm('这张图片的边界是实心矩形。继续按它的上边界定义函数吗？')) return;
      if (!st.get(stroke.id)) return;
    }
    st.run('定义绘图函数', () => {
      const sys = findSys(st) ?? createSystem(st);
      const used = new Set(st.page.objects.filter(o => o.def.k === 'func' || o.def.k === 'picfunc').map(o => (o.def.k === 'func' ? o.def.name : o.label)));
      const name = [...'fghijklmn'].find(ch => !used.has(ch)) ?? 'f';
      made = st.add({ k: 'picfunc', stroke: stroke.id, sys: sys.id,
        ...(shape?.k === 'box' && shape.image ? { height: true as const } : {}),
        ...(heightRaster ? { heightRaster } : {}),
      }, { at: c.app.nextTextPos(c.view), label: name });
    });
    if (made) c.view.setSel([made.id]);
  },
});

// ---------------- 绘图 ----------------
def(36978, {
  enabled: (_c, s) => s.syss.length === 0 && s.plots.length === 0,
  name: (_c, s) => (s.pts.length === 1 && s.n === 1 ? '定义原点' : s.n === 1 && (s.segs.length === 1 || s.objs[0].def.k === 'measure') ? '定义单位长度' : s.circles.length === 1 && s.n === 1 ? '定义单位圆' : '定义坐标系'),
  run: (c, s) => c.app.defineSystem(c.view, s),
});
def(36979, { enabled: (_c, s) => s.syss.length > 0, run: (c, s) => { c.view.marks.center = (s.syss[0].def as { origin: Id }).origin; c.app.flashStatus('已标记坐标系'); } });
for (const [id, grid] of [[36981, 'square'], [36982, 'rect'], [36980, 'polar'], [36983, 'tri']] as const) {
  def(id, { checked: c => { const s = findSys(c.view.store); return !!s && s.def.k === 'sys' && s.def.grid === grid; }, run: c => c.app.setGrid(c.view, grid) });
}
def(36984, {
  name: (c, s) => { void s; const sys = findSys(c.view.store); return c.shift ? (sys ? '隐藏坐标系' : '显示坐标系') : sys && sys.def.k === 'sys' && sys.def.showGrid ? '隐藏网格' : '显示网格'; },
  run: (c, s) => { void s; c.app.toggleGrid(c.view, c.shift); },
});
def(36985, { checked: c => { const s = findSys(c.view.store); return !!s && s.def.k === 'sys' && !!s.def.gridPoints; }, run: c => c.app.toggleGridPoints(c.view) });
def(36986, { enabled: c => !!findSys(c.view.store), checked: c => pageAutoSnap(c.view.store.page), run: c => c.app.toggleAutoSnap(c.view) });
def(36987, { name: (_c, s) => (s.paths.length === 1 ? `在${typeName(s.paths[0])}上绘制点…` : '在轴上绘制点…'), run: (c, s) => c.app.dlg.plotOnPath(c.view, s) });
def(36988, { name: (_c, s) => (s.n === 2 && s.numeric.length === 2 ? '绘制点(x，y)' : '绘制点…'), run: (c, s) => c.app.plotPoint(c.view, s) });
def(36989, { enabled: (_c, s) => s.n === 1 && s.tables.length === 1 && s.tables[0].def.k === 'table', run: (c, s) => c.app.plotTable(c.view, s.tables[0]) });
def(36990, {
  name: (_c, s) => (s.n === 1 && s.funcs.length === 1 ? '绘制函数' : '绘制新函数…'),
  run: (c, s) => (s.n === 1 && s.funcs.length === 1 ? c.app.plotFunction(c.view, s.funcs[0]) : c.app.newFunction(c.view, true)),
});
def(36991, {
  run: async (c, s) => {
    if (!c.view.store.page.objects.some(o => o.def.k === 'func')) { await c.app.dlg.message('绘制参数曲线需要先有函数。请先用“数据 → 新建函数”建立。'); return; }
    const r = await c.app.dlg.paramCurve(c.view, s.funcs);
    if (r) c.app.makeParamCurve(c.view, r);
  },
});

// ---------------- 仅出现在右键菜单的命令 ----------------
export const CMD_RES_UP = 200001, CMD_RES_DOWN = 200002, CMD_VAL_UP = 200003, CMD_VAL_DOWN = 200004, CMD_ITER_UP = 200005, CMD_ITER_DOWN = 200006;
for (const [id, k] of [[CMD_ITER_UP, 1], [CMD_ITER_DOWN, -1]] as const) {
  def(id, {
    name: () => (k > 0 ? '增加迭代' : '减少迭代'),
    enabled: (_c, s) => s.n > 0 && s.objs.every(o => o.def.k === 'iterimg'),
    run: (c, s) => {
      const iters = new Set(s.objs.map(o => (o.def as { iter: Id }).iter));
      c.view.store.run(k > 0 ? '增加迭代' : '减少迭代', () => { for (const it of iters) changeDepth(c.view.store, it, k); });
    },
  });
}
for (const [id, k] of [[CMD_RES_UP, 2], [CMD_RES_DOWN, 0.5]] as const) {
  def(id, {
    name: () => (k > 1 ? '提高分辨率' : '降低分辨率'),
    enabled: (_c, s) => s.n > 0 && s.objs.every(o => o.def.k === 'plot' || o.def.k === 'locus' || o.def.k === 'pcurve' || o.def.k === 'custom-image'),
    run: (c, s) => c.view.store.run(k > 1 ? '提高分辨率' : '降低分辨率', () => {
      for (const o of s.objs) {
        if (o.def.k === 'plot' || o.def.k === 'locus' || o.def.k === 'pcurve') c.view.store.update(o.id, { ...o.def, samples: Math.max(20, Math.min(4000, Math.round(o.def.samples * k))) });
        else if (o.def.k === 'custom-image') c.view.store.update(o.id, { ...o.def, samples: Math.max(4, Math.min(1000000, Math.round(o.def.samples * k))) });   // 取样变换图片的采样数（范围为新版设定）
      }
    }),
  });
}
for (const [id, k] of [[CMD_VAL_UP, 1], [CMD_VAL_DOWN, -1]] as const) {
  def(id, {
    name: () => (k > 0 ? '增加数值' : '减少数值'),
    enabled: (_c, s) => s.n === 1 && s.objs[0].def.k === 'param',
    run: (c, s) => {
      const o = s.objs[0]; if (o.def.k !== 'param') return;
      const d = o.def, step = d.unit === 'angle' ? 5 : 1 / Math.pow(10, Math.min(2, String(d.value).split('.')[1]?.length ?? 0));
      c.view.store.run(k > 0 ? '增加数值' : '减少数值', () => c.view.store.update(o.id, { ...d, value: Number((d.value + k * step).toFixed(6)) }));
    },
  });
}

// ---------------- 窗口 / 帮助 ----------------
def(57650, { run: c => c.app.mdi.arrange('cascade') });
def(57651, { run: c => c.app.mdi.arrange('tile') });
def(-1, { run: c => c.app.dlg.about() });
def(-2, { run: c => c.app.dlg.help() });

export function queryCommand(id: number, ctx: Ctx): CmdState {
  const d = commands.get(id);
  if (!d) return { enabled: false };
  const s = analyse(ctx.view);
  if (ctx.view.textEdit && ![32882, 32883, 32884, 32892, 32893, 36865, 36864, 36875, 36921, 36922, 36923, 57650, 57651, -1, -2].includes(id) && !(id >= 36876 && id <= 36881)) return { enabled: false, name: d.name?.(ctx, s) };
  return { enabled: d.deferred ? false : (d.enabled ? d.enabled(ctx, s) : true), name: d.name?.(ctx, s), checked: d.checked?.(ctx, s) };
}

export async function executeCommand(id: number, ctx: Ctx): Promise<void> {
  const d = commands.get(id);
  if (!d || d.deferred) return;
  const st = queryCommand(id, ctx);
  if (!st.enabled) return;
  try { await d.run(ctx, analyse(ctx.view)); }
  catch (e) { ctx.app.dlg.message(`操作没有完成：${e instanceof Error ? e.message : String(e)}`); }
  ctx.app.refresh();
}

export const DEFERRED = [...commands].filter(([, d]) => d.deferred).map(([id, d]) => ({ id, why: d.deferred! }));
export { q };
export type { Def };
