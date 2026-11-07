/** 动画：路径点沿路径运动、参数连续变化、“移动”按钮。运行时状态不写入构造定义；关闭文档时释放计时器。 */
import { pathPointAt, projectOnPath, type Shape } from './core/engine';
import { dragSysUnit } from './core/construct';
import * as G from './core/geom';
import { parentsOf, type Id, type Obj } from './core/model';
import type { App } from './app';
import type { DocView } from './ui/docview';

type Speed = 'slow' | 'medium' | 'fast' | 'high' | number;
type Direction = 'forward' | 'backward' | 'bounce' | 'random';
const PX_PER_SEC = { slow: 50, medium: 120, fast: 260, high: 600 };

interface Run { view: DocView; id: Id; dir: Direction; speed: Speed; sign: 1 | -1; v?: { x: number; y: number } }
interface Move { view: DocView; id: Id; from: G.Pt; to: G.Pt; elapsed: number; dur: number; target: Id; t?: [number, number]; value?: [number, number]; sys?: Id }

export class Animator {
  private runs: Run[] = [];
  private moves: Move[] = [];
  private raf = 0;
  private last = 0;
  factor = 1;
  paused = false;

  constructor(private app: App) {}
  get running() { return this.runs.length > 0 || this.moves.length > 0; }
  isAnimating(id: Id) { return this.runs.some(r => r.id === id); }

  private speedPx(s: Speed) { return typeof s === 'number' ? s : PX_PER_SEC[s]; }

