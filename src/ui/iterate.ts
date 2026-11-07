/** 迭代面板：不挡住画板，在画板里单击对象来给每个原象指定初象；“显示”“结构”两个弹出菜单。 */
import type { App } from '../app';
import { classOf } from '../core/construct';
import { constructIteration, isNumericObj, iterationTargets, tableColumns } from '../core/iterate';
import type { Id, Obj } from '../core/model';
import { hitAll } from '../core/hit';
import { h } from './dialogs';
import type { DocView } from './docview';
import { typeName } from './render';

interface MenuItem { label: string; run?: () => void; checked?: boolean; disabled?: boolean; sep?: boolean; title?: string }

export class IterPanel {
  private pre: Obj[];
  private maps: (Id | undefined)[][];
  private cur = 0;
  private depth = 3;
  private finalOnly = false;
  private nonPoint: boolean;
  private nonPointTouched = false;
  /** 生成迭代数据表：有数值原象时默认勾选（原版采集：结构菜单里该项默认带勾）。 */
  private table = true;
  private readonly box: HTMLElement;
  private readonly rows = h('div', { class: 'iter-rows' });
  private readonly depthText = h('div', { class: 'iter-depth' });
  private readonly mapBar = h('div', { class: 'iter-mapbar' });
  private readonly go = h('button', { class: 'primary' }, '迭代') as HTMLButtonElement;
  private popup?: HTMLElement;
  private done?: () => void;

  constructor(private app: App, private view: DocView, pre: Obj[], private depthParam?: Obj) {
    this.pre = pre;
    this.maps = [pre.map(() => undefined)];
    this.nonPoint = false;
    const showBtn = h('button', { class: 'iter-pop', onclick: (e: Event) => this.openMenu(e.currentTarget as HTMLElement, this.displayMenu()) }, '显示(D) ▾');
    const structBtn = h('button', { class: 'iter-pop', onclick: (e: Event) => this.openMenu(e.currentTarget as HTMLElement, this.structureMenu()) }, '结构(S) ▾');
    const cancel = h('button', { onclick: () => this.close() }, '取消');
    this.go.onclick = () => this.iterate();
    this.box = h('div', { class: 'iterpanel', role: 'dialog' },
      h('div', { class: 'dlg-title' }, depthParam ? '深度迭代' : '迭代'),
      h('div', { class: 'dlg-body' },
        h('div', { class: 'iter-head' }, h('span', {}, '原象'), h('span', {}, '到'), h('span', {}, '初象')),
        this.mapBar, this.rows,
        h('div', { class: 'iter-hint' }, '在画板里单击对象，依次给每个原象指定初象。'),
        this.depthText,
        h('div', { class: 'row' }, showBtn, structBtn)),
      h('div', { class: 'dlg-btns' }, cancel, this.go));
  }

  /** 打开面板；面板关闭（迭代或取消）时 resolve。 */
  open(): Promise<void> {
    return new Promise(resolve => {
      this.done = resolve;
      this.view.pickHook = p => this.pick(p);
      document.addEventListener('keydown', this.onKey, true);
      document.addEventListener('pointerdown', this.onOutside, true);
      document.body.append(this.box);
      this.refresh();
    });
  }

  private close() {
    this.closePopup();
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.view.pickHook = undefined;
    this.box.remove();
    this.view.invalidate();
    this.done?.();
  }

  private label(o: Obj | undefined, id?: Id): string {
    const x = o ?? (id !== undefined ? this.view.store.get(id) : undefined);
    if (!x) return '';
    return x.label ?? `${typeName(x)}${x.id}`;
  }

  private activeSlot(): number { return this.maps[this.cur].findIndex(v => v === undefined); }
  private complete() { return this.maps.every(m => m.every(v => v !== undefined)); }

