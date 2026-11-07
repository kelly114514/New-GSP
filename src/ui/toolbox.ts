/** 工具箱：竖排 9 个图标；有小三角的三组按住约 1 秒弹出横向弹出条。图标全部自绘（SVG）。 */
import { resolveTool } from '../toolkit';
import type { Tool } from '../core/tooling';
import type { App } from '../app';
import type { ToolId } from './docview';
import { parentsOf } from '../core/model';
import { typeName } from './render';

interface Group { id: string; tools: ToolId[]; names: Record<string, string>; current: ToolId }
const arrow = '<path d="M5 3 L5 19 L9.5 15 L12.5 21 L15 20 L12 14 L18 14 Z" fill="#111" stroke="#111" stroke-linejoin="round"/>';
const ICONS: Record<ToolId, string> = {
  move: arrow,
  rotate: `<g transform="translate(-2,0) scale(.8)">${arrow}</g><path d="M14 5 A8 8 0 0 1 21 13" fill="none" stroke="#1a5fb4" stroke-width="2"/><path d="M21 8 L21 14 L15.5 12.5" fill="#1a5fb4"/>`,
  scale: `<g transform="translate(-2,0) scale(.8)">${arrow}</g><path d="M13 21 L21 21 L21 13 Z" fill="#1a5fb4"/>`,
  point: '<circle cx="12" cy="12" r="3" fill="#111"/>',
  circle: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="#111" stroke-width="1.6"/><path d="M12 9 V15 M9 12 H15" stroke="#3b82c4" stroke-width="1.4"/>',
  segment: '<path d="M4 20 L20 5" stroke="#111" stroke-width="1.6"/><circle cx="4" cy="20" r="1.8" fill="#111"/><circle cx="20" cy="5" r="1.8" fill="#111"/>',
  ray: '<path d="M4 20 L21 4" stroke="#111" stroke-width="1.6"/><circle cx="4" cy="20" r="1.8" fill="#111"/><path d="M17 3 L22 3 L22 8" fill="none" stroke="#111"/>',
  line: '<path d="M2 22 L22 2" stroke="#111" stroke-width="1.6"/><circle cx="8" cy="16" r="1.8" fill="#111"/><circle cx="16" cy="8" r="1.8" fill="#111"/>',
  'poly-fill': '<path d="M12 3 L21 10 L17 21 L7 21 L3 10 Z" fill="#4a90d9" stroke="none"/>',
  'poly-both': '<path d="M12 3 L21 10 L17 21 L7 21 L3 10 Z" fill="#4a90d9" stroke="#1a3d6e"/><g fill="#111"><circle cx="12" cy="3" r="1.6"/><circle cx="21" cy="10" r="1.6"/><circle cx="17" cy="21" r="1.6"/><circle cx="7" cy="21" r="1.6"/><circle cx="3" cy="10" r="1.6"/></g>',
  'poly-edges': '<path d="M12 3 L21 10 L17 21 L7 21 L3 10 Z" fill="none" stroke="#111" stroke-width="1.6"/>',
  text: '<text x="12" y="19" text-anchor="middle" font-family="Times New Roman,serif" font-weight="bold" font-size="22" fill="#111">A</text>',
  marker: '<path d="M4 18 L15 5 L19 9 L8 21 L3 21 Z" fill="#335d9c"/><path d="M3 22 Q8 18 12 22 T21 21" fill="none" stroke="#3b82c4"/>',
  info: '<path d="M4 5 H20 V16 H12 L8 21 V16 H4 Z" fill="#fff" stroke="#111" stroke-width="1.4"/><text x="12" y="14" text-anchor="middle" font-family="serif" font-weight="bold" font-size="11">i</text>',
  custom: '<path d="M5 19 L10 8 M10 8 L14 6 L19 11 L17 15 L12 17 Z" fill="none" stroke="#111" stroke-width="1.4"/>',
};
const NAMES: Record<ToolId, string> = {
  move: '移动箭头工具', rotate: '旋转箭头工具', scale: '缩放箭头工具', point: '点工具', circle: '圆工具', segment: '线段直尺工具', ray: '射线直尺工具', line: '直线直尺工具',
  'poly-fill': '多边形工具（内部）', 'poly-both': '多边形工具', 'poly-edges': '多边形工具（边）', text: '文本工具', marker: '标记工具', info: '信息工具', custom: '自定义工具',
};
const svg = (t: ToolId) => `<svg viewBox="0 0 24 24" width="34" height="34">${ICONS[t]}</svg>`;

