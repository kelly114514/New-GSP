/** 多文档窗口：默认最大化；层叠与平铺都有自己的标题栏。 */
import type { App } from '../app';
import type { DocView } from './docview';

export class Mdi {
  mode: 'max' | 'tile' | 'cascade' = 'max';
  constructor(private area: HTMLElement, private app: App) {}

  add(v: DocView) {
    this.area.append(v.el);
    v.el.addEventListener('pointerdown', () => { if (this.app.active !== v) this.app.focusDoc(v); }, true);
    v.title.onclick = () => this.app.focusDoc(v);
    const btns = document.createElement('span'); btns.className = 'winbtns';
    const mk = (t: string, title: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = t; b.title = title; b.onclick = e => { e.stopPropagation(); fn(); }; return b; };
    btns.append(mk('▭', '最大化', () => { this.mode = 'max'; this.app.focusDoc(v); this.layout(); }), mk('✕', '关闭', () => void this.app.closeDocument(v)));
    v.el.firstElementChild!.append(btns);
    this.layout();
  }
  remove(v: DocView) { v.el.remove(); this.layout(); }
  activate(v: DocView) { for (const d of this.app.docs) d.el.classList.toggle('active', d === v); if (this.mode === 'cascade') v.el.style.zIndex = String(++z); this.layout(); }
  titles() { for (const d of this.app.docs) d.title.firstChild && void 0; }
  arrange(mode: 'tile' | 'cascade') { this.mode = mode; this.layout(); }

  layout() {
    const docs = this.app.docs, n = docs.length;
    this.area.dataset.mode = this.mode;
    docs.forEach((d, i) => {
      const el = d.el;
      el.classList.toggle('framed', this.mode !== 'max');
      el.hidden = false;
      if (this.mode === 'max') {
        Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: d === this.app.active ? 'flex' : 'none', zIndex: '' });
      } else if (this.mode === 'tile') {
        const h = 100 / n;
        Object.assign(el.style, { position: 'absolute', left: '0', width: '100%', top: `${i * h}%`, height: `${h}%`, display: 'flex', zIndex: '' });
      } else {
        Object.assign(el.style, { position: 'absolute', left: `${i * 28}px`, top: `${i * 28}px`, width: 'calc(100% - 120px)', height: 'calc(100% - 120px)', display: 'flex', zIndex: d === this.app.active ? String(++z) : el.style.zIndex });
      }
    });
    requestAnimationFrame(() => docs.forEach(d => d.resize()));
  }
}
let z = 10;
