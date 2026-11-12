/** 菜单栏与右键菜单：结构来自 menu-spec.json（由规格生成），名称/可用/勾选来自命令注册表。 */
import menuSpec from '../menu-spec.json';
import { SHORTCUTS } from '../shortcuts';
import type { App } from '../app';
import { analyse, queryCommand, commands, CMD_CUSTOM, type Ctx } from '../commands';
import { classOf } from '../core/construct';
import { typeName } from './render';
import type { DocView } from './docview';

interface Item { id?: number; name?: string; access?: string; shortcut?: string; separator?: boolean; children?: Item[] }
const ACCESS: Record<string, string> = { 文件: 'F', 编辑: 'E', 显示: 'D', 构造: 'C', 变换: 'T', 度量: 'M', 数据: 'N', 绘图: 'G', 窗口: 'W', 帮助: 'H' };
// 32859–32874：原版逐色采集课件 tc01-colors.gsp 与程序色表的顺序一致。
export const PALETTE = [
  '#000000', '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff',
  '#8a66d9', '#800080', '#008000', '#000080', '#800000', '#c0854a', '#c0c0c0', '#808080',
];

// 快捷键表：从规格里的字符串规范化
const shortcutOf = (s: string) => s.replace('Shift+Ctrl', 'Shift+Ctrl').replace('Alt+↑', 'Alt+ArrowUp').replace('Alt+↓', 'Alt+ArrowDown');
function collectShortcuts(items: Item[]) { for (const i of items) { if (i.id !== undefined && i.shortcut) SHORTCUTS.set(shortcutOf(i.shortcut), i.id); if (i.children) collectShortcuts(i.children); } }
for (const m of menuSpec as { items: Item[] }[]) collectShortcuts(m.items);
SHORTCUTS.set('Alt+?', 36895); SHORTCUTS.set('Shift+Ctrl+Z', 36876); SHORTCUTS.set('Shift+Ctrl+R', 36877);

interface Entry { el: HTMLElement; id: number; base: string; access?: string; shortcut?: string }
let entries: Entry[] = [];
let openTop: HTMLElement | undefined;
let shiftDown = false;
let keysBound = false;
let menuSig = '';
const transformSig = (app: App) => (app.active?.store.page.transforms ?? []).map(t => t.name).join('');

/** 带访问字母的显示名：把 (W) 放在末尾的省略号之前，如“新建参数(W)…”。 */
const withAccess = (name: string, access?: string) => { if (!access) return name; const m = /^(.*?)(…|\.\.\.)?$/.exec(name)!; return `${m[1]}(${access})${m[2] ?? ''}`; };

function labelWith(e: Entry, name: string, checked?: boolean) {
  const sc = e.shortcut ? `<span class="sc">${e.shortcut}</span>` : '';
  const hot = e.el.classList.contains('hot');
  e.el.innerHTML = `<span class="ck">${checked ? '✓' : ''}</span><span class="nm"></span>${sc}`;
  (e.el.querySelector('.nm') as HTMLElement).textContent = withAccess(name, e.access);
  e.el.classList.toggle('hot', hot);
}

