/** 对话框：分组、选项顺序与默认值按界面规格；文字用自己的话。全部是 DOM 模态框，返回 Promise。 */
import type { App } from '../app';
import { exprToText, fmtNum, FUNCS, formatQ, ParseError, type Expr } from '../core/expr';
import { evaluateExpression } from '../core/engine';
import { classOf, createSystem, findSys } from '../core/construct';
import { hitAll } from '../core/hit';
import { isExternalActionUrl } from '../core/link';
import type { AngleBy, DisplayPrefs, FuncForm, Id, Obj, RatioBy, TextCat, TextStyle, TranslateBy, UnitKind } from '../core/model';
import { childrenOf, pageDisplay, parentsOf, TEXT_CATS, TEXT_DEFAULTS } from '../core/model';
import type { Sel } from '../commands';
import type { DocView } from './docview';
import { funcHead, measureName, typeName } from './render';
import { PAPERS } from './print';

type Child = Node | string | undefined | false | null;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v !== undefined && v !== null) { if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v; else el.setAttribute(k, String(v)); }
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

type Gather<T> = () => { ok: T } | { error: string };

interface ModalExtra { cancelLabel?: string; width?: number; noCancel?: boolean; noHelp?: boolean; help?: string; onClose?: () => void; onBackDown?: (e: PointerEvent) => void; okRef?: (ok: HTMLButtonElement) => void }

/** 帮助按钮的说明（自己的话，简短）。 */
const HELP: Record<string, string> = {
  新建参数: '参数是一个可以随时修改的数值。填写名称、数值和单位后按确定，它会显示在画板上。',
  编辑参数: '修改参数的名称、数值或单位，依赖它的对象随之更新。',
  新建计算: '用下面的按键或键盘输入表达式；单击画板上的数值可以把它加进表达式。',
  编辑计算: '修改表达式；单击画板上的数值可以把它加进表达式。',
  新建函数: '输入含自变量的表达式。“方程”菜单可以选择函数形式和写法。',
  编辑函数: '修改函数的表达式。“方程”菜单可以选择函数形式和写法。',
  参数选项: '单位页设置度量值的单位和精度，颜色页设置新对象的颜色，文本页设置标签和文字，工具页设置各工具的行为。',
  文档选项: '管理文档的页：增加、删除、改名，以及是否显示页切换。按取消可以撤回这里的所有改动。',
  平移: '选择平移方式并填写距离和角度；画板上的浅色图形是预览。',
  旋转: '填写旋转角度，或用标记的角度；逆时针为正。画板上的浅色图形是预览。',
  缩放: '填写缩放比，或用标记的比。画板上的浅色图形是预览。',
  绘制点: '按坐标绘制一个点；切换坐标系时数值自动换算。',
  文本样式: '分别设置标签、标题、数值和函数、按钮、表格、坐标轴数字的字体。只保存和出厂样式不同的项。大小按相对出厂大小的比例缩放。',
  自定义变换: '先做出一个点和它经过若干步构造得到的象，再同时选中它们创建自定义变换。之后选中别的点，在“变换”菜单的底部执行这个变换，会重复同样的构造。',
  绘制曲线: '选两个函数：单击画板上的函数式，或事先选中它们。直角坐标系画 (f(t), g(t))；极坐标系画 (r, α)，α 没有单位时按弧度。',
};

export class Dialogs {
  open = false;
  constructor(private app: App) {}