export class Toolbox {
  el = document.createElement('aside');
  current: ToolId = 'move';
  private groups: Group[] = [
    { id: 'arrow', tools: ['move', 'rotate', 'scale'], names: NAMES, current: 'move' },
    { id: 'point', tools: ['point'], names: NAMES, current: 'point' },
    { id: 'circle', tools: ['circle'], names: NAMES, current: 'circle' },
    { id: 'ruler', tools: ['segment', 'ray', 'line'], names: NAMES, current: 'segment' },
    { id: 'poly', tools: ['poly-fill', 'poly-both', 'poly-edges'], names: NAMES, current: 'poly-both' },
    { id: 'text', tools: ['text'], names: NAMES, current: 'text' },
    { id: 'marker', tools: ['marker'], names: NAMES, current: 'marker' },
    { id: 'info', tools: ['info'], names: NAMES, current: 'info' },
    { id: 'custom', tools: ['custom'], names: NAMES, current: 'custom' },
  ];
  private buttons = new Map<string, HTMLButtonElement>();
  private flyout?: HTMLElement;

  constructor(private app: App) {
    this.el.className = 'toolbox';
    for (const g of this.groups) this.el.append(this.makeButton(g));
    document.addEventListener('pointerup', () => this.closeFlyout(), true);
  }