// ---------------- 键盘导航（下拉菜单与右键菜单共用） ----------------
const rowsOf = (box: Element) => [...box.children].filter((c): c is HTMLElement => c.classList.contains('item'));
const subOf = (row: Element) => row.querySelector(':scope > .dropdown') as HTMLElement | null;
function setHot(box: Element, row: HTMLElement | undefined) {
  for (const r of rowsOf(box)) if (r !== row) { r.classList.remove('hot'); subOf(r)?.classList.remove('show'); }
  row?.classList.add('hot');
}
/** 当前键盘所在的菜单层：从根往下，沿着打开的子菜单走到底。 */
function deepest(root: HTMLElement): HTMLElement {
  let box = root;
  for (;;) { const open = rowsOf(box).map(subOf).find(s => s?.classList.contains('show')); if (!open) return box; box = open; }
}
/** 处理菜单打开时的按键；onTop(±1) 在顶层切换相邻菜单（右键菜单没有）。返回 true 表示已处理。 */
function menuKey(e: KeyboardEvent, root: HTMLElement, onTop: ((d: 1 | -1) => void) | undefined, close: () => void): boolean {
  const box = deepest(root), rows = rowsOf(box), cur = rows.find(r => r.classList.contains('hot')), i = cur ? rows.indexOf(cur) : -1;
  const openSub = (row: HTMLElement) => { const s = subOf(row)!; s.classList.add('show'); const first = rowsOf(s)[0]; if (first) setHot(s, first); };
  const fire = (row: HTMLElement) => { if (subOf(row)) openSub(row); else if (!row.classList.contains('disabled')) row.click(); };
  switch (e.key) {
    case 'ArrowDown': case 'ArrowUp': {
      if (!rows.length) return true;
      const n = rows.length, next = e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1);
      setHot(box, rows[next]); return true;
    }
    case 'ArrowRight':
      if (cur && subOf(cur)) openSub(cur);
      else onTop?.(1);
      return true;
    case 'ArrowLeft': {
      if (box !== root) { box.classList.remove('show'); rowsOf(box).forEach(r => r.classList.remove('hot')); return true; }
      onTop?.(-1); return true;
    }
    case 'Enter': if (cur) fire(cur); return true;
    case 'Escape':
      if (box !== root) { box.classList.remove('show'); return true; }
      close(); return true;
  }
  if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return false;
  // 访问字母：唯一匹配直接执行；同一字母有多项时在它们之间移动（Windows 菜单的规矩）
  const ch = e.key.toUpperCase(), hits = rows.filter(r => r.dataset.access === ch);
  if (!hits.length) return true;
  if (hits.length === 1) { setHot(box, hits[0]); fire(hits[0]); return true; }
  setHot(box, hits[(hits.indexOf(cur as HTMLElement) + 1) % hits.length]);
  return true;
}