  /** 通用模态框：帮助、取消、确定从左到右。ok 按钮调用 gather；取消返回 undefined。背景不变灰。 */
  modal<T>(title: string, body: HTMLElement, gather: Gather<T>, okLabel = '确定', extra: ModalExtra = {}): Promise<T | undefined> {
    return new Promise(resolve => {
      const err = h('div', { class: 'dlg-err' });
      const ok = h('button', { class: 'primary' }, okLabel);
      const cancel = h('button', { class: 'dlg-cancel' }, extra.cancelLabel ?? '取消');
      const help = h('button', { class: 'dlg-help', type: 'button' }, '帮助(H)');
      help.onclick = () => void this.help(extra.help ?? title.replace(/ .*/, ''));
      const box = h('div', { class: 'dlg', role: 'dialog', style: extra.width ? `width:${extra.width}px` : '' }, h('div', { class: 'dlg-title' }, title), h('div', { class: 'dlg-body' }, body), err, h('div', { class: 'dlg-btns' }, !extra.noHelp && help, !extra.noCancel && cancel, ok));
      const back = h('div', { class: 'dlg-back' }, box);
      const finish = (v: T | undefined) => { document.removeEventListener('keydown', onKey, true); back.remove(); this.open = !!document.querySelector('.dlg-back'); extra.onClose?.(); resolve(v); };
      const commit = () => { if (ok.disabled) return; const r = gather(); if ('error' in r) { err.textContent = r.error; return; } finish(r.ok); };
      const topmost = () => [...document.querySelectorAll('.dlg-back')].pop() === back;
      const onKey = (e: KeyboardEvent) => {
        if (!topmost()) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(undefined); }
        else if (e.key === 'Enter' && !(e.target as HTMLElement).matches('textarea,button')) { e.preventDefault(); e.stopPropagation(); commit(); }
      };
      ok.onclick = commit; cancel.onclick = () => finish(undefined);
      if (extra.onBackDown) back.addEventListener('pointerdown', e => { if (e.target === back) extra.onBackDown!(e); });
      document.addEventListener('keydown', onKey, true);
      this.open = true;
      document.body.append(back);
      extra.okRef?.(ok);
      const visible = (sel: string) => [...box.querySelectorAll<HTMLElement>(sel)].find(x => x.offsetParent !== null);
      visible('input:not([type=radio]):not([type=checkbox]):not([type=color]),textarea')?.focus();
      (visible('input:not([type=radio]):not([type=checkbox]):not([type=color])') as HTMLInputElement | undefined)?.select();
    });
  }

  message(text: string): Promise<void> {
    return this.modal<boolean>('提示', h('div', { class: 'dlg-text' }, text), () => ({ ok: true }), '确定', { noCancel: true, noHelp: true }).then(() => undefined);
  }
  ask(text: string, labels: string[]): Promise<string | undefined> {
    return new Promise(resolve => {
      const btns = labels.map((l, i) => h('button', { class: i === 0 ? 'primary' : '', onclick: () => finish(l) }, l));
      const box = h('div', { class: 'dlg', role: 'dialog' }, h('div', { class: 'dlg-title' }, '确认'), h('div', { class: 'dlg-body dlg-text' }, text), h('div', { class: 'dlg-btns' }, ...btns));
      const back = h('div', { class: 'dlg-back' }, box);
      const finish = (v: string | undefined) => { document.removeEventListener('keydown', onKey, true); back.remove(); this.open = !!document.querySelector('.dlg-back'); resolve(v); };
      const onKey = (e: KeyboardEvent) => { if ([...document.querySelectorAll('.dlg-back')].pop() === back && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(undefined); } };
      document.addEventListener('keydown', onKey, true);
      this.open = true; document.body.append(back); (btns[0] as HTMLElement).focus();
    });
  }
  confirm(text: string): Promise<boolean> { return this.ask(text, ['确定', '取消']).then(r => r === '确定'); }

  /** 弹出一个小菜单（参数选项之外的“增加页”“父对象”等按钮用）。 */
  private popup(anchor: HTMLElement, items: { label: string; disabled?: boolean; run?: () => void }[]) {
    document.querySelector('.popup-menu')?.remove();
    const m = h('div', { class: 'popup-menu' });
    for (const it of items) {
      const row = h('div', { class: it.disabled ? 'pi disabled' : 'pi' }, it.label);
      if (!it.disabled) row.onclick = () => { m.remove(); it.run?.(); };
      m.append(row);
    }
    const r = anchor.getBoundingClientRect();
    m.style.left = `${r.left}px`; m.style.top = `${r.bottom}px`;
    document.body.append(m);
    const off = (e: Event) => { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    window.setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

  /** 在事务里试做一次变换，把结果记成预览，然后撤回。 */
  private ghost(v: DocView, make: () => Obj[]) {
    const st = v.store;
    if (st.inTransaction || st.protectedReason) return;
    try {
      st.begin('预览');
      const made = make(), results = new Map(st.results), objects = made.map(o => structuredClone(o));
      const page = { ...st.page, objects };
      st.cancel();
      v.ghost = { page, results };
    } catch { if (st.inTransaction) st.cancel(); v.ghost = undefined; }
    v.invalidate();
  }

  // ------------- 小部件 -------------
  private num(value: number | string, width = 80) { return h('input', { type: 'text', value: String(value), style: `width:${width}px`, inputMode: 'decimal' }); }
  private radios<T extends string>(name: string, items: [T, string, boolean?][], onchange?: (v: T) => void) {
    const wrap = h('div', { class: 'radios' });
    const inputs = items.map(([v, label, disabled]) => { const i = h('input', { type: 'radio', name, value: v, disabled: !!disabled }); i.onchange = () => onchange?.(v); wrap.append(h('label', {}, i, label)); return i; });
    return { el: wrap, get value() { return (inputs.find(i => i.checked)?.value ?? items[0][0]) as T; }, set(v: T) { for (const i of inputs) i.checked = i.value === v; onchange?.(v); } };
  }
  private parseNum(s: string, what: string): number {
    const v = Number(s.trim().replace('，', '.').replace(',', '.'));
    if (!s.trim() || !Number.isFinite(v)) throw new Error(`${what}需要填写数字`);
    return v;
  }
  private guard<T>(fn: () => T): { ok: T } | { error: string } { try { return { ok: fn() }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } }

  // ------------- 变换 -------------
  /** 固定值 / 标记值的一组：单选 + 输入框 + 单位。 */
  private fixedOrMarked(name: string, labels: [string, string], enabled: boolean, value: string, unit: string) {
    const input = this.num(value, 64);
    const pick = this.radios(name, [['fixed', labels[0]], ['marked', labels[1], !enabled]], x => { input.disabled = x === 'marked'; });
    pick.set('fixed');
    return { pick, input, el: h('div', { class: 'group' }, '以：', pick.el, h('div', { class: 'row' }, input, ` ${unit}`)) };
  }
  translate(v: DocView, preview?: (by: TranslateBy) => Obj[]): Promise<TranslateBy | undefined> {
    const m = v.marks, st = v.store;
    const hasVec = !!m.vector && !!st.get(m.vector[0]) && !!st.get(m.vector[1]);
    const hasDist = m.distance !== undefined && !!st.get(m.distance);
    const hasAng = !!m.angle && (Array.isArray(m.angle) ? m.angle.every(i => !!st.get(i)) : !!st.get(m.angle.m));
    const dist = this.fixedOrMarked('tdist', ['固定距离(F)', '标记距离(M)'], hasDist, '1.0', '厘米');
    const ang = this.fixedOrMarked('tang', ['固定角度(F)', '标记角度(M)'], hasAng, '90.0', '°');
    const dx = this.fixedOrMarked('tdx', ['固定距离(F)', '标记距离(M)'], hasDist, '1.0', '厘米（向右为正）');
    const dy = this.fixedOrMarked('tdy', ['固定距离(F)', '标记距离(M)'], hasDist, '1.0', '厘米（向上为正）');
    const polar = h('div', {}, dist.el, ang.el), rect = h('div', {}, dx.el, dy.el);
    const mode = this.radios('tmode', [['polar', '极坐标'], ['rect', '直角坐标'], ['vec', '标记', !hasVec]], x => { polar.hidden = x !== 'polar'; rect.hidden = x !== 'rect'; refresh(); });
    const read = (): TranslateBy => {
      if (mode.value === 'vec') return { mode: 'vector', from: m.vector![0], to: m.vector![1] };
      if (mode.value === 'rect') {
        const mx = dx.pick.value === 'marked', my = dy.pick.value === 'marked';
        return { mode: 'rect', dx: mx ? 0 : this.parseNum(dx.input.value, '水平距离'), dy: my ? 0 : this.parseNum(dy.input.value, '垂直距离'), ...(mx ? { dxBy: m.distance! } : {}), ...(my ? { dyBy: m.distance! } : {}) };
      }
      return {
        mode: 'polar',
        dist: dist.pick.value === 'marked' ? { m: m.distance! } : { fixed: this.parseNum(dist.input.value, '距离') },
        angle: ang.pick.value === 'marked' ? (Array.isArray(m.angle) ? { pts: m.angle } : { m: m.angle!.m }) : { fixed: this.parseNum(ang.input.value, '角度') },
      };
    };
    const refresh = () => { if (!preview) return; try { const by = read(); this.ghost(v, () => preview(by)); } catch { v.ghost = undefined; v.invalidate(); } };
    const body = h('div', {}, h('div', { class: 'group' }, '平移变换：', mode.el), polar, rect);
    body.addEventListener('input', refresh); body.addEventListener('change', refresh);
    mode.set('polar');
    return this.modal('平移', body, () => this.guard(read), '平移(T)', { onClose: () => { v.ghost = undefined; v.invalidate(); } });
  }

  /** “中心”一栏：显示变换中心的名字。 */
  private centerGroup(v: DocView, center: Id) { const o = v.store.get(center); return h('div', { class: 'group' }, '中心：', h('span', { class: 'tgt' }, o?.label ?? (o ? typeName(o) : '?'))); }

  rotate(v: DocView, center: Id, preview?: (by: AngleBy) => Obj[]): Promise<AngleBy | undefined> {
    const m = v.marks, hasAng = !!m.angle && (Array.isArray(m.angle) ? m.angle.every(i => !!v.store.get(i)) : !!v.store.get(m.angle.m));
    const a = this.num('90.0', 64);
    const mode = this.radios('rmode', [['fixed', '固定角度(F)'], ['marked', '标记角度(M)', !hasAng]], x => { a.disabled = x === 'marked'; refresh(); });
    const read = (): AngleBy => (mode.value === 'marked' ? (Array.isArray(m.angle) ? { mode: 'marked', a: m.angle[0], v: m.angle[1], b: m.angle[2] } : { mode: 'value', m: m.angle!.m }) : { mode: 'fixed', deg: this.parseNum(a.value, '角度') });
    const refresh = () => { if (!preview) return; try { const by = read(); this.ghost(v, () => preview(by)); } catch { v.ghost = undefined; v.invalidate(); } };
    const body = h('div', {}, h('div', { class: 'group' }, '旋转参数：', mode.el, h('div', { class: 'row' }, a, ' 度')), this.centerGroup(v, center));
    body.addEventListener('input', refresh);
    mode.set('fixed');
    return this.modal('旋转', body, () => this.guard(read), '旋转(R)', { onClose: () => { v.ghost = undefined; v.invalidate(); } });
  }

  dilate(v: DocView, center: Id, preview?: (by: RatioBy) => Obj[]): Promise<RatioBy | undefined> {
    const m = v.marks, hasRatio = !!m.ratio;
    const n = this.num('1.0', 64), d = this.num('2.0', 64);
    const mode = this.radios('dmode', [['fixed', '固定比(F)'], ['marked', '标记比(M)', !hasRatio]], x => { n.disabled = d.disabled = x === 'marked'; refresh(); });
    const read = (): RatioBy => {
      if (mode.value === 'marked') { const r = m.ratio!; return 'm' in r ? { mode: 'value', m: r.m } : 'pts' in r ? { mode: 'marked', a: r.pts[0], b: r.pts[1], c: r.pts[2] } : { mode: 'marked', a: r.segs[0], b: r.segs[1] }; }
      const num = this.parseNum(n.value, '分子'), den = this.parseNum(d.value, '分母');
      if (den === 0) throw new Error('分母不能是 0');
      return { mode: 'fixed', num, den };
    };
    const refresh = () => { if (!preview) return; try { const by = read(); this.ghost(v, () => preview(by)); } catch { v.ghost = undefined; v.invalidate(); } };
    const body = h('div', {}, h('div', { class: 'group' }, '缩放参数：', mode.el, h('div', { class: 'fraction' }, n, h('hr'), d)), this.centerGroup(v, center));
    body.addEventListener('input', refresh);
    mode.set('fixed');
    return this.modal('缩放', body, () => this.guard(read), '缩放(D)', { onClose: () => { v.ghost = undefined; v.invalidate(); } });
  }

  // ------------- 数据 -------------
  newParam(_v: DocView, initial?: { name: string; value: number; unit: UnitKind }): Promise<{ name: string; value: number; unit: UnitKind } | undefined> {
    const name = h('input', { type: 'text', value: initial?.name ?? this.nextParamName(_v), style: 'width:70px' });
    const val = this.num(initial ? fmtNum(initial.value) : '1.00', 70);
    const suffix = h('span', {});
    const unit = this.radios<UnitKind>('punit', [['none', '无'], ['angle', '角度'], ['distance', '距离']], x => { suffix.textContent = x === 'angle' ? '°' : x === 'distance' ? ' 厘米' : ''; });
    unit.set(initial?.unit ?? 'none');
    const body = h('div', {},
      h('div', { class: 'param-row' }, h('span', { class: 'cap' }, '名称'), h('span', {}), h('span', { class: 'cap' }, '数值'), name, h('span', {}, ' = '), h('span', {}, val, suffix)),
      h('div', { class: 'group' }, '单位：', unit.el));
    return this.modal(initial ? '编辑参数' : '新建参数', body, () => this.guard(() => {
      const nm = name.value.trim(); if (!nm) throw new Error('名称不能为空');
      if (/[\s()+\-*/^]/.test(nm)) throw new Error('名称里不能有空格和运算符号');
      return { name: nm, value: this.parseNum(val.value, '数值'), unit: unit.value };
    }), '确定', { width: 300 });
  }
  private nextParamName(v: DocView): string {
    const names = new Set(v.store.page.objects.filter(o => o.def.k === 'param').map(o => (o.def as { name: string }).name));
    for (let i = 1; i < 1000; i++) { const n = `t${'₀₁₂₃₄₅₆₇₈₉'.split('')[0] && i === 1 ? '₁' : String(i).split('').map(c => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]).join('')}`; if (!names.has(n)) return n; }
    return 't';
  }
  async editParam(v: DocView, o: Obj) {
    if (o.def.k !== 'param') return;
    const d = o.def, r = await this.newParam(v, { name: d.name, value: d.value, unit: d.unit });
    if (r) v.store.run('编辑参数', () => { v.store.update(o.id, { ...d, name: r.name, value: r.value, unit: r.unit }); o.label = r.name; });
  }

  /** 表达式编辑器：上面是预览，中间是编辑框，下面是按键和菜单。单击画板上的数值可以把它插入表达式。 */
  private exprEditor(v: DocView, title: string, opts: { func: boolean; initial?: Expr; name?: string; form?: FuncForm; symbol?: boolean }): Promise<{ expr: Expr; variable: string; form: FuncForm; symbol: boolean } | undefined> {
    const st = v.store;
    const VAR: Record<FuncForm, string> = { 'y=f(x)': 'x', 'x=f(y)': 'y', 'r=f(t)': 'θ', 't=f(r)': 'r' };
    let form: FuncForm = opts.form ?? 'y=f(x)', symbol = !!opts.symbol, variable = VAR[form];
    const nameFn = (id: Id) => this.nameOf(v, id);
    const ta = h('input', { type: 'text', class: 'expr', value: opts.initial ? exprToText(opts.initial, nameFn, 0, variable) : '', spellcheck: false });
    const preview = h('div', { class: 'expr-preview hint' });
    let okBtn: HTMLButtonElement | undefined;
    let update: () => void = () => undefined;
    const ins = (t: string) => { const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s; ta.setRangeText(t, s, e, 'end'); ta.focus(); update(); };
    const back = () => { const s = ta.selectionStart ?? 0, e = ta.selectionEnd ?? s; if (s !== e) ta.setRangeText('', s, e, 'end'); else if (s > 0) ta.setRangeText('', s - 1, s, 'end'); ta.focus(); update(); };
    const opBtns: Record<string, HTMLButtonElement> = {};
    const key = (k: string, cls = '') => { const b = h('button', { type: 'button', class: cls, onclick: () => (k === '⌫' ? back() : k === 'var' ? ins(variable) : ins(k)) }, k === 'var' ? variable : k); b.onmousedown = e => e.preventDefault(); opBtns[k] = b; return b; };
    const grid = h('div', { class: 'calc-grid' },
      ...['7', '8', '9', '+', '^', '4', '5', '6', '-', '(', '1', '2', '3', '*', ')'].map(k => key(k)),
      ...(opts.func ? [key('0'), key('.'), key('var'), key('/'), key('⌫')] : [key('0', 'wide'), key('.'), key('/'), key('⌫')]));
    const menu = (label: string, items: [string, string][], onPick: (x: string) => void = ins) => {
      const sel = h('select', {}, h('option', { value: '' }, label), ...items.map(([t, v2]) => h('option', { value: v2 }, t)));
      sel.onchange = () => { const x = sel.value; sel.value = ''; if (x) onPick(x); };
      return sel;
    };
    const values: [string, string][] = st.page.objects.filter(o => ['param', 'calc', 'measure'].includes(o.def.k)).map(o => { const n = this.nameOf(v, o.id), q0 = st.results.get(o.id)?.shape; return [`${n} = ${q0?.k === 'num' ? formatQ(q0.q) : '无定义'}`, n]; });
    const userFunctions = st.page.objects.filter(o => classOf(o) === 'func').map(o => nameFn(o.id));
    const fns: [string, string][] = [...[...FUNCS, ...userFunctions].map(f => [`${f}(x)`, `${f}(`] as [string, string]), ['π', 'pi']];
    const unitSel = menu('单位(U)', [['度 (°)', '°'], ['厘米 (cm)', ' cm']]);
    const parse = () => this.app.parseText(v, ta.value, opts.func ? variable : '\u0000');
    const headText = () => funcHead({ name: opts.name ?? 'f', param: variable, form, symbol });
    const refresh = () => {
      const text = ta.value.trim();
      let parsed: Expr | undefined, bad = '';
      if (text) { try { parsed = parse(); } catch (e) { bad = e instanceof ParseError ? e.message : String(e); } }
      preview.className = `expr-preview${!text ? ' hint' : parsed ? '' : ' bad'}`;
      if (!text) preview.textContent = opts.func ? '用按键或键盘输入含自变量的表达式；单击画板上的数值可以把它加进来。' : '用按键或键盘输入表达式；单击画板上的数值可以把它加进计算。';
      else if (!parsed) preview.textContent = `${opts.func ? `${headText()} = ` : ''}${text}\n（${bad}）`;
      else if (opts.func) preview.textContent = `${headText()} = ${exprToText(parsed, nameFn, 0, variable)}`;
      else {
        const val = evaluateExpression(st.page, st.results, parsed, st.ctx.angleUnit);
        preview.textContent = `${exprToText(parsed, nameFn)} = ${val ? formatQ(val) : '无定义'}`;
      }
      if (okBtn) okBtn.disabled = !parsed;
      unitSel.disabled = !parsed;
      // 运算键随输入状态启用或禁用：运算符只能接在数或右括号后面
      const s = ta.value.slice(0, ta.selectionStart ?? ta.value.length).trimEnd(), end = /[\p{L}\p{N}_)°.π'∠]$/u.test(s);
      for (const k of ['+', '*', '/', '^']) if (opBtns[k]) opBtns[k].disabled = !end;
      if (opBtns['-']) opBtns['-'].disabled = /-$/.test(s);
      const depth = [...s].reduce((n, c) => n + (c === '(' ? 1 : c === ')' ? -1 : 0), 0);
      if (opBtns[')']) opBtns[')'].disabled = !end || depth <= 0;
      if (opBtns['⌫']) opBtns['⌫'].disabled = !ta.value;
    };
    update = refresh;
    ta.oninput = refresh; ta.onkeyup = refresh; ta.onclick = refresh;
    const menus = h('div', { class: 'calc-menus' }, menu('数值(V)', values), menu('函数(F)', fns), unitSel);
    if (opts.func) {
      const FORMS: [FuncForm, string][] = [['y=f(x)', 'y = f(x)'], ['x=f(y)', 'x = f(y)'], ['r=f(t)', 'r = f(θ)'], ['t=f(r)', 'θ = f(r)']];
      const eq = h('select', {});
      const fill = () => eq.replaceChildren(h('option', { value: '' }, '方程(Q)'), h('option', { value: 'sym:0' }, `${symbol ? '　' : '✓ '}符号 f(x)`), h('option', { value: 'sym:1' }, `${symbol ? '✓ ' : '　'}符号 y=`), ...FORMS.map(([f, t]) => h('option', { value: f }, `${form === f ? '✓ ' : '　'}${t}`)));
      fill();
      eq.onchange = () => {
        const x = eq.value; eq.value = '';
        if (x.startsWith('sym:')) symbol = x === 'sym:1';
        else if (x && x !== form) {
          // 换形式时自变量跟着换：表达式能解析就改写，否则原样留着
          let old: Expr | undefined; try { if (ta.value.trim()) old = parse(); } catch { old = undefined; }
          form = x as FuncForm; variable = VAR[form];
          if (old) ta.value = exprToText(old, nameFn, 0, variable);
          opBtns.var.textContent = variable;
        }
        fill(); refresh();
      };
      menus.append(eq);
    }
    const body = h('div', { class: 'calc' }, preview, ta, h('div', { class: 'calc-pad' }, grid, menus));
    refresh();
    return this.modal(title, body, () => {
      try {
        const text = ta.value.trim(); if (!text) return { error: '请输入表达式' };
        return { ok: { expr: parse(), variable, form, symbol } };
      } catch (e) { return { error: e instanceof ParseError ? e.message : String(e) }; }
    }, '确定', {
      width: 400,
      okRef: b => { okBtn = b; refresh(); },
      onBackDown: e => { const hit = hitAll(st.page, st.results, v.toPage(e), this.app.settings.power, { classes: ['measure'] })[0]; if (hit !== undefined) ins(this.nameOf(v, hit)); },
    });
  }
  calc(v: DocView, initial?: Expr): Promise<{ expr: Expr } | undefined> {
    return this.exprEditor(v, initial ? '编辑计算' : '新建计算', { func: false, initial }).then(r => (r ? { expr: r.expr } : undefined));
  }
  func(v: DocView, initial?: { name: string; expr: Expr; form?: FuncForm; symbol?: boolean }): Promise<{ name: string; expr: Expr; variable: string; form: FuncForm; symbol: boolean } | undefined> {
    const next = (() => { const used = new Set(v.store.page.objects.filter(o => classOf(o) === 'func').map(o => this.nameOf(v, o.id))); for (const c of 'fghijklmn') if (!used.has(c)) return c; return 'f'; })();
    const name = initial?.name ?? next;
    return this.exprEditor(v, initial ? '编辑函数' : '新建函数', { func: true, initial: initial?.expr, name, form: initial?.form, symbol: initial?.symbol ?? (initial ? false : this.app.settings.funcSymbol) }).then(r => (r ? { ...r, name } : undefined));
  }
  private nameOf(v: DocView, id: Id): string { const o = v.store.get(id); return !o ? '?' : o.def.k === 'param' ? o.def.name : o.def.k === 'func' ? o.def.name : o.label ?? measureName(v.store.page, v.store.results, o); }
  async editCalc(v: DocView, o: Obj) { if (o.def.k !== 'calc') return; const d = o.def, r = await this.calc(v, d.expr); if (r) v.store.run('编辑计算', () => v.store.update(o.id, { ...d, expr: r.expr, unit: evaluateExpression(v.store.page, v.store.results, r.expr, v.store.ctx.angleUnit)?.u ?? d.unit })); }
  async editFunc(v: DocView, o: Obj) { if (o.def.k !== 'func') return; const d = o.def, r = await this.func(v, { name: d.name, expr: d.expr, form: d.form, symbol: d.symbol }); if (r) v.store.run('编辑函数', () => { const { form: _f, symbol: _s, ...rest } = d; v.store.update(o.id, { ...rest, name: r.name, expr: r.expr, param: r.variable, ...(r.form !== 'y=f(x)' ? { form: r.form } : {}), ...(r.symbol ? { symbol: true } : {}) }); o.label = r.name; }); }

  /** 绘制参数曲线：选两个函数（单击画板上的函数式，或事先选中），坐标系模式，t 的取值范围。 */
  paramCurve(v: DocView, pre: Obj[]): Promise<{ fx: Id; fy: Id; polar: boolean; lo: number; hi: number } | undefined> {
    const st = v.store;
    const picks: (Id | undefined)[] = [pre[0]?.id, pre[1]?.id];
    let active = picks[0] !== undefined && picks[1] === undefined ? 1 : 0;
    const head = h('span', { class: 'pc-head' }, '绘制(x, y)');
    const boxes = [0, 1].map(i => { const b = h('button', { type: 'button', class: 'pbox' }); b.onclick = () => { active = i; paint(); }; return b; });
    const mode = this.radios<'rect' | 'polar'>('pcmode', [['rect', '直角坐标系(R)'], ['polar', '极坐标系(P)']], m => { head.textContent = m === 'polar' ? '绘制(r, α)' : '绘制(x, y)'; });
    const lo = this.num('0.0', 80), hi = this.num('1.0', 80);
    let okBtn: HTMLButtonElement | undefined;
    const paint = () => {
      boxes.forEach((b, i) => { const f = picks[i] !== undefined ? st.get(picks[i]!) : undefined; b.textContent = f ? `${f.def.k === 'func' ? f.def.name : f.label ?? 'f'}(t)` : ''; b.classList.toggle('on', i === active); });
      if (okBtn) okBtn.disabled = picks[0] === undefined || picks[1] === undefined;
    };
    mode.set('rect');
    const body = h('div', {},
      h('div', { class: 'row pc-row' }, head, ' ＝ ( ', boxes[0], ' , ', boxes[1], ' )'),
      h('div', { class: 'group' }, '坐标系：', mode.el),
      h('div', { class: 'group' }, '定义域(D)', h('div', { class: 'row' }, lo, ' ≤ t ≤ ', hi)));
    return this.modal('绘制曲线', body, () => this.guard(() => {
      const a = this.parseNum(lo.value, '起点'), b = this.parseNum(hi.value, '终点');
      if (a >= b) throw new Error('t 的起点要小于终点');
      return { fx: picks[0]!, fy: picks[1]!, polar: mode.value === 'polar', lo: a, hi: b };
    }), '绘制(T)', {
      width: 420, help: '绘制曲线', okRef: b => { okBtn = b; paint(); },
      onBackDown: e => {
        const hit = hitAll(st.page, st.results, v.toPage(e), this.app.settings.power, { classes: ['func'] })[0];
        if (hit === undefined) return;
        picks[active] = hit; active = picks[0] === undefined ? 0 : picks[1] === undefined ? 1 : active === 0 ? 1 : 0; paint();
      },
    });
  }

  plotXY(v: DocView): Promise<{ x: number; y: number } | undefined> {
    const x = this.num('1.0', 60), y = this.num('1.0', 60), deg = h('span', {});
    let was = 'rect';
    const show = (n: number) => String(Number(n.toFixed(3)));
    const sys = this.radios('psys', [['rect', '直角坐标系(R)'], ['polar', '极坐标系(P)']], m => {
      deg.textContent = m === 'polar' ? '°' : '';
      if (m === was) return;
      was = m;
      const a = Number(x.value), b = Number(y.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      if (m === 'polar') { x.value = show(Math.hypot(a, b)); y.value = show((Math.atan2(b, a) * 180) / Math.PI); }
      else { x.value = show(a * Math.cos((b * Math.PI) / 180)); y.value = show(a * Math.sin((b * Math.PI) / 180)); }
    });
    sys.set('rect');
    return this.modal('绘制点', h('div', {}, h('div', { class: 'group' }, '坐标系：', sys.el), h('div', { class: 'row' }, '(', x, ' ，', y, deg, ' )')), () => this.guard(() => {
      const a = this.parseNum(x.value, '横坐标'), b = this.parseNum(y.value, '纵坐标');
      return sys.value === 'polar' ? { x: a * Math.cos((b * Math.PI) / 180), y: a * Math.sin((b * Math.PI) / 180) } : { x: a, y: b };
    }), '绘制(T)');
    void v;
  }
  /** 路径的称呼：线段、圆等用定义它的点（AB），没有标签时用类型名。 */
  private pathName(v: DocView, o: Obj): string {
    if (o.label) return o.label;
    const ps = parentsOf(o.def).map(id => v.store.get(id)?.label).filter(Boolean);
    return ps.length >= 2 ? `${typeName(o)} ${ps.slice(0, 2).join('')}` : typeName(o);
  }
  async plotOnPath(v: DocView, s: Sel) {
    const st = v.store, path = s.paths[0];
    if (!path && !findSys(st)) {
      const r = await this.ask('这个页面还没有可以绘制点的轴或路径。要建立坐标轴吗？', ['是(Y)', '否(N)']);
      if (r !== '是(Y)') return;
      st.run('定义坐标系', () => createSystem(st));
    }
    const val = this.num('0.5', 70);
    const axisSel = h('select', {}, h('option', { value: 'x' }, '轴 x'), h('option', { value: 'y' }, '轴 y'));
    const bounded = path && path.def.k !== 'plot' && path.def.k !== 'ray' && path.def.k !== 'line' && path.def.k !== 'parallel' && path.def.k !== 'perp' && path.def.k !== 'bisect';
    const body = h('div', {},
      h('div', { class: 'row' }, '在', path ? h('span', { class: 'tgt' }, this.pathName(v, path)) : axisSel, '上绘制点，值为', val),
      bounded && h('div', { class: 'dlg-sub' }, '取值范围 [0.0 .. 1.0]'));
    const r = await this.modal(path ? `在${typeName(path)}上绘制点` : '在轴上绘制点', body, () => this.guard(() => this.parseNum(val.value, '值')), '绘制(T)', { help: '绘制点' });
    if (r === undefined) return;
    let made: Obj | undefined;
    st.run('绘制点', () => {
      const p = st.add({ k: 'param', name: 'v', value: r, unit: 'none', showEdit: false }, { hidden: true });
      if (path) made = st.add({ k: 'pointval', path: path.id, value: p.id });
      else { const sy = findSys(st); if (sy) made = st.add({ k: 'axispt', axis: axisSel.value as 'x' | 'y', value: p.id, sys: sy.id }); }
    });
    if (made) v.setSel([made.id]);
  }
  async addTableData(v: DocView, t: Obj) {
    if (t.def.k !== 'table') return;
    const st = v.store, d = t.def, n = this.num(1, 50);
    const r = await this.modal('添加表中数据', h('div', {}, h('div', { class: 'row' }, '把各列当前的值作为新的一行添加到表格，重复 ', n, ' 次。')), () => this.guard(() => Math.max(1, Math.min(500, Math.round(this.parseNum(n.value, '行数'))))), '添加');
    if (!r) return;
    st.run('添加表中数据', () => {
      const row = d.cols.map(id => { const s = st.results.get(id)?.shape; return s?.k === 'num' ? s.q.v : 0; });
      st.update(t.id, { ...d, rows: [...d.rows, ...Array.from({ length: r }, () => [...row])] });
    });
  }
  async deleteTableData(v: DocView, t: Obj) {
    if (t.def.k !== 'table') return;
    const d = t.def, st = v.store;
    const boxes = d.rows.map((row, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox' }), `第 ${i + 1} 行：${row.map(x => x.toFixed(2)).join('，')}`));
    const r = await this.modal('删除表中数据', h('div', { class: 'list' }, ...boxes), () => ({ ok: boxes.map(b => (b.firstChild as HTMLInputElement).checked) }), '删除');
    if (r) st.run('删除表中数据', () => st.update(t.id, { ...d, rows: d.rows.filter((_, i) => !r[i]) }));
  }

  // ------------- 自定义变换 -------------
  /** 创建自定义变换：只问名称。 */
  customTransformName(): Promise<string | undefined> {
    const name = h('input', { type: 'text', style: 'width:100%' });
    return this.modal('创建自定义变换', h('div', {}, h('div', {}, '自定义变换名称：'), h('div', { class: 'row' }, name)), () => this.guard(() => { const n = name.value.trim(); if (!n) throw new Error('名称不能为空'); return n; }), '确定', { width: 360, help: '自定义变换' });
  }
  /** 创建新工具：名称（不能为空、不能和文档里已有的重名）和注释。 */
  newToolInfo(existing: string[]): Promise<{ name: string; comment: string } | undefined> {
    const name = h('input', { type: 'text', style: 'width:100%' }), note = h('textarea', { rows: 4, style: 'width:100%' });
    return this.modal('创建新工具', h('div', {}, h('div', {}, '工具名称：'), h('div', { class: 'row' }, name), h('div', {}, '注释（作者、用途等，可不填）：'), h('div', { class: 'row' }, note)),
      () => this.guard(() => { const n = name.value.trim(); if (!n) throw new Error('名称不能为空'); if (existing.includes(n)) throw new Error('这个文档里已经有同名的工具'); return { name: n, comment: note.value.trim() }; }), '确定');
  }
  /** 编辑自定义变换：列表里选一个，改名或删除；确定才生效。 */
  async editCustomTransforms(v: DocView) {
    const st = v.store, list0 = (st.page.transforms ?? []).map((t, i) => ({ ...t, from: i }));
    let items = list0.slice(), cur = 0;
    const name = h('input', { type: 'text', style: 'width:100%' }), list = h('select', { size: 10, style: 'width:100%' });
    const del = h('button', { type: 'button' }, '删除(R)');
    const fill = () => { list.replaceChildren(...items.map((t, i) => h('option', { value: String(i), selected: i === cur }, t.name))); name.value = items[cur]?.name ?? ''; name.disabled = del.disabled = !items.length; };
    list.onchange = () => { cur = Number(list.value); name.value = items[cur]?.name ?? ''; };
    name.oninput = () => { if (items[cur]) { items[cur].name = name.value; const op = list.options[cur]; if (op) op.text = name.value; } };
    del.onclick = () => { items.splice(cur, 1); cur = Math.max(0, Math.min(cur, items.length - 1)); fill(); };
    fill();
    const r = await this.modal('编辑自定义变换', h('div', {}, h('div', {}, '名称(A)：'), h('div', { class: 'row' }, name), list, h('div', { class: 'btnrow' }, del)), () => this.guard(() => { if (items.some(t => !t.name.trim())) throw new Error('名称不能为空'); return true; }), '确定', { width: 360, help: '自定义变换' });
    if (!r) return;
    st.run('编辑自定义变换', () => { st.page.transforms = items.map(t => ({ name: t.name.trim(), src: t.src, img: t.img })); if (!st.page.transforms.length) delete st.page.transforms; });
  }

  // ------------- 标签 -------------
  async label(v: DocView, s: Sel) {
    const st = v.store;
    if (s.n === 0) { st.run('重设下一标签', () => { st.page.labelCounter = 0; }); return; }
    const o = s.objs[0];
    const text = h('input', { type: 'text', value: o.label ?? '', style: 'width:180px' });
    const show = h('input', { type: 'checkbox', checked: o.labelShown || o.label === undefined });
    const r = await this.modal('标签', h('div', {}, h('div', { class: 'row' }, h('span', { class: 'lbl' }, '标签'), text), h('label', { class: 'check' }, show, '在画板上显示标签')), () => this.guard(() => {
      const t = text.value.trim(); if (!t) throw new Error('标签不能为空'); return { t, show: show.checked };
    }));
    if (!r) return;
    st.run(`${typeName(o)}的标签`, () => {
      for (const x of s.objs) {
        if (r.t !== x.label && (x.def.k === 'measure' || x.def.k === 'calc')) x.valueDisplay = r.t ? 'label' : 'expression';
        x.label = r.t; x.labelShown = r.show;
        if (x.def.k === 'param') x.def = { ...x.def, name: r.t };
      }
    });
  }

  // ------------- 颜色 -------------
  color(initial: string): Promise<string | undefined> {
    const palette = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00c000', '#008000', '#00ffff', '#0000ff', '#000080', '#8000ff', '#ff00ff', '#800000', '#804000', '#808000', '#004040'];
    let cur = initial;
    const hex = h('input', { type: 'text', value: initial, style: 'width:90px' });
    const picker = h('input', { type: 'color', value: initial });
    const swatches = h('div', { class: 'swatches' }, ...palette.map(c => h('button', { type: 'button', class: 'sw', style: `background:${c}`, title: c, onclick: () => { cur = c; hex.value = c; picker.value = c; } })));
    picker.oninput = () => { cur = picker.value; hex.value = cur; };
    return this.modal('颜色', h('div', {}, swatches, h('div', { class: 'row' }, '自定义：', picker, hex)), () => {
      const t = hex.value.trim() || cur;
      return /^#[0-9a-f]{6}$/i.test(t) ? { ok: t.toLowerCase() } : { error: '颜色格式应是 #rrggbb' };
    });
  }

  async colorParam(v: DocView, hasParam: boolean): Promise<import('../core/model').ColorBy | undefined> {
    void v;
    if (!hasParam) { await this.message('请同时选中要着色的对象和一个参数，再执行“颜色 → 参数…”。'); return undefined; }
    const mode = this.radios<'color' | 'gray'>('cmode', [['color', '颜色'], ['gray', '灰度']]); mode.set('color');
    const from = this.num(0, 60), to = this.num(1, 60);
    const cycle = this.radios<'none' | 'one' | 'two'>('ccycle', [['none', '不要循环'], ['one', '单向循环'], ['two', '双向循环']]); cycle.set('two');
    const body = h('div', {}, h('div', { class: 'group' }, '显示对象：', mode.el), h('div', { class: 'group' }, '参数范围　从 ', from, ' 到 ', to), h('div', { class: 'group' }, '颜色范围：', cycle.el));
    return this.modal('颜色参数', body, () => this.guard(() => {
      const a = this.parseNum(from.value, '起点'), b = this.parseNum(to.value, '终点');
      if (a === b) throw new Error('起点和终点不能相同');
      return { param: 0, from: a, to: b, mode: mode.value, cycle: cycle.value };
    }));
  }

  // ------------- 按钮 -------------
  private speedPick(def: 'slow' | 'medium' | 'fast' = 'medium') {
    const r = this.radios<'slow' | 'medium' | 'fast'>('speed', [['slow', '慢速'], ['medium', '中速'], ['fast', '快速']]); r.set(def); return r;
  }
  async animateButton(v: DocView, s: Sel) {
    const targets = s.geo.length ? s.geo : s.objs;
    const speed = this.speedPick();
    const dir = this.radios<'forward' | 'backward' | 'bounce' | 'random'>('dir', [['forward', '向前'], ['backward', '向后'], ['bounce', '往返'], ['random', '随机']]); dir.set('bounce');
    const r = await this.modal('动画按钮', h('div', {}, h('div', { class: 'group' }, '方向：', dir.el), h('div', { class: 'group' }, '速度：', speed.el)), () => ({ ok: { speed: speed.value, direction: dir.value } }), '确定');
    if (r) this.app.makeButton(v, { type: 'animate', targets: targets.map(o => o.id), speed: r.speed, direction: r.direction });
  }
  async moveButton(v: DocView, s: Sel) {
    const where = this.radios<'final' | 'initial'>('mvw', [['final', '移动到目标最终位置'], ['initial', '移动到目标初始位置']]); where.set('final');
    const speed = this.radios<'slow' | 'medium' | 'fast' | 'high'>('mvs', [['slow', '慢速'], ['medium', '中速'], ['fast', '快速'], ['high', '高速']]); speed.set('medium');
    const r = await this.modal('移动按钮', h('div', {}, h('div', { class: 'row' }, `把 ${s.pts[0].label ?? '点1'} 移向 ${s.pts[1].label ?? '点2'}`), h('div', { class: 'group' }, '速度：', speed.el), h('div', { class: 'group' }, where.el)), () => ({ ok: { where: where.value, speed: speed.value } }), '确定');
    if (r) this.app.makeButton(v, { type: 'move', from: s.pts[0].id, to: s.pts[1].id, speed: r.speed, ...(r.where === 'initial' ? { toInitial: true } : {}) });
  }
  async seriesButton(v: DocView, s: Sel) {
    const mode = this.radios<'together' | 'seq'>('sm', [['together', '同时执行'], ['seq', '依序执行']]); mode.set('together');
    const chk = (t: string) => { const i = h('input', { type: 'checkbox' }) as HTMLInputElement; return { i, el: h('label', { class: 'row' }, i, t) }; };
    const dsel = chk('取消所有选定'), dani = chk('停止所有动画'), dtr = chk('清除所有追踪踪迹');
    const after = this.radios<'last' | 'first' | 'duration'>('sa', [['last', '末动作停止'], ['first', '首动作停止'], ['duration', '持续时间']]); after.set('last');
    const secs = h('input', { type: 'number', value: '3', min: '0', step: '0.1', style: 'width:70px' }) as HTMLInputElement;
    const pause = chk('动作之间暂停（秒，数值同上）');
    const r = await this.modal('系列按钮', h('div', {}, h('div', { class: 'group' }, '系列动作：', mode.el), h('div', { class: 'group' }, '开始前执行：', dsel.el, dani.el, dtr.el), h('div', { class: 'group' }, '执行后停止：', after.el, secs), pause.el), () => ({ ok: { mode: mode.value, after: after.value, secs: Math.max(0, Number(secs.value) || 0), pause: pause.i.checked, d: [dsel.i.checked, dani.i.checked, dtr.i.checked] } }), '确定');
    if (!r) return;
    const seconds = r.mode === 'seq' ? (r.pause ? r.secs : 0) : r.after === 'duration' ? r.secs : undefined;
    this.app.makeButton(v, { type: 'series', buttons: s.objs.map(o => o.id), mode: r.mode, ...(r.d[0] ? { deselect: true } : {}), ...(r.d[1] ? { stopAnim: true } : {}), ...(r.d[2] ? { clearTraces: true } : {}), ...(r.after !== 'last' ? { after: r.after } : {}), ...(seconds ? { seconds } : {}) });
  }
  async linkButton(v: DocView) {
    const n = v.store.doc.pages.length;
    const kind = this.radios<'page' | 'url'>('lk', [['page', '页面', n < 2], ['url', '超级链接']]);
    kind.set(n < 2 ? 'url' : 'page');
    const sel = h('select', {}, ...v.store.doc.pages.map((p, i) => h('option', { value: String(i + 1) }, `第 ${i + 1} 页（${p.name}）`)));
    const url = h('input', { type: 'text', value: 'https://', style: 'width:260px' });
    const r = await this.modal('链接按钮', h('div', {}, h('div', { class: 'group' }, '链接到：', kind.el), h('div', { class: 'row' }, '页面：', sel), h('div', { class: 'row' }, '网址：', url)), () => this.guard(() => {
      if (kind.value === 'page') return { page: Number(sel.value) } as { page: number; url?: string };
      const u = url.value.trim();
      if (!isExternalActionUrl(u)) throw new Error('请输入 http://、https:// 网址，或 mailto: 电子邮件地址。');
      return { page: 0, url: u };
    }), '确定');
    if (r) this.app.makeButton(v, r.url ? { type: 'link', page: 0, url: r.url } : { type: 'link', page: r.page }, r.url ?? undefined);
  }
  async scrollButton(v: DocView, s: Sel) {
    const where = this.radios<'topleft' | 'center'>('where', [['topleft', '把点滚动到左上角'], ['center', '把点滚动到窗口中央']]); where.set('topleft');
    const r = await this.modal('滚动按钮', h('div', { class: 'group' }, where.el), () => ({ ok: where.value }), '确定');
    if (r) this.app.makeButton(v, { type: 'scroll', point: s.pts[0].id, where: r });
  }

  // ------------- 属性 -------------
  async properties(v: DocView, o: Obj) {
    const st = v.store;
    const tabs = h('div', { class: 'tabs' });
    const panes: HTMLElement[] = [];
    const addTab = (name: string, pane: HTMLElement) => { const b = h('button', { type: 'button', class: panes.length ? '' : 'on' }, name); b.onclick = () => { panes.forEach((p, i) => { p.hidden = p !== pane; (tabs.children[i] as HTMLElement).classList.toggle('on', p === pane); }); }; tabs.append(b); pane.hidden = panes.length > 0; panes.push(pane); };
    const d = o.def;
    const label = h('input', { type: 'text', value: o.label ?? '', style: 'width:100%' });
    const showLabel = h('input', { type: 'checkbox', checked: o.labelShown });
    const hidden = h('input', { type: 'checkbox', checked: o.hidden });
    const selectable = h('input', { type: 'checkbox', checked: !o.unselectable });
    // 对象页：说明 + 父对象、子对象入口 + 隐藏、可以被选中
    const lines = this.app.describe(v, o.id).split('\n');
    const nameTitle = o.label ? `${typeName(o)} ${o.label}` : `${typeName(o)} #${this.app.ordinalOf(v, o)}`;
    const desc = h('div', { class: 'objdesc' }, lines.length > 1 ? `${nameTitle}：${lines.slice(1).join('；')}` : `${nameTitle} 是一个独立的对象。`);
    const parents = parentsOf(d).map(id => st.get(id)).filter((x): x is Obj => !!x), children = childrenOf(st.page, o.id);
    const relBtn = (none: string, some: string, list: Obj[]) => {
      const b = h('button', { type: 'button', disabled: !list.length }, list.length ? `${some} ▾` : none);
      b.onclick = () => this.popup(b, list.map(x => ({ label: x.label ?? `${typeName(x)} #${this.app.ordinalOf(v, x)}`, run: () => { (b.closest('.dlg')!.querySelector('.dlg-cancel') as HTMLElement).click(); v.setSel([x.id]); } })));
      return b;
    };
    addTab('对象', h('div', {}, desc, h('div', { class: 'objbtns' }, relBtn('无父对象', '父对象', parents), relBtn('无子对象', '子对象', children)), h('div', { class: 'objchecks' }, h('label', {}, hidden, '隐藏(H)'), h('label', {}, selectable, '可以被选中(A)'))));
    const toolLabel = h('input', { type: 'checkbox', checked: !!o.toolLabel, title: '创建工具时保留此标签' });
    addTab('标签', h('div', {}, h('div', { class: 'group' }, '标签(L)', label), h('label', { class: 'check' }, showLabel, '显示标签(S)'), h('label', { class: 'check' }, toolLabel, '在自定义工具中使用标签')));
    if (d.k === 'measure' || d.k === 'calc' || d.k === 'param') addTab('数值', h('div', { class: 'dlg-text' }, `当前值：${(() => { const s = st.results.get(o.id)?.shape; return s?.k === 'num' ? formatQ(s.q) : s?.k === 'coords' ? `(${s.x.toFixed(2)}, ${s.y.toFixed(2)})` : s?.k === 'text' ? s.text : '无定义'; })()}`));
    let animSpeed: HTMLSelectElement | undefined, animDir: HTMLSelectElement | undefined;
    if (d.k === 'onpath' || d.k === 'param') {
      animSpeed = h('select', {}, h('option', { value: 'slow' }, '慢速'), h('option', { value: 'medium' }, '中速'), h('option', { value: 'fast' }, '快速'));
      animDir = h('select', {}, h('option', { value: 'forward' }, '向前'), h('option', { value: 'backward' }, '向后'), h('option', { value: 'bounce' }, '往返'), h('option', { value: 'random' }, '随机'));
      animSpeed.value = String(o.anim?.speed ?? 'medium'); animDir.value = o.anim?.direction ?? 'forward';
      addTab('动画', h('div', {}, h('div', { class: 'row' }, '速度：', animSpeed), h('div', { class: 'row' }, '方向：', animDir)));
    }
    let valInput: HTMLInputElement | undefined, nameInput: HTMLInputElement | undefined, unitPick: { el: HTMLElement; value: UnitKind; set(v: UnitKind): void } | undefined;
    if (d.k === 'param') {
      nameInput = h('input', { type: 'text', value: d.name, style: 'width:80px' }); valInput = this.num(d.value);
      unitPick = this.radios<UnitKind>('pu', [['none', '无'], ['angle', '角度'], ['distance', '距离']]); unitPick.set(d.unit);
      addTab('参数', h('div', {}, h('div', { class: 'row' }, '名称：', nameInput, ' = ', valInput), h('div', { class: 'group' }, '单位：', unitPick.el)));
    }
    // 绘图页：轨迹、函数图像、参数曲线的采样数量；取样变换的图片另有允许失真度（原版属性“绘图”页）
    let samplesInput: HTMLInputElement | undefined, distortion: HTMLInputElement | undefined;
    if (d.k === 'locus' || d.k === 'plot' || d.k === 'pcurve' || d.k === 'custom-image') {
      samplesInput = h('input', { type: 'number', value: String(d.samples), min: '1', step: '1', style: 'width:90px' });
      const rows: HTMLElement[] = [h('div', { class: 'row' }, '采样数量(N)：', samplesInput)];
      if (d.k === 'custom-image') {
        distortion = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(Math.max(0, Math.min(1, d.distortion))), style: 'width:180px' });
        rows.push(h('div', { class: 'row' }, '允许失真度(D)：', h('span', {}, '无 '), distortion, h('span', {}, ' 全部')));
      }
      addTab('绘图', h('div', {}, ...rows));
    }
    const body = h('div', { class: 'props' }, tabs, ...panes);
    const r = await this.modal(nameTitle, body, () => this.guard(() => {
      if (samplesInput) { const n = this.parseNum(samplesInput.value, '采样数量'); if (!(n >= 1 && Number.isInteger(n))) throw new Error('采样数量应为正整数'); }
      if (valInput) this.parseNum(valInput.value, '数值');
      if (nameInput && !nameInput.value.trim()) throw new Error('名称不能为空');
      return true;
    }), '确定', { width: 440, help: '属性' });
    if (!r) return;
    st.run('属性', () => {
      o = st.get(o.id) ?? o;
      o.hidden = hidden.checked;
      if (selectable.checked) delete o.unselectable; else o.unselectable = true;
      const t = label.value.trim();
      if (t && t !== o.label && (d.k === 'measure' || d.k === 'calc')) o.valueDisplay = 'label';
      if (t) { o.label = t; o.labelShown = showLabel.checked; } else o.labelShown = false;
      if (toolLabel.checked) o.toolLabel = true; else delete o.toolLabel;
      if (animSpeed && animDir) o.anim = { speed: animSpeed.value as 'slow', direction: animDir.value as 'forward' };
      if (samplesInput && (d.k === 'locus' || d.k === 'plot' || d.k === 'pcurve' || d.k === 'custom-image')) {
        const samples = Math.round(this.parseNum(samplesInput.value, '采样数量'));
        st.update(o.id, d.k === 'custom-image' ? { ...d, samples, distortion: Number(distortion?.value ?? d.distortion) } : { ...d, samples });
      }
      if (d.k === 'param' && valInput && nameInput && unitPick) { st.update(o.id, { ...d, name: nameInput.value.trim(), value: this.parseNum(valInput.value, '数值'), unit: unitPick.value }); o.label = nameInput.value.trim(); }
    });
    if (o.unselectable) v.setSel(v.sel.filter(i => i !== o.id));
  }

  // ------------- 参数选项 / 文档选项 / 页面设置 -------------
  async preferences() {
    const s = this.app.settings, v = this.app.active, cur: DisplayPrefs = pageDisplay(v.store.doc, v.store.page, v.fallbackDisplay);
    const tabs = h('div', { class: 'tabs' }), panes: HTMLElement[] = [];
    const add = (n: string, p: HTMLElement) => { const b = h('button', { type: 'button', class: panes.length ? '' : 'on' }, n); b.onclick = () => panes.forEach((x, i) => { x.hidden = x !== p; (tabs.children[i] as HTMLElement).classList.toggle('on', x === p); }); tabs.append(b); p.hidden = panes.length > 0; panes.push(p); };
    const sel = <T extends string>(items: [T, string][], val: T, cls = '') => { const e = h('select', { class: cls }, ...items.map(([a, b]) => h('option', { value: a }, b))); e.value = val; return e; };
    const chk = (on: boolean) => h('input', { type: 'checkbox', checked: on });
    // 单位、颜色、文本三页各有一组“应用于”，它们是同一个设置，改一组其它组跟着变
    let scopeNew = false;
    const scopeInputs: { c: HTMLInputElement; n: HTMLInputElement }[] = [];
    const syncScope = () => { for (const x of scopeInputs) { x.c.checked = !scopeNew; x.n.checked = scopeNew; } };
    const scope = () => {
      const name = `prefscope${scopeInputs.length}`, c = h('input', { type: 'radio', name, value: 'current', checked: true }), n = h('input', { type: 'radio', name, value: 'new' });
      c.onchange = () => { scopeNew = false; syncScope(); }; n.onchange = () => { scopeNew = true; syncScope(); };
      scopeInputs.push({ c, n });
      return h('div', { class: 'scope' }, '应用于：', h('label', {}, c, '当前画板'), h('label', {}, n, '所有新建画板'));
    };
    // 单位
    const PREC: [string, string][] = [['0', '单位'], ['1', '十分之一'], ['2', '百分之一'], ['3', '千分之一'], ['4', '万分之一'], ['5', '十万分之一']];
    const angU = sel<DisplayPrefs['angleUnit']>([['deg', '度'], ['rad', '弧度'], ['dir', '方向度']], cur.angleUnit), angP = sel(PREC, String(cur.anglePrec));
    const disU = sel<DisplayPrefs['distUnit']>([['cm', '厘米'], ['in', '英寸'], ['px', '像素']], cur.distUnit), disP = sel(PREC, String(cur.distPrec));
    const othP = sel(PREC, String(cur.otherPrec));
    add('单位', h('div', {}, h('div', { class: 'group pref-grid' }, h('span', {}), h('span', { class: 'head' }, '单位'), h('span', { class: 'head' }, '精确度'), '角度：', angU, angP, '距离：', disU, disP, '其它：', h('span', {}, '无'), othP), scope()));
    // 颜色
    const c = s.colors, colorIn = (val: string) => h('input', { type: 'color', value: val });
    const cPoint = colorIn(c.point), cLine = colorIn(c.line), cCircle = colorIn(c.circle), cPlot = colorIn(c.plot), cLocus = colorIn(c.locus), cInt = colorIn(c.interior), cBack = colorIn(cur.background), cSel = colorIn(cur.selected);
    const autoUp = chk(c.autoUpdate), rnd = chk(c.randomInterior), fade = chk(c.fade);
    const fadeT = h('input', { type: 'range', min: '1', max: '30', step: '1', value: String(c.fadeTime), style: 'width:160px' });
    add('颜色', h('div', {}, h('div', { class: 'group' }, h('label', { class: 'check' }, autoUp, '使用新颜色时自动更新'),
      h('div', { class: 'pref-colors' }, '点：', cPoint, '绘图：', cPlot, '背景：', cBack, '线：', cLine, '轨迹：', cLocus, '选定对象：', cSel, '圆：', cCircle, '内部：', cInt),
      h('label', { class: 'check' }, rnd, '新对象内部使用随机颜色')),
      h('div', { class: 'group' }, h('label', { class: 'row' }, fade, '淡入淡出效果时间：', '快速', fadeT, '慢速')), scope()));
    // 文本
    const autoLabel = chk(s.autoLabel), autoMeasured = chk(s.autoLabelMeasured), bar = chk(s.textbarOnEdit), ital = chk(cur.mathItalic), pEdit = chk(s.paramEdit), fSym = chk(s.funcSymbol);
    const styleUpd = h('input', { type: 'checkbox', checked: true, disabled: true, title: '本版总是自动更新' }), styleBtn = h('button', { type: 'button' }, '改变对象属性...');
    styleBtn.onclick = () => void this.textStyles(v);
    add('文本', h('div', {}, h('div', { class: 'group' }, '自动显示标签', h('label', { class: 'check' }, autoLabel, '应用于所有新建点'), h('label', { class: 'check' }, autoMeasured, '应用于度量过的对象')),
      h('div', { class: 'group' }, '新对象标签式样', h('div', { class: 'row' }, h('label', {}, styleUpd, '改变现有对象时自动更新'), styleBtn)),
      h('div', { class: 'group' }, h('label', { class: 'check' }, bar, '编辑文本时显示文本工具栏'), h('label', { class: 'check' }, ital, '所有数学标签用斜体'), h('label', { class: 'check' }, pEdit, '新建参数显示编辑框'), h('label', { class: 'check' }, fSym, '新函数用符号“y=”')), scope()));
    // 工具
    const dbl = chk(s.doubleClickDeselect), power = sel<'low' | 'mid' | 'high'>([['low', '低的'], ['mid', '中的'], ['high', '高的']], s.power, 'power');
    const borders = chk(s.polygonBorders), opacity = this.num(s.polyOpacity, 56);
    const pen = sel([['#ff0000', '红色'], ['#000000', '黑色'], ['#0000ff', '蓝色'], ['#008000', '绿色']], s.marker.color);
    const thin = h('input', { type: 'radio', name: 'penw', checked: !s.marker.thick }), thick = h('input', { type: 'radio', name: 'penw', checked: s.marker.thick });
    const info = this.radios<'parents' | 'children' | 'both'>('infod', [['parents', '父对象'], ['children', '子对象'], ['both', '两者']]); info.set(s.infoDescribe);
    add('工具', h('div', {}, h('div', { class: 'group' }, '箭头工具', h('label', { class: 'check' }, dbl, '双击取消选定'), h('div', { class: 'row' }, '选择能力：', power)),
      h('div', { class: 'group' }, '多边形工具', h('label', { class: 'check' }, borders, '显示新建多边形边界'), h('div', { class: 'row' }, '新建多边形透明度：', opacity, ' %')),
      h('div', { class: 'group' }, '标记工具', h('div', { class: 'row' }, '笔迹：', pen), h('div', { class: 'row' }, '宽度：', h('label', {}, thin, '细'), h('label', {}, thick, '粗'))),
      h('div', { class: 'group' }, '信息工具：新的信息描述对象', info.el)));
    const body = h('div', { class: 'props' }, tabs, ...panes);
    const r = await this.modal('参数选项', body, () => this.guard(() => { const n = this.parseNum(opacity.value, '透明度'); if (n < 0 || n > 100) throw new Error('透明度要在 0 到 100 之间'); return { opacity: n }; }), '确定', { width: 480 });
    if (!r) return;
    const textStyles = v.store.page.display?.textStyles ?? v.store.doc.settings.display?.textStyles ?? cur.textStyles;
    const next: DisplayPrefs = { ...cur, ...(textStyles ? { textStyles } : {}), angleUnit: angU.value as DisplayPrefs['angleUnit'], anglePrec: Number(angP.value), distUnit: disU.value as DisplayPrefs['distUnit'], distPrec: Number(disP.value), otherPrec: Number(othP.value), background: cBack.value, selected: cSel.value, mathItalic: ital.checked };
    delete next.fromFile;
    if (scopeNew) s.display = { ...next };
    else if (JSON.stringify({ ...cur, fromFile: undefined }) !== JSON.stringify(next)) {
      v.store.run('参数选项', () => {
        const page = v.store.page, original = v.store.doc.settings.display;
        if (page.display) {
          v.store.doc.settings.display = { ...next, angleUnit: original?.angleUnit ?? next.angleUnit, anglePrec: original?.anglePrec ?? next.anglePrec,
            distPrec: original?.distPrec ?? next.distPrec, otherPrec: original?.otherPrec ?? next.otherPrec,
            mathItalic: original?.mathItalic ?? next.mathItalic, textStyles: original?.textStyles,
            ...(original?.fromFile ? { fromFile: true } : {}) };
          page.display = { ...page.display, angleUnit: next.angleUnit, anglePrec: next.anglePrec, distPrec: next.distPrec, otherPrec: next.otherPrec,
            mathItalic: next.mathItalic, textStyles: next.textStyles ?? {} };
        } else v.store.doc.settings.display = next;
      });
    }
    // 使用新颜色时自动更新：现有对象里还是旧默认颜色的，跟着换
    const old = { ...c }, nc = { ...c, point: cPoint.value, line: cLine.value, circle: cCircle.value, plot: cPlot.value, locus: cLocus.value, interior: cInt.value, randomInterior: rnd.checked, autoUpdate: autoUp.checked, fade: fade.checked, fadeTime: Number(fadeT.value) };
    if (autoUp.checked) {
      const pairs: [string, string, string][] = [['point', old.point, nc.point], ['straight', old.line, nc.line], ['circle', old.circle, nc.circle], ['arc', old.circle, nc.circle], ['plot', old.plot, nc.plot], ['locus', old.locus, nc.locus], ['interior', old.interior, nc.interior]];
      const changes = v.store.page.objects.flatMap(o => { const m = pairs.find(([cls, a, b]) => a !== b && classOf(o) === cls && o.style.color === a); return m ? [[o.id, m[2]] as const] : []; });
      if (changes.length) v.store.run('参数选项', () => { for (const [id, col] of changes) v.store.setStyle([id], { color: col }); });
    }
    Object.assign(s, { colors: nc, power: power.value, polygonBorders: borders.checked, doubleClickDeselect: dbl.checked, autoLabel: autoLabel.checked, autoLabelMeasured: autoMeasured.checked, textbarOnEdit: bar.checked, paramEdit: pEdit.checked, funcSymbol: fSym.checked, polyOpacity: r.opacity, marker: { color: pen.value, thick: thick.checked }, infoDescribe: info.value });
    v.store.doc.settings.autoLabelPoints = autoLabel.checked;
    this.app.applyNewObjectDefaults();
    this.app.saveSettings();
    this.app.refresh();
  }
  /** 文本样式：左边选类别，右边改字体、大小、粗斜下划线、颜色；“应用于”决定写到当前画板还是以后新建的画板。 */
  async textStyles(v: DocView) {
    const s = this.app.settings, cur: DisplayPrefs = pageDisplay(v.store.doc, v.store.page, v.fallbackDisplay);
    const work = Object.fromEntries(TEXT_CATS.map(([c]) => [c, { ...TEXT_DEFAULTS[c].style, ...cur.textStyles?.[c] }])) as Record<TextCat, TextStyle>;
    let cat: TextCat = 'label';
    const list = h('select', { size: 6, style: 'width:190px' }, ...TEXT_CATS.map(([c, n]) => h('option', { value: c }, n)));
    const FONTS = ['Times New Roman', 'Arial', 'Tahoma', 'Courier New', 'Verdana', 'Calibri', 'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi'];
    const name = h('select', { style: 'width:200px' }, ...FONTS.map(f => h('option', { value: f }, f)));
    const size = h('select', { style: 'width:70px' }, ...[8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map(n => h('option', { value: String(n) }, String(n))));
    const bold = h('input', { type: 'checkbox' }), ital = h('input', { type: 'checkbox' }), und = h('input', { type: 'checkbox' }), col = h('input', { type: 'color' });
    const sample = h('div', { class: 'ts-sample' }, '示例');
    const scope = h('input', { type: 'checkbox', checked: true }), scopeNew = h('input', { type: 'checkbox' });
    const show = () => {
      const t = work[cat]; list.value = cat;
      if (![...name.options].some(o => o.value === t.name)) name.append(h('option', { value: t.name }, t.name)); name.value = t.name;
      if (![...size.options].some(o => o.value === String(t.size))) size.append(h('option', { value: String(t.size) }, String(t.size))); size.value = String(t.size);
      bold.checked = t.bold; ital.checked = t.italic; und.checked = t.underline; col.value = t.color;
      Object.assign(sample.style, { fontFamily: `'${t.name}'`, fontSize: `${Math.min(40, t.size)}px`, fontWeight: t.bold ? 'bold' : 'normal', fontStyle: t.italic ? 'italic' : 'normal', textDecoration: t.underline ? 'underline' : 'none', color: t.color });
    };
    const read = () => { Object.assign(work[cat], { name: name.value, size: Number(size.value), bold: bold.checked, italic: ital.checked, underline: und.checked, color: col.value }); show(); };
    list.onchange = () => { cat = list.value as TextCat; show(); };
    for (const e of [name, size, bold, ital, und, col]) e.addEventListener('change', read);
    col.addEventListener('input', read);
    scope.onchange = () => { if (!scope.checked && !scopeNew.checked) scopeNew.checked = true; };
    scopeNew.onchange = () => { if (!scope.checked && !scopeNew.checked) scope.checked = true; };
    show();
    const body = h('div', { class: 'ts' }, h('div', {}, h('div', {}, '字型：'), list), h('div', {}, h('div', { class: 'row' }, name, size), h('div', { class: 'row' }, h('label', {}, bold, '粗体(B)'), h('label', {}, ital, '斜体(I)'), h('label', {}, und, '下划线(U)'), '颜色：', col), sample, h('div', { class: 'scope' }, '应用于：', h('label', {}, scope, '当前画板'), h('label', {}, scopeNew, '所有新建画板'))));
    const r = await this.modal('文本样式', body, () => ({ ok: true }), '确定', { width: 560, help: '文本样式' });
    if (!r) return;
    // 只保存和出厂样式不同的项
    const diff: NonNullable<DisplayPrefs['textStyles']> = {};
    for (const [c] of TEXT_CATS) { const d = TEXT_DEFAULTS[c].style, w = work[c], o: Partial<TextStyle> = {}; for (const k of Object.keys(d) as (keyof TextStyle)[]) if (w[k] !== d[k]) (o as Record<string, unknown>)[k] = w[k]; if (Object.keys(o).length) diff[c] = o; }
    const next = { ...cur, textStyles: diff };
    delete next.fromFile; if (scope.checked) v.store.run('文本样式', () => {
      if (v.store.page.display) v.store.page.display = { ...v.store.page.display, textStyles: diff };
      else v.store.doc.settings.display = next;
    });
    if (scopeNew.checked) { s.display = { ...s.display, textStyles: diff }; this.app.saveSettings(); }
    this.app.refresh();
  }
  async docOptions(v: DocView, start: 'pages' | 'tools' = 'pages') {
    const st = v.store;
    // 对话框里的改动放在一个事务里：确定才算数，取消全部撤回
    st.begin('文档选项');
    const doc = () => st.doc;
    const list = h('select', { size: 8 }), name = h('input', { type: 'text', style: 'width:100%' });
    const cur = () => Number(list.value || doc().current);
    const tabsChk = h('input', { type: 'checkbox', checked: doc().settings.showPageTabs !== false });
    const del = h('button', { type: 'button' }, '删除页(R)');
    const fill = () => {
      list.replaceChildren(...doc().pages.map((p, i) => h('option', { value: String(i), selected: i === doc().current }, `${i + 1}：${p.name}`)));
      name.value = doc().pages[doc().current].name;
      del.disabled = doc().pages.length <= 1;
      tabsChk.disabled = doc().pages.length <= 1;
    };
    const after = () => { v.sel = []; fill(); this.app.refresh(); };
    const addBtn = h('button', { type: 'button' }, '增加页(A) ▾');
    addBtn.onclick = () => this.popup(addBtn, [{ label: '空白页面', run: () => { st.addPage(false); after(); } }, { label: '复制：', disabled: true }, ...doc().pages.map((p, i) => ({ label: `　${i + 1}：${p.name}`, run: () => { st.addPage(true, i); after(); } }))]);
    del.onclick = () => { if (doc().pages.length > 1) { st.removePage(cur()); after(); } };
    list.onchange = () => { st.switchPage(cur()); name.value = doc().pages[doc().current].name; v.sel = []; this.app.refresh(); };
    name.oninput = () => { const i = doc().current; doc().pages[i].name = name.value.trim() || String(i + 1); const op = list.options[i]; if (op) op.text = `${i + 1}：${doc().pages[i].name}`; this.app.refreshPageBar(); };
    tabsChk.onchange = () => { doc().settings.showPageTabs = tabsChk.checked; this.app.refreshPageBar(); this.app.docs.forEach(d => d.resize()); };
    const pagesPane = h('div', { class: 'docopt-pane' }, h('div', { class: 'docopt' }, h('div', {}, h('div', {}, '页名称(P)：'), name, list), h('div', { class: 'side' }, addBtn, del, h('label', {}, tabsChk, '显示页切换(T)'))));
    const copyT = h('button', { type: 'button' }, '复制工具(C) ▾'), delT = h('button', { type: 'button' }, '删除工具(D)'), script = h('label', {}, h('input', { type: 'checkbox', disabled: true, title: '本版暂缓：脚本视图' }), '显示脚本视图');
    const toolList = h('select', { size: 8, style: 'width:100%' });
    const fillTools = () => {
      const ts = doc().tools ?? [];
      toolList.replaceChildren(...ts.map((t, i) => h('option', { value: String(i), title: t.comment ?? '' }, t.name)));
      delT.disabled = !ts.length; copyT.disabled = !this.app.toolGroups.length;
      copyT.title = this.app.toolGroups.length ? '从已载入的工具文件夹复制工具到这个文档' : '先在自定义工具菜单里选择工具文件夹';
    };
    delT.onclick = () => {
      const i = toolList.selectedIndex, ts = doc().tools; if (!ts || i < 0) return;
      ts.splice(i, 1); if (!ts.length) delete doc().tools;
      if (this.app.customTool && !this.app.docTools().some(t => t.name === this.app.customTool!.name) && !this.app.customTool.group) this.app.customTool = undefined;
      fillTools();
    };
    copyT.onclick = () => this.popup(copyT, this.app.toolGroups.map(g => ({ label: g.name, run: () => this.popup(copyT, g.tools.map(r => ({ label: r.name, run: () => {
      if ((doc().tools ?? []).some(t => t.name === r.name)) { void this.message('这个文档里已经有同名的工具。'); return; }
      (doc().tools ??= []).push(JSON.parse(JSON.stringify(r.embedded))); fillTools();
    } }))) })));
    const toolsPane = h('div', { class: 'docopt-pane' }, h('div', { class: 'docopt' }, h('div', {}, h('div', {}, '工具：'), toolList), h('div', { class: 'side' }, copyT, delT, script)));
    fillTools();
    const view = this.radios<'pages' | 'tools'>('dview', [['pages', '页面'], ['tools', '工具']], x => { pagesPane.hidden = x !== 'pages'; toolsPane.hidden = x !== 'tools'; });
    view.set(start);
    fill();
    const r = await this.modal('文档选项', h('div', {}, h('div', { class: 'row' }, '视图类型(V)：', view.el), pagesPane, toolsPane), () => ({ ok: true }), '确定', { width: 420 });
    if (r) st.commit(); else { st.cancel(); v.sel = v.sel.filter(i => st.get(i)); }
    this.app.refresh();
    v.resize();
  }
  async pageSetup(v: DocView) {
    const p = v.store.doc.paper;
    const size = h('select', {}, ...PAPERS.map(x => h('option', { value: x }, x))); size.value = p.size ?? 'A4';
    const o = this.radios<'p' | 'l'>('orient', [['p', '纵向'], ['l', '横向']]); o.set(p.landscape ? 'l' : 'p');
    const m = this.num(p.marginMm, 50);
    const r = await this.modal('页面设置', h('div', {}, h('div', { class: 'row' }, '纸张大小：', size), h('div', { class: 'group' }, '方向：', o.el), h('div', { class: 'row' }, '页边距：', m, ' 毫米'), h('div', { class: 'dlg-sub' }, '选择打印机在打印时的系统对话框里进行。')), () => this.guard(() => ({ size: size.value, landscape: o.value === 'l', marginMm: Math.max(0, Math.min(50, this.parseNum(m.value, '页边距'))) })));
    if (r) v.store.run('页面设置', () => { v.store.doc.paper = r; });
  }

  about(): Promise<void> {
    return this.modal('关于新版', h('div', { class: 'dlg-text' }, '新版 0.1.0', h('br'), '一个独立实现的动态几何软件，支持读写原版课件的常用内容。', h('br'), '本软件与原版程序无隶属关系。'), () => ({ ok: true }), '确定', { noCancel: true, noHelp: true }).then(() => undefined);
  }
  help(topic?: string): Promise<void> {
    const t = topic && HELP[topic];
    if (t) return this.modal(`帮助：${topic}`, h('div', { class: 'dlg-text' }, t), () => ({ ok: true }), '确定', { noCancel: true, noHelp: true, width: 360 }).then(() => undefined);
    return this.modal('使用说明', h('div', { class: 'dlg-text' }, '菜单、快捷键和鼠标操作沿用原版习惯：', h('br'), '· 工具箱：移动箭头、点、圆、直尺、多边形、文本、标记、信息。', h('br'), '· 单击对象加选；单击空白处清除选择；拖动空白处框选。', h('br'), '· 选中对象后在“构造”“变换”“度量”菜单中操作。', h('br'), '· Ctrl+Z 撤消，Ctrl+R 重做，Ctrl+S 保存。'), () => ({ ok: true }), '确定', { noCancel: true, noHelp: true, width: 420 }).then(() => undefined);
  }
}

export { fmtNum };