  private refresh() {
    const slot = this.activeSlot();
    this.rows.replaceChildren(...this.pre.map((o, i) => {
      const img = this.maps[this.cur][i];
      const cell = h('span', { class: `iter-img${i === slot ? ' active' : ''}${img === undefined ? ' empty' : ''}`, onclick: () => { this.maps[this.cur][i] = undefined; this.refresh(); }, title: img === undefined ? '' : '单击清除，重新指定' }, img === undefined ? '' : this.label(undefined, img));
      return h('div', { class: 'iter-row' }, h('span', { class: 'iter-pre' }, this.label(o)), h('span', {}, '→'), cell);
    }));
    this.mapBar.replaceChildren(...(this.maps.length > 1 ? [
      h('button', { onclick: () => { this.cur = (this.cur + this.maps.length - 1) % this.maps.length; this.refresh(); } }, '◀'),
      h('span', {}, `映射 ${this.cur + 1} / ${this.maps.length}`),
      h('button', { onclick: () => { this.cur = (this.cur + 1) % this.maps.length; this.refresh(); } }, '▶'),
    ] : []));
    this.depthText.textContent = this.depthParam ? `迭代次数取自参数 ${this.depthParam.label ?? '参数'}，当前 ${this.paramDepth()}。` : `迭代次数：${this.depth}。`;
    this.go.disabled = !this.complete();
  }

  private paramDepth(): number {
    const s = this.view.store.results.get(this.depthParam!.id)?.shape;
    return s?.k === 'num' ? Math.round(s.q.v) : 0;
  }

  /** 画板里的一次单击：选作当前空位的初象（点对点、数值对数值）。 */
  private pick(p: { x: number; y: number }): boolean {
    this.closePopup();
    const slot = this.activeSlot();
    if (slot < 0) return true;
    const want = this.pre[slot];
    const st = this.view.store;
    const hits = hitAll(st.page, st.results, p, this.view.power, { classes: isNumericObj(want) ? ['measure'] : ['point'] });
    const id = hits.find(i => { const o = st.get(i); return !!o && o.def.k !== 'iterate' && o.def.k !== 'iterimg' && (isNumericObj(want) ? isNumericObj(o) : classOf(o) === 'point'); });
    if (id === undefined) { this.app.setStatus(isNumericObj(want) ? '初象必须是数值对象：参数、计算结果或度量值。' : '初象必须是点。'); return true; }
    this.maps[this.cur][slot] = id;
    this.syncDefaultStructure();
    this.refresh();
    return true;
  }