export function buildMenus(app: App, onlyRefresh = false) {
  if (onlyRefresh && entries.length && transformSig(app) === menuSig) { refreshStates(app); return; }
  menuSig = transformSig(app);
  const bar = app.menubar;
  bar.replaceChildren();
  entries = [];
  const close = () => { openTop?.classList.remove('open'); openTop = undefined; bar.querySelectorAll('.top.open').forEach(t => t.classList.remove('open')); bar.querySelectorAll('.hot').forEach(t => t.classList.remove('hot')); bar.querySelectorAll('.dropdown.show').forEach(t => t.classList.remove('show')); };
  const makeItems = (items: Item[], menuName: string): HTMLElement => {
    const box = document.createElement('div'); box.className = 'dropdown';
    for (const it of items) {
      if (it.separator) { const hr = document.createElement('hr'); box.append(hr); continue; }
      const row = document.createElement('div'); row.className = 'item';
      if (it.children) {
        row.classList.add('sub');
        row.innerHTML = `<span class="ck"></span><span class="nm">${withAccess(it.name ?? '', it.access)}</span><span class="arrow">▶</span>`;
        if (it.access) row.dataset.access = it.access;
        const sub = makeItems(it.children, it.name ?? '');
        if (it.name === '颜色') {
          const sw = document.createElement('div'); sw.className = 'swrow';
          for (const c of PALETTE) { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.onmousedown = e => e.preventDefault(); b.onclick = () => { const v = app.active; v.store.run('颜色', () => v.store.setStyle(v.sel, { color: c })); closeMenus(); }; sw.append(b); }
          sub.prepend(sw);
        }
        row.append(sub);
        row.onmouseenter = () => { setHot(box, row); sub.classList.add('show'); }; row.onmouseleave = () => { sub.classList.remove('show'); row.classList.remove('hot'); };
      } else {
        const id = it.id!, e: Entry = { el: row, id, base: it.name ?? '', access: it.access, shortcut: it.shortcut?.replace('Shift+Ctrl', 'Shift+Ctrl') };
        if (it.access) row.dataset.access = it.access;
        entries.push(e); labelWith(e, e.base);
        row.onmouseenter = () => setHot(box, row);
        row.onclick = () => { if (row.classList.contains('disabled')) return; closeMenus(); void app.exec(id, shiftDown); };
      }
      box.append(row);
    }
    void menuName;
    return box;
  };
  for (const m of menuSpec as { name: string; items: Item[] }[]) {
    const items = m.items.slice();
    if (m.name === '变换') {   // 本页的自定义变换排在菜单底部
      const tf = app.active?.store.page.transforms ?? [], at = items.findIndex(i => i.id === 36951);
      if (tf.length && at >= 0) items.splice(at + 1, 0, { separator: true }, ...tf.slice(0, 32).map((t, k) => ({ id: CMD_CUSTOM + k, name: t.name })));
    }
    if (m.name === '文件' && app.settings.recent.length) {
      const idx = items.findIndex(i => i.id === 36875);
      items.splice(idx, 0, { separator: true }, ...app.settings.recent.map((p, i) => ({ id: 100000 + i, name: `${i + 1} ${p.split(/[\\/]/).pop()}` })));
    }
    const top = document.createElement('div'); top.className = 'top';
    const lab = document.createElement('div'); lab.className = 'toplabel'; lab.textContent = `${m.name}(${ACCESS[m.name] ?? ''})`;
    const dd = makeItems(items, m.name);
    if (m.name === '窗口') dd.classList.add('windowmenu');
    top.append(lab, dd); bar.append(top);
    lab.onmousedown = e => { e.preventDefault(); if (top.classList.contains('open')) close(); else { close(); top.classList.add('open'); openTop = top; refreshStates(app); } };
    lab.onmouseenter = () => { if (openTop && openTop !== top) { close(); top.classList.add('open'); openTop = top; refreshStates(app); } };
  }
  // 最近文件命令
  for (let i = 0; i < 8; i++) commands.set(100000 + i, { run: c => c.app.openFile(c.app.settings.recent[i]), enabled: c => !!c.app.settings.recent[i] });
  closeMenus = close;
  if (!keysBound) {
    keysBound = true;
    /** 用键盘打开一个顶层菜单：第一项高亮。 */
    const openIdx = (idx: number) => {
      closeMenus(); const b = app.menubar, n = b.children.length, top = b.children[(idx + n) % n] as HTMLElement;
      top.classList.add('open'); openTop = top; refreshStates(app);
      const dd = top.querySelector(':scope > .dropdown')!, first = rowsOf(dd)[0]; if (first) setHot(dd, first);
    };
    document.addEventListener('mousedown', e => { if (!(e.target as HTMLElement).closest('#menubar')) closeMenus(); }, true);
    window.addEventListener('keydown', e => {
      if (e.key === 'Shift' && !shiftDown) { shiftDown = true; if (openTop) refreshStates(app); }
      if (e.altKey && !e.ctrlKey && /^[a-z]$/i.test(e.key)) {
        const name = Object.entries(ACCESS).find(([, k]) => k === e.key.toUpperCase())?.[0];
        const idx = (menuSpec as { name: string }[]).findIndex(m => m.name === name);
        if (idx >= 0 && !app.dlg.open) { e.preventDefault(); e.stopImmediatePropagation(); openIdx(idx); return; }
      }
      if (openTop && !e.altKey) {
        const dd = openTop.querySelector(':scope > .dropdown') as HTMLElement;
        const handled = menuKey(e, dd, d => openIdx([...app.menubar.children].indexOf(openTop!) + d), closeMenus);
        if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
      }
    }, true);
    window.addEventListener('keyup', e => { if (e.key === 'Shift') { shiftDown = false; if (openTop) refreshStates(app); } }, true);
  }
  refreshStates(app);
  void shiftDown;
}

let closeMenus: () => void = () => undefined;

function refreshStates(app: App) {
  if (!app.active) return;
  const ctx: Ctx = app.ctx(shiftDown);
  app.menubar.querySelectorAll<HTMLButtonElement>('.swrow .sw').forEach(b => { b.disabled = !queryCommand(36909, ctx).enabled; });
  // 窗口菜单的文档列表
  const win = app.menubar.querySelector('.windowmenu');
  if (win && win.querySelectorAll('.docitem').length !== app.docs.length) {
    win.querySelectorAll('.docitem, .docsep').forEach(x => x.remove());
    const sep = document.createElement('hr'); sep.className = 'docsep'; win.append(sep);
  }
  if (win) {
    win.querySelectorAll('.docitem').forEach(x => x.remove());
    app.docs.forEach((d, i) => { const r = document.createElement('div'); r.className = 'item docitem'; r.innerHTML = `<span class="ck">${d === app.active ? '✓' : ''}</span><span class="nm">${i + 1} ${d.store.doc.name}</span>`; r.onclick = () => { app.focusDoc(d); (document.activeElement as HTMLElement)?.blur(); }; win.append(r); });
  }
  for (const e of entries) {
    const st = queryCommand(e.id, ctx);
    const d = commands.get(e.id);
    labelWith(e, st.name ?? e.base, st.checked);
    e.el.classList.toggle('disabled', !st.enabled);
    e.el.title = d?.deferred ? `本版暂缓：${d.deferred}` : '';
  }
}