  /** 要动画的对象展开成可运动的单元：路径点、参数、自由点（几何对象则取其依赖的自由点）。 */
  private units(view: DocView, objs: Obj[]): Obj[] {
    const byId = new Map(view.store.page.objects.map(o => [o.id, o]));
    const seen = new Set<Id>(), out: Obj[] = [];
    const walk = (o: Obj) => {
      if (seen.has(o.id)) return;
      seen.add(o.id);
      if (o.def.k === 'onpath' || o.def.k === 'param' || o.def.k === 'free') { out.push(o); return; }
      for (const pid of parentsOf(o.def)) {
        const p = byId.get(pid);
        if (p) walk(p);
      }
    };
    objs.forEach(walk);
    return out;
  }
  /** 所选对象（或它们依赖的自由点、路径点、参数）里有没有正在运动的。 */
  involves(view: DocView, objs: Obj[]): boolean {
    const running = new Set(this.runs.filter(r => r.view === view).map(r => r.id));
    return running.size > 0 && this.units(view, objs).some(o => running.has(o.id));
  }
  /** 只停所选对象的动画。 */
  stopFor(view: DocView, objs: Obj[]) { const ids = new Set(this.units(view, objs).map(o => o.id)); this.runs = this.runs.filter(r => r.view !== view || !ids.has(r.id)); if (!this.running && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } this.app.refresh(); }
  /** 只改所选对象的动画速度。 */
  speedFor(view: DocView, objs: Obj[], f: number) { const ids = new Set(this.units(view, objs).map(o => o.id)); for (const r of this.runs) if (r.view === view && ids.has(r.id)) r.speed = Math.min(2400, Math.max(6, this.speedPx(r.speed) * f)); }
  toggle(view: DocView, objs: Obj[], speed?: Speed, dir?: Direction) {
    const targets = this.units(view, objs);
    if (!targets.length) return;
    const allOn = targets.every(o => this.isAnimating(o.id));
    if (allOn) { this.runs = this.runs.filter(r => !targets.some(o => o.id === r.id)); }
    else for (const o of targets) {
      if (this.isAnimating(o.id)) continue;
      const d = dir ?? o.anim?.direction ?? 'forward';
      const ang = Math.random() * Math.PI * 2;
      this.runs.push({ view, id: o.id, dir: d, speed: speed ?? o.anim?.speed ?? 'medium', sign: d === 'backward' ? -1 : 1, v: o.def.k === 'free' ? { x: Math.cos(ang), y: Math.sin(ang) } : undefined });
    }
    this.paused = false;
    if (this.runs.length) this.app.motion.show();   // 动画开始时运动控制台自动出现
    this.kick(); this.app.refresh();
  }
  moveTo(view: DocView, from: Id, to: Id, speed: Speed, dest?: G.Pt) {
    const st = view.store, a = st.results.get(from)?.shape, b0 = st.results.get(to)?.shape;
    const b = dest ? ({ k: 'pt', p: dest } as const) : b0;
    const def = st.get(from)?.def;
    if (a?.k === 'num' && b?.k === 'num' && def?.k === 'param') {
      this.moves.push({ view, id: from, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, value: [a.q.v, b.q.v], elapsed: 0, dur: speed === 'high' ? 0.01 : 0.5, target: to }); this.kick(); return;
    }
    if (a?.k !== 'pt' || b?.k !== 'pt') return;
    const sys = st.page.objects.find(o => o.def.k === 'sys' && [o.def.unitX, o.def.unitY].includes(from));
    if (def?.k !== 'free' && def?.k !== 'onpath' && !sys) return;
    let t: [number, number] | undefined;
    if (def?.k === 'onpath') {
      const p = projectOnPath(st.page, st.results, def.path, b.p); if (!p) return;
      let target = p.t;
      if (st.results.get(def.path)?.shape?.k === 'circle') target = def.t + ((target - def.t + Math.PI) % G.TAU + G.TAU) % G.TAU - Math.PI;
      t = [st.ctx.tOverride?.get(from) ?? def.t, target];
    }
    const dist = G.dist(a.p, b.p), dur = Math.max(0.2, dist / this.speedPx(speed) / this.factor * 2.5);
    this.moves.push({ view, id: from, from: a.p, to: b.p, elapsed: 0, dur: speed === 'high' ? 0.01 : dur, target: to, ...(t ? { t } : {}), ...(sys ? { sys: sys.id } : {}) });
    this.kick();
  }
  /** 所有（或 only 指定的）运动对象掉头。 */
  reverse(only?: Id) { for (const r of this.runs) if (only === undefined || r.id === only) { r.sign = r.sign === 1 ? -1 : 1; if (r.v) r.v = { x: -r.v.x, y: -r.v.y }; } }
  /** 当前正在运动的对象（运动控制台的目标列表）。 */
  get targets(): { view: DocView; id: Id }[] { return this.runs.map(r => ({ view: r.view, id: r.id })); }
  setPaused(on: boolean) { this.paused = on; if (!on) this.kick(); this.app.motion.refresh(); }
  setFactor(f: number) { this.factor = Math.min(8, Math.max(0.125, f)); this.app.motion.refresh(); }
  speedUp(f: number) { this.factor = Math.min(8, Math.max(0.125, this.factor * f)); }
  stopAll() { this.runs = []; this.moves = []; this.paused = false; this.app.refresh(); }
  stopView(v: DocView) { this.runs = this.runs.filter(r => r.view !== v); this.moves = this.moves.filter(m => m.view !== v); if (!this.running && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }
  /** 删除对象后丢弃指向它们的动画。 */
  prune(v: DocView) { this.runs = this.runs.filter(r => r.view !== v || !!v.store.get(r.id)); }

  private kick() { if (!this.raf && this.running && !this.paused) { this.last = performance.now(); this.raf = requestAnimationFrame(t => this.tick(t)); } }

  private tick(now: number) {
    this.raf = 0;
    if (this.paused) return;
    const dt = Math.min(0.1, (now - this.last) / 1000) * this.factor;
    this.last = now;
    const touched = new Map<DocView, Id[]>();
    const mark = (v: DocView, id: Id) => { const l = touched.get(v) ?? []; l.push(id); touched.set(v, l); };
    for (const r of [...this.runs]) {
      const st = r.view.store, o = st.get(r.id);
      if (!o || !st.doc.pages.includes(st.page)) { this.runs = this.runs.filter(x => x !== r); continue; }
      st.ctx.tOverride ??= new Map(); st.ctx.valOverride ??= new Map();
      const px = this.speedPx(r.speed);
      if (o.def.k === 'free' && r.v) {
        st.ctx.posOverride ??= new Map();
        const cur = st.ctx.posOverride.get(r.id) ?? { x: o.def.x, y: o.def.y };
        const vr = r.view.viewRect();
        let nx = cur.x + r.v.x * px * dt * r.sign, ny = cur.y + r.v.y * px * dt * r.sign;
        if (nx < vr.x0 + 10 || nx > vr.x1 - 10) { r.v.x = -r.v.x; nx = Math.min(vr.x1 - 10, Math.max(vr.x0 + 10, nx)); }
        if (ny < vr.y0 + 10 || ny > vr.y1 - 10) { r.v.y = -r.v.y; ny = Math.min(vr.y1 - 10, Math.max(vr.y0 + 10, ny)); }
        if (r.dir === 'random' && Math.random() < 0.03) { const a = Math.random() * Math.PI * 2; r.v = { x: Math.cos(a), y: Math.sin(a) }; }
        st.ctx.posOverride.set(r.id, { x: nx, y: ny });
        mark(r.view, r.id);
      } else if (o.def.k === 'onpath') {
        const path = st.results.get(o.def.path)?.shape;
        let t = st.ctx.tOverride.get(r.id) ?? o.def.t;
        const len = this.pathLength(path);
        if (!path || len < 1e-6) continue;
        const absAxis = o.def.abs && path.k === 'line';   // 坐标轴上的点：t 就是像素
        let step = absAxis ? px * dt : (px * dt) / len;
        if (path.k === 'circle' || path.k === 'disk') step = (px * dt) / Math.max(1, len) * G.TAU;
        const lo = absAxis ? -1500 : path.k === 'line' && path.s.ext !== 'segment' ? -2 : 0, hi = absAxis ? 1500 : path.k === 'line' && path.s.ext !== 'segment' ? 3 : path.k === 'circle' || path.k === 'disk' ? Infinity : 1;
        const wraps = path.k === 'poly' || path.k === 'circle' || path.k === 'disk';
        if (r.dir === 'random') r.sign = Math.random() < 0.05 ? (r.sign === 1 ? -1 : 1) : r.sign;
        t += step * r.sign;
        if (!wraps) { if (r.dir === 'bounce' || r.dir === 'random') { if (t > hi) { t = hi - (t - hi); r.sign = -1; } if (t < lo) { t = lo + (lo - t); r.sign = 1; } } else if (t > hi) t = lo; else if (t < lo) t = hi; }
        st.ctx.tOverride.set(r.id, t);
        mark(r.view, r.id);
      } else if (o.def.k === 'param') {
        const unitScale = o.def.unit === 'angle' ? 30 : 1;
        const rate = (typeof r.speed === 'number' ? r.speed : { slow: 0.5, medium: 1, fast: 2, high: 4 }[r.speed]) * unitScale;
        const cur = st.ctx.valOverride.get(r.id) ?? o.def.value;
        st.ctx.valOverride.set(r.id, cur + rate * dt * r.sign);
        mark(r.view, r.id);
      }
    }
    for (const m of [...this.moves]) {
      const st = m.view.store; m.elapsed += dt;
      st.ctx.posOverride ??= new Map();
      const u = Math.min(1, m.elapsed / m.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const pos = { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e };
      if (m.t) { st.ctx.tOverride ??= new Map(); st.ctx.tOverride.set(m.id, m.t[0] + (m.t[1] - m.t[0]) * e); }
      else if (m.value) { st.ctx.valOverride ??= new Map(); st.ctx.valOverride.set(m.id, m.value[0] + (m.value[1] - m.value[0]) * e); }
      else st.ctx.posOverride.set(m.id, pos);
      mark(m.view, m.id);
      if (u >= 1) {
        this.moves = this.moves.filter(x => x !== m);
        st.ctx.posOverride.delete(m.id);
        st.run('移动点', () => {
          const o = st.get(m.id);
          if (m.t && o?.def.k === 'onpath') st.update(m.id, { ...o.def, t: m.t[1] });
          else if (m.value && o?.def.k === 'param') st.update(m.id, { ...o.def, value: m.value[1] });
          else if (m.sys) { const sys = st.get(m.sys); if (sys) dragSysUnit(st, sys, m.id, m.to); }
          else st.moveFree(m.id, m.to.x, m.to.y);
        });
      }
    }
    for (const [v, ids] of touched) { v.store.recompute(ids); v.invalidate(); }
    this.app.motion.refresh();
    if (this.running) this.raf = requestAnimationFrame(t => this.tick(t));
    else this.app.refresh();
  }

  private pathLength(p: Shape | undefined): number {
    if (!p) return 0;
    switch (p.k) {
      case 'line': return Math.max(1, G.dist(p.s.a, p.s.b));
      case 'circle': return G.TAU * p.c.r;
      case 'disk': return G.TAU * p.r;
      case 'arc': case 'sector': return p.r * p.sweep;
      case 'poly': return G.polygonPerimeter(p.pts);
      default: return pathPointAt(p, 0) ? 100 : 0;
    }
  }
}
