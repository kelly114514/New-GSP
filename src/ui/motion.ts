/** 运动控制台：带标题和关闭按钮的浮动小面板。目标、播放、停止、反向、暂停、速度。动画开始时自动出现。 */
import type { App } from '../app';
import { typeName } from './render';

export class Motion {
  visible = false;
  el = document.createElement('div');
  private target = document.createElement('select');
  private speed = document.createElement('input');
  private btns: Record<string, HTMLButtonElement> = {};
  constructor(private app: App) {
    this.el.className = 'motion'; this.el.hidden = true;
    const head = document.createElement('div'); head.className = 'mo-title';
    const title = document.createElement('span'); title.textContent = '运动控制台';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '✕'; close.title = '关闭'; close.onclick = () => this.toggle();
    head.append(title, close);
    this.dragBy(head);
    const mk = (k: string, t: string, tip: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = tip; b.dataset.k = k; b.onclick = fn; this.btns[k] = b; return b; };
    const row = document.createElement('div'); row.className = 'mo-row';
    row.append(mk('play', '▶', '播放', () => this.play()), mk('stop', '■', '停止', () => app.anim.stopAll()), mk('rev', '⇄', '反向', () => app.anim.reverse(this.selectedId())), mk('pause', '❚❚', '暂停', () => app.anim.setPaused(!app.anim.paused)));
    this.speed.type = 'text'; this.speed.value = '1.0'; this.speed.className = 'mo-speed';
    this.speed.onchange = () => { const v = Number(this.speed.value); if (Number.isFinite(v) && v > 0) app.anim.setFactor(v); this.refresh(); };
    const sp = document.createElement('label'); sp.className = 'mo-row'; sp.append('速度', this.speed);
    this.target.className = 'mo-target';
    this.el.append(head, this.target, row, sp);
    document.body.append(this.el);
    this.refresh();
  }
  toggle() { this.visible = !this.visible; this.el.hidden = !this.visible; this.refresh(); }
  show() { if (!this.visible) this.toggle(); }
  private selectedId() { return this.target.value ? Number(this.target.value) : undefined; }
  private dragBy(head: HTMLElement) {
    head.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (m: PointerEvent) => { Object.assign(this.el.style, { left: `${m.clientX - dx}px`, top: `${m.clientY - dy}px`, right: 'auto', bottom: 'auto' }); };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
  }
  private play() {
    const a = this.app.anim;
    if (a.paused) { a.setPaused(false); return; }
    if (a.running) return;
    const v = this.app.active, sel = v.sel.map(id => v.store.get(id)).filter((o): o is NonNullable<typeof o> => !!o && (o.def.k === 'onpath' || o.def.k === 'param'));
    const all = v.store.page.objects.filter(o => o.def.k === 'onpath' && !o.hidden);
    a.toggle(v, sel.length ? sel : all);
  }
  refresh() {
    if (!this.visible) return;
    const a = this.app.anim, list = a.targets;
    const key = list.map(t => t.id).join(',');
    if (this.target.dataset.key !== key || !this.target.options.length) {
      this.target.dataset.key = key;
      const keep = this.target.value;
      this.target.replaceChildren(new Option(list.length ? '所有目标' : '无目标', ''), ...list.map(t => { const o = t.view.store.get(t.id); return new Option(o ? (o.label ?? typeName(o)) : '对象', String(t.id)); }));
      this.target.value = list.some(t => String(t.id) === keep) ? keep : '';
    }
    this.target.disabled = !list.length;
    this.btns.stop.disabled = !a.running; this.btns.rev.disabled = !list.length; this.btns.pause.disabled = !a.running;
    this.btns.pause.classList.toggle('on', a.paused);
    if (document.activeElement !== this.speed) this.speed.value = a.factor.toFixed(1);
  }
}