// ---------------- 右键菜单 ----------------
type CItem = { cmd?: number; label?: (s: ReturnType<typeof analyse>, v: DocView) => string; sep?: boolean; palette?: boolean; children?: CItem[]; menuId?: number };
const P = (id: number): CItem => ({ cmd: id });
const SEP: CItem = { sep: true };
const sizes = [P(36897), P(36898), P(36899), P(36900)];
const widths = [P(36901), P(36902), P(36903), P(36904)];
const dashes = [P(36905), P(36906), P(36907)];
const color: CItem = { label: () => '颜色', palette: true };
const contextType = (s: ReturnType<typeof analyse>) => s.sameType?.replace('内部', '') ?? '对象';
const common = (kind: 'point' | 'line' | 'region' | 'plain'): CItem[] => {
  const head: CItem[] = [P(36890), P(36895), SEP];
  const body: CItem[] = kind === 'point' ? [...sizes, color] : kind === 'line' ? [...widths, SEP, ...dashes, color] : [color];
  return [...head, ...body, SEP, { cmd: 36911, label: s => `隐藏${contextType(s)}` }, { cmd: 36913 }, { cmd: 36914, label: s => `${contextType(s)}的标签…` }, { cmd: 36915, label: s => `追踪${contextType(s)}` }, { cmd: 36917, label: s => `生成${contextType(s)}的动画` }];
};

export function contextItems(v: DocView): CItem[] {
  const s = analyse(v);
  if (s.n === 0) return [P(36870), P(36871), P(36874), SEP, P(36889), P(36896), SEP, P(36921), P(36922), P(36923), SEP, P(36970), P(36971), P(36975), SEP, P(36980), P(36981), P(36982), P(36983), SEP, P(36984), P(36985), P(36987), P(36988), P(36990), P(36991)];
  if (s.n > 1) return [P(36890), P(36891), P(36895), SEP, color, SEP, { cmd: 36911 }, { cmd: 36913 }, { cmd: 36915 }, SEP, P(36878), P(36879), P(36881)];
  const o = s.objs[0], c = classOf(o);
  const k = o.def.k;
  if (c === 'point') return [...(k === 'onpath' ? [P(36890), P(36893)] : k === 'free' ? [] : [P(36890)]), P(36895), SEP, ...sizes, color, SEP, { cmd: 36911, label: () => '隐藏点' }, { cmd: 36913 }, { cmd: 36914, label: () => '点的标签…' }, { cmd: 36915, label: () => '追踪点' }, { cmd: 36917, label: () => '生成点的动画' }, SEP, P(36939), SEP, ...(k === 'onpath' ? [P(36963)] : []), P(36964), P(36965), P(36966)];
  if (c === 'straight') return [...common('line'), SEP, P(36940), SEP, ...(k === 'seg' ? [P(36953)] : []), P(36968), ...(k === 'line' ? [P(36969)] : []), SEP, P(36987)];
  if (c === 'circle') return [...common('line'), SEP, P(36956), P(36958), P(36961), P(36969), SEP, P(36987)];
  if (c === 'arc') return [...common('line'), SEP, P(36959), P(36960), P(36961), SEP, P(36987)];
  if (c === 'interior') return [...common('region'), SEP, P(36955), P(36958), SEP, { cmd: 36987, label: s => `在${contextType(s)}上绘制点…` }];
  if (c === 'locus' || c === 'plot') return [...common('line'), SEP, P(36987), SEP, P(200001), P(200002)];
  if (k === 'iterimg') return [P(36890), P(36895), SEP, ...sizes, color, SEP, { cmd: 36911 }, { cmd: 36915, label: () => '追踪迭代象' }, { cmd: 36917, label: () => '生成迭代象的动画' }, SEP, P(200005), P(200006)];
  if (k === 'measure') return [P(36890), P(36895), color, SEP, { cmd: 36911, label: () => `隐藏${o.def.k === 'measure' && o.def.m === 'distance' ? '距离度量值' : '度量值'}` }, { cmd: 36914, label: () => `${o.def.k === 'measure' && o.def.m === 'distance' ? '距离度量值' : '度量值'}的标签…` }, SEP, P(36944), SEP, P(36987)];
  if (k === 'param') return [P(36894), P(36895), color, SEP, { cmd: 36911 }, { cmd: 36914 }, { cmd: 36917, label: () => '生成参数的动画' }, SEP, P(36942), SEP, P(36987), SEP, P(200003), P(200004)];
  if (k === 'calc') return [P(36894), P(36895), color, SEP, { cmd: 36911, label: () => '隐藏度量值' }, { cmd: 36914, label: () => '度量值的标签…' }, SEP, P(36942), SEP, P(36987)];
  if (k === 'func') return [P(36894), P(36895), color, SEP, { cmd: 36911 }, { cmd: 36914 }, SEP, P(36976), P(36990)];
  if (k === 'table') return [P(36890), P(36895), color, SEP, { cmd: 36911 }, SEP, P(36973), SEP, P(36989)];
  if (k === 'button') return [P(36890), P(36895), color, SEP, { cmd: 36911 }, { cmd: 36914 }];
  if (k === 'image') return [P(36895), color, SEP, { cmd: 36911 }, SEP, P(36977)];
  if (k === 'text') return [P(36895), color, SEP, { cmd: 36911, label: () => '隐藏说明' }];
  return [P(36890), P(36895), SEP, { cmd: 36911 }];
}