  /** 有多个映射时，默认只保留非点类象（和原版一致）；用户手动选过就不再自动改。 */
  private syncDefaultStructure() { if (!this.nonPointTouched) this.nonPoint = this.maps.length > 1; }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.popup) this.closePopup(); else this.close(); }
    else if (e.key === 'Enter' && !t?.matches('button')) { e.preventDefault(); e.stopPropagation(); if (this.complete()) this.iterate(); }
    else if ((e.key === '+' || e.key === '=') && !e.ctrlKey) { e.preventDefault(); this.changeDepth(1); }
    else if ((e.key === '-' || e.key === '_') && !e.ctrlKey) { e.preventDefault(); this.changeDepth(-1); }
    else if (e.key.toLowerCase() === 'a' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); this.addMap(); }
  };
  private onOutside = (e: PointerEvent) => { if (this.popup && !(e.target as HTMLElement).closest('.ipop')) this.closePopup(); };

  private changeDepth(d: number) {
    if (this.depthParam) return;
    this.depth = Math.max(0, Math.min(20, this.depth + d));
    this.refresh();
  }
  private addMap() {
    if (!this.complete() && this.maps.length) { this.app.setStatus('先给当前映射的每个原象指定初象。'); return; }
    this.maps.push(this.pre.map(() => undefined)); this.cur = this.maps.length - 1; this.syncDefaultStructure(); this.refresh();
  }
  private deleteMap() {
    if (this.maps.length < 2) return;
    this.maps.splice(this.cur, 1); this.cur = Math.min(this.cur, this.maps.length - 1); this.syncDefaultStructure(); this.refresh();
  }

  private displayMenu(): MenuItem[] {
    return [
      { label: '增加迭代\t+', run: () => this.changeDepth(1), disabled: !!this.depthParam },
      { label: '减少迭代\t-', run: () => this.changeDepth(-1), disabled: !!this.depthParam || this.depth <= 0 },
      { label: '', sep: true },
      { label: '完整迭代（显示每一次）', run: () => { this.finalOnly = false; this.refresh(); }, checked: !this.finalOnly },
      { label: '最终迭代（只显示最后一次）', run: () => { this.finalOnly = true; this.refresh(); }, checked: this.finalOnly },
    ];
  }
  private canTable() { const maps = this.maps.filter(m => m.every(x => x !== undefined)); return tableColumns(this.view.store, { pre: this.pre.map(o => o.id), maps: maps as Id[][] }).length > 0 && this.maps.length === 1; }
  private structureMenu(): MenuItem[] {
    const later = '本版暂缓';
    return [
      { label: '添加新的映射\tCtrl+A', run: () => this.addMap(), disabled: !this.complete() },
      { label: '删除当前映射', run: () => this.deleteMap(), disabled: this.maps.length < 2 },
      { label: '', sep: true },
      { label: '所有对象的象', run: () => { this.nonPoint = false; this.nonPointTouched = true; this.refresh(); }, checked: !this.nonPoint },
      { label: '仅保留非点类象', run: () => { this.nonPoint = true; this.nonPointTouched = true; this.refresh(); }, checked: this.nonPoint },
      { label: '', sep: true },
      { label: '生成迭代数据表', run: () => { this.table = !this.table; this.refresh(); }, checked: this.table && this.canTable(), disabled: !this.canTable(), title: this.canTable() ? '' : '需要数值原象（参数、计算）和一个映射' },
      { label: '', sep: true },
      { label: '移动原象上的点：相对类似的位置', disabled: true, title: later },
      { label: '移动原象上的点：所在对象的随机位置', disabled: true, title: later },
    ];
  }

  private openMenu(anchor: HTMLElement, items: MenuItem[]) {
    this.closePopup();
    const r = anchor.getBoundingClientRect();
    const pop = h('div', { class: 'ipop', style: `left:${r.left}px;top:${r.bottom}px` }, ...items.map(it => it.sep ? h('div', { class: 'isep' }) : h('div', {
      class: `iitem${it.disabled ? ' disabled' : ''}`, title: it.title ?? '',
      onclick: () => { if (it.disabled) return; this.closePopup(); it.run?.(); },
    }, h('span', { class: 'ick' }, it.checked ? '✓' : ''), it.label.split('\t')[0], it.label.includes('\t') ? h('span', { class: 'ikey' }, it.label.split('\t')[1]) : undefined)));
    document.body.append(pop); this.popup = pop;
  }
  private closePopup() { this.popup?.remove(); this.popup = undefined; }

  private iterate() {
    if (!this.complete()) return;
    const st = this.view.store;
    const made: Id[] = [];
    try {
      st.run(this.depthParam ? '深度迭代' : '迭代', () => {
        const r = constructIteration(st, {
          pre: this.pre.map(o => o.id), maps: this.maps as Id[][],
          depth: this.depthParam ? { param: this.depthParam.id } : { fixed: this.depth },
          finalOnly: this.finalOnly, nonPointOnly: this.nonPoint, table: this.table && this.canTable(),
        });
        made.push(...r.images.map(o => o.id));
      });
    } catch (e) { this.app.dlg.message(`无法迭代：${e instanceof Error ? e.message : String(e)}`); return; }
    this.close();
    if (made.length) this.view.setSel(made);
  }
}

/** 迭代命令：检查原象和目标，打开面板。 */
export async function runIteration(app: App, view: DocView, pre: Obj[], depthParam?: Obj) {
  const st = view.store;
  if (!iterationTargets(st, pre.map(o => o.id), false).length && !pre.some(isNumericObj)) {
    await app.dlg.message('没有依赖于所选原象的对象，没法迭代。\n先构造一些依赖原象的对象（例如过原象的线段、圆），再迭代。');
    return;
  }
  await new IterPanel(app, view, pre, depthParam).open();
}