  private makeButton(g: Group): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'tool'; b.type = 'button'; b.dataset.group = g.id;
    const render = () => { b.innerHTML = svg(g.current) + (g.tools.length > 1 ? '<i class="tri"></i>' : ''); b.title = NAMES[g.current]; b.classList.toggle('active', g.tools.includes(this.current)); };
    (b as unknown as { render: () => void }).render = render;
    render();
    this.buttons.set(g.id, b);
    let timer = 0, opened = false;
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      opened = false;
      if (g.id === 'custom') { this.customMenu(b, e.shiftKey); return; }
      if (g.tools.length > 1 && !g.tools.includes(this.current)) {
        timer = window.setTimeout(() => { opened = true; this.openFlyout(g, b); }, 1000);
      }
      // 已选中本组时按住不弹出
    });
    b.addEventListener('pointerup', () => {
      window.clearTimeout(timer);
      if (opened) return;
      if (g.id === 'custom') return;
      this.select(g, g.current);
    });
    b.addEventListener('pointerleave', () => window.clearTimeout(timer));
    return b;
  }

  private select(g: Group, t: ToolId) { g.current = t; this.app.setTool(t); (this.buttons.get(g.id) as unknown as { render: () => void }).render(); }

  setTool(t: ToolId) {
    this.current = t;
    for (const g of this.groups) { if (g.tools.includes(t)) g.current = t; (this.buttons.get(g.id) as unknown as { render: () => void }).render(); }
  }

  private openFlyout(g: Group, anchor: HTMLElement) {
    this.closeFlyout();
    const fly = document.createElement('div'); fly.className = 'flyout';
    const cells = [g.current, ...g.tools.filter(t => t !== g.current || true).slice(0)];
    const ordered = [g.current, ...g.tools];
    void cells;
    ordered.forEach((t, i) => {
      const c = document.createElement('div'); c.className = 'cell'; c.innerHTML = svg(t); c.title = NAMES[t]; c.dataset.tool = t; c.dataset.idx = String(i);
      c.addEventListener('pointerup', () => { if (i === 0) return; this.select(g, t); });
      fly.append(c);
    });
    const r = anchor.getBoundingClientRect();
    fly.style.left = `${r.left}px`; fly.style.top = `${r.top}px`;
    document.body.append(fly);
    this.flyout = fly;
    const move = (e: PointerEvent) => { const el = document.elementFromPoint(e.clientX, e.clientY); fly.querySelectorAll('.cell').forEach(c => c.classList.toggle('hot', c === el || c.contains(el))); };
    document.addEventListener('pointermove', move);
    fly.addEventListener('remove', () => document.removeEventListener('pointermove', move));
    (fly as unknown as { stop: () => void }).stop = () => document.removeEventListener('pointermove', move);
  }
  private closeFlyout() {
    if (!this.flyout) return;
    const f = this.flyout; this.flyout = undefined;
    setTimeout(() => { (f as unknown as { stop?: () => void }).stop?.(); f.remove(); }, 0);
  }
  /** 自定义工具菜单：创建/选项/脚本视图，文档里的工具，工具文件夹里按文件分组的工具，选择工具文件夹。 */
  private customMenu(anchor: HTMLElement, shift = false) {
    const old = document.querySelector('.toolmenu'); old?.remove();
    const m = document.createElement('div'); m.className = 'dropdown toolmenu';
    const app = this.app, v = app.active;
    const item = (text: string, opts: { disabled?: boolean; title?: string; check?: boolean; run?: () => void } = {}) => {
      const it = document.createElement('div'); it.className = opts.disabled ? 'item disabled' : 'item'; if (opts.title) it.title = opts.title;
      it.innerHTML = `<span class="ck">${opts.check ? '✓' : ''}</span><span class="nm"></span>`; (it.querySelector('.nm') as HTMLElement).textContent = text;
      if (opts.run && !opts.disabled) it.onclick = opts.run;
      return it;
    };
    const sep = () => document.createElement('hr');
    m.append(
      item('创建新工具…', { disabled: !v || !v.sel.length, title: !v || !v.sel.length ? '先选中要做成工具的对象' : '', run: () => void app.createToolFromSelection() }),
      item('工具选项…', { disabled: !app.docTools().length, title: app.docTools().length ? '' : '这个文档里还没有工具', run: () => { if (v) void app.dlg.docOptions(v, 'tools'); } }),
      ...(app.customTool ? [item('匹配选中对象并使用工具', { disabled: !v?.sel.length, run: () => v?.matchSelectedToolInputs() })] : []),
      item('显示脚本视图', { disabled: !app.customTool, title: app.customTool ? '查看当前工具的构造步骤' : '先选择一个工具', run: () => {
        const tool = app.customTool; if (!tool) return;
        const inputs = new Map(tool.inputs.map((input, i) => [input.index, i + 1]));
        const name = (id: number) => { const o = tool.objects.find(x => x.id === id); return o ? `${typeName(o)}${o.label ? ` ${o.label}` : ` ${id}`}` : `对象 ${id}`; };
        const lines = tool.objects.map(o => {
          const input = inputs.get(o.id), refs = parentsOf(o.def);
          return input ? `前提 ${input}：${name(o.id)}` : `构造 ${name(o.id)}${refs.length ? `（依赖 ${refs.map(name).join('、')}）` : ''}${o.hidden ? '（隐藏）' : ''}`;
        });
        void app.dlg.message(`${tool.name}\n\n${lines.join('\n')}`);
      } }),
      sep());
    const toolItem = (t: () => Tool, name: string) => {
      let tool: Tool | undefined; try { tool = t(); } catch { /* 解析失败当不可用 */ }
      return item(name, { disabled: !tool || !!tool.blocked, title: !tool ? '工具文件解析失败' : tool.blocked ?? (tool.comment ?? ''), check: !!tool && app.customTool?.name === tool.name && app.customTool.group === tool.group, run: () => { if (tool) app.useTool(tool); } });
    };
    const docTools = app.docTools();
    docTools.forEach(t => m.append(toolItem(() => t, t.name)));
    if (docTools.length) m.append(sep());
    for (const g of app.toolGroups) {
      const gi = item(g.name); gi.classList.add('sub');
      gi.insertAdjacentHTML('beforeend', '<span class="arrow">▶</span>');
      const sub = document.createElement('div'); sub.className = 'dropdown'; sub.style.maxHeight = '70vh'; sub.style.overflowY = 'auto';
      let filled = false;
      gi.onpointerenter = () => {
        if (!filled) { filled = true; g.tools.forEach(r => sub.append(toolItem(() => resolveTool(r), r.name))); }
        m.querySelectorAll('.dropdown.show').forEach(x => x.classList.remove('show')); sub.classList.add('show');
        // 菜单本身可滚动（会裁掉绝对定位的子菜单），所以子菜单用固定定位，贴着本项右侧，超出窗口就上移
        const r = gi.getBoundingClientRect(); sub.style.position = 'fixed'; sub.style.left = `${r.right}px`; sub.style.top = `${r.top}px`;
        sub.style.top = `${Math.max(0, Math.min(r.top, window.innerHeight - sub.getBoundingClientRect().height - 4))}px`;
      };
      gi.append(sub); m.append(gi);
    }
    if (app.toolGroups.length) m.append(sep());
    m.append(shift ? item('忽略工具文件夹', { run: () => void app.chooseToolFolder(true) }) : item('选择工具文件夹…', { run: () => void app.chooseToolFolder() }));
    m.style.maxHeight = '85vh'; m.style.overflowY = 'auto';
    const r = anchor.getBoundingClientRect(); m.style.left = `${r.right}px`; m.style.top = `${r.top}px`; m.style.position = 'fixed';
    document.body.append(m);
    m.style.top = `${Math.max(0, Math.min(r.top, window.innerHeight - m.getBoundingClientRect().height - 4))}px`;
    const off = (e?: Event) => { if (e && m.contains(e.target as Node)) return; m.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('click', late, true); };
    const late = (e: Event) => { if (m.contains(e.target as Node)) window.setTimeout(() => off(), 0); };
    document.addEventListener('click', late, true);
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
}