export class ContextMenu {
  el = document.createElement('div');
  constructor(private app: App) {
    this.el.className = 'dropdown ctxmenu'; this.el.hidden = true;
    document.addEventListener('mousedown', e => { if (!this.el.contains(e.target as Node)) this.hide(); }, true);
    window.addEventListener('keydown', e => {
      if (this.el.hidden) return;
      if (menuKey(e, this.el, undefined, () => this.hide())) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }
  hide() { this.el.hidden = true; }
  show(v: DocView, x: number, y: number) {
    const ctx: Ctx = { ...this.app.ctx(), view: v };
    const build = (items: CItem[], into: HTMLElement) => {
      for (const it of items) {
        if (it.sep) { into.append(document.createElement('hr')); continue; }
        const row = document.createElement('div'); row.className = 'item';
        if (it.palette) {
          row.classList.add('sub'); row.dataset.access = 'C'; row.innerHTML = '<span class="ck"></span><span class="nm">颜色(C)</span><span class="arrow">▶</span>';
          const sub = document.createElement('div'); sub.className = 'dropdown';
          const sw = document.createElement('div'); sw.className = 'swrow';
          const colorEnabled = queryCommand(36909, ctx).enabled;
          for (const c of PALETTE) { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.disabled = !colorEnabled; b.onclick = () => { this.hide(); v.store.run('颜色', () => v.store.setStyle(v.sel, { color: c })); }; sw.append(b); }
          sub.append(sw);
          if (colorEnabled) { const other = document.createElement('div'); other.className = 'item'; other.dataset.access = 'O'; other.innerHTML = '<span class="ck"></span><span class="nm">其它(O)…</span>'; other.onclick = () => { this.hide(); void this.app.exec(36909); }; sub.append(other); }
          row.append(sub);
          row.onmouseenter = () => { setHot(into, row); sub.classList.add('show'); }; row.onmouseleave = () => { sub.classList.remove('show'); row.classList.remove('hot'); };
        } else {
          const id = it.cmd!, st = queryCommand(id, ctx), s = analyse(v);
          const spec = (menuSpec as { items: Item[] }[]).flatMap(m => flat(m.items)).find(i => i.id === id);
          const name = withAccess(it.label ? it.label(s, v) : st.name ?? spec?.name ?? '', spec?.access);
          if (spec?.access) row.dataset.access = spec.access;
          row.onmouseenter = () => setHot(into, row);
          const d = commands.get(id);
          row.innerHTML = `<span class="ck">${st.checked ? '✓' : ''}</span><span class="nm"></span>`;
          (row.querySelector('.nm') as HTMLElement).textContent = name;
          if (!st.enabled || d?.deferred) row.classList.add('disabled');
          row.onclick = () => { if (row.classList.contains('disabled')) return; this.hide(); void this.app.exec(id); };
        }
        into.append(row);
      }
    };
    this.el.replaceChildren();
    build(contextItems(v), this.el);
    this.el.hidden = false;
    setHot(this.el, undefined);
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    this.el.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
    void typeName;
  }
}
function flat(items: Item[]): Item[] { return items.flatMap(i => [i, ...(i.children ? flat(i.children) : [])]); }
