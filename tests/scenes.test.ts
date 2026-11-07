/** 把规格里实测的 42 个选择场景转成命令状态测试：每个命令在每个场景下是否可用，必须与原版一致。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { queryCommand, commands, type Ctx } from '../src/commands';
import { createSystem } from '../src/core/construct';
import { Store } from '../src/core/store';
import type { Id } from '../src/core/model';

interface Item { id?: number; name?: string; enabled_in_scenes?: string[] | string; children?: Item[]; separator?: boolean }
const spec = JSON.parse(readFileSync(join(__dirname, '../../reference/spec/menus.json'), 'utf8')) as { scenes: string[]; menus: { items: Item[] }[] };

interface Extra { sel: Id[]; running?: boolean; animating?: Id[]; canPaste?: boolean; undone?: boolean }
type Scene = (st: Store) => Id[] | Extra;
const free = (st: Store, x: number, y: number) => st.add({ k: 'free', x, y }).id;
const measure = (st: Store, refs: Id[]) => st.add({ k: 'measure', m: 'length', refs }, { at: { x: 10, y: 10 } }).id;
const param = (st: Store) => st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }, { at: { x: 5, y: 5 } }).id;
const tri = (st: Store) => { const a = free(st, 100, 100), b = free(st, 300, 100), c = free(st, 200, 300); return st.add({ k: 'poly', pts: [a, b, c] }).id; };
const seg = (st: Store, ax = 100, ay = 100, bx = 300, by = 100) => st.add({ k: 'seg', a: free(st, ax, ay), b: free(st, bx, by) }).id;
const circle = (st: Store, cx = 200, cy = 200, px = 300, py = 200) => st.add({ k: 'circle', c: free(st, cx, cy), p: free(st, px, py) }).id;
const image = (st: Store) => st.add({ k: 'image', data: '', mime: 'image/png', at: { x: 5, y: 5 }, w: 50, h: 50 }).id;
const button = (st: Store, p: Id) => st.add({ k: 'button', action: { type: 'hideshow', targets: [p], mode: 'toggle' }, text: 'x', at: { x: 5, y: 5 }, w: 80, h: 28 }).id;
const arcOn = (st: Store) => { const ci = circle(st); const p1 = st.add({ k: 'onpath', path: ci, t: 1 }).id, p2 = st.add({ k: 'onpath', path: ci, t: 3 }).id; return { ci, p1, p2 }; };

const SCENES: Record<string, Scene> = {
  '无选择': () => [],
  '1 个自由点': st => [free(st, 100, 100)],
  '2 个自由点': st => [free(st, 100, 100), free(st, 200, 100)],
  '3 个自由点': st => [free(st, 100, 100), free(st, 200, 100), free(st, 150, 200)],
  '3 个自由点（反序选择）': st => [free(st, 100, 100), free(st, 200, 100), free(st, 150, 200)].reverse(),
  '1 条线段': st => [seg(st)],
  '2 条不相交线段': st => [seg(st, 100, 100, 300, 100), seg(st, 100, 200, 300, 200)],
  '2 条相交线段': st => [seg(st, 100, 100, 300, 300), seg(st, 100, 300, 300, 100)],
  '线段 + 线外 1 点': st => [seg(st), free(st, 200, 300)],
  '1 条射线': st => [st.add({ k: 'ray', a: free(st, 100, 100), b: free(st, 300, 100) }).id],
  '1 条直线': st => [st.add({ k: 'line', a: free(st, 100, 100), b: free(st, 300, 100) }).id],
  '直线 + 线外 1 点': st => [st.add({ k: 'line', a: free(st, 100, 100), b: free(st, 300, 100) }).id, free(st, 200, 300)],
  '2 条相交直线': st => [st.add({ k: 'line', a: free(st, 100, 100), b: free(st, 300, 300) }).id, st.add({ k: 'line', a: free(st, 100, 300), b: free(st, 300, 100) }).id],
  '1 个圆': st => [circle(st)],
  '圆 + 圆外 1 点': st => [circle(st), free(st, 500, 500)],
  '2 个相交圆': st => [circle(st, 200, 200, 300, 200), circle(st, 300, 200, 400, 200)],
  '圆 + 圆上 2 点': st => { const { ci, p1, p2 } = arcOn(st); return [ci, p1, p2]; },
  '1 段圆上的弧': st => { const { ci, p1, p2 } = arcOn(st); return [st.add({ k: 'arc-circle', circle: ci, a: p1, b: p2 }).id]; },
  '三角形内部': st => [tri(st)],
  '1 个长度度量值': st => [measure(st, [seg(st)])],
  '2 个长度度量值': st => { const s = seg(st); return [measure(st, [s]), measure(st, [s])]; },
  '有坐标系时 1 个自由点': st => { const p = free(st, 100, 100); createSystem(st); return [p]; },
  '1 点 + 1 参数（参数最后选）': st => [free(st, 100, 100), param(st)],
  '1 个参数': st => [param(st)],
  '有隐藏对象、无选择': st => { st.add({ k: 'free', x: 1, y: 1 }, { hidden: true }); return []; },
  '有追踪踪迹、无选择': st => { st.add({ k: 'free', x: 1, y: 1 }, { trace: true }); return []; },
  '线上的点': st => [st.add({ k: 'onpath', path: seg(st), t: 0.5 }).id],
  '1 个操作类按钮': st => [button(st, free(st, 1, 1))],
  '2 个操作类按钮': st => { const p = free(st, 1, 1); return [button(st, p), button(st, p)]; },
  '1 个函数': st => [st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 5, y: 5 } }).id],
  '1 个计算结果': st => [st.add({ k: 'calc', expr: { t: 'num', v: 3 }, unit: 'none' }, { at: { x: 5, y: 5 } }).id],
  '1 张空表格': st => [st.add({ k: 'table', cols: [param(st)], rows: [] }, { at: { x: 5, y: 40 } }).id],
  '有数据的表格': st => [st.add({ k: 'table', cols: [param(st)], rows: [[1]] }, { at: { x: 5, y: 40 } }).id],
  '反射得到的点': st => { const s = seg(st); return [st.add({ k: 'reflect', src: free(st, 200, 300), mirror: s }).id]; },
  '1 张图片': st => [image(st)],
  '图片 + 三角形内部': st => [image(st), tri(st)],
  '选中坐标系对象': st => [createSystem(st).id],
  '绘制出的函数图像': st => { const sys = createSystem(st); const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 5, y: 5 } }); return [st.add({ k: 'plot', func: f.id, sys: sys.id, samples: 300 }).id]; },
  '动画进行中、选中动画点': st => { const p = free(st, 100, 100); return { sel: [p], running: true, animating: [p] }; },
  '已复制、无选择': () => ({ sel: [], canPaste: true }),
  '刚撤消过': st => { const a = free(st, 100, 100), b = free(st, 300, 100); st.begin('构造线段'); st.add({ k: 'seg', a, b }); st.commit(); st.doUndo(); return { sel: [a, b], undone: true }; },
};

const flat = (items: Item[]): Item[] => items.flatMap(i => [i, ...(i.children ? flat(i.children) : [])]);
const all = spec.menus.flatMap(mm => flat(mm.items)).filter(i => i.id !== undefined && i.enabled_in_scenes !== undefined);
// 取决于应用状态（剪贴板、撤消栈、动画、保存状态、隐藏/追踪内容）的命令另行断言
// 这些命令的可用与否取决于整个应用的历史（剪贴板、撤消栈、动画、保存状态、隐藏/追踪内容），原版采集时前面场景留下的状态会带进后面的场景；改在下面的“应用状态”用例里直接断言
const STATEFUL = new Set([36868, 36876, 36877, 36880, 36912, 36916, 36918, 36919, 36920]);
// 动画命令的状态已按原版重测（probe_animstate）对齐，不再有已知差异
/** 36950 的规格已按 probe_custom3.py 重测修正，两个不相干自由点不再豁免。 */
const KNOWN_DIFF: Record<string, number[]> = {};   // 36977：原版选中位图时也可用（“定义图片函数”），新版只做手绘笔迹的绘图函数

function ctxFor(st: Store, sel: Id[], x: Partial<Extra> = {}): Ctx {
  const view = { store: st, sel, marks: {}, textEdit: undefined, hasTraces: st.page.objects.some(o => o.trace), tool: 'move' };
  const app = { anim: { isAnimating: (id: Id) => !!x.animating?.includes(id), running: !!x.running, paused: false, involves: (_v: unknown, objs: { id: Id }[]) => objs.some(o => !!x.animating?.includes(o.id)) }, settings: { autoSnap: false }, clipboardIsImage: () => false, canPaste: () => !!x.canPaste, textbarVisible: false, motion: { visible: false }, toolboxVisible: true, toolSelectAllName: () => undefined };
  return { app: app as never, view: view as never, shift: false };
}

const report: string[] = [];
describe('42 个选择场景下的命令可用状态', () => {
  afterAll(() => { if (process.env.MISMATCH_OUT) writeFileSync(process.env.MISMATCH_OUT, report.join(String.fromCharCode(10))); });
  it('场景名与规格一致', () => { for (const n of Object.keys(SCENES)) expect(spec.scenes).toContain(n); });
  for (const [name, build] of Object.entries(SCENES)) {
    it(`场景：${name}`, () => {
      const st = new Store();
      let made: Id[] | Extra = [];
      if (name === '刚撤消过') made = build(st); else st.run('scene', () => { made = build(st); });
      const extra: Extra = Array.isArray(made) ? { sel: made } : made;
      const ctx = ctxFor(st, extra.sel, extra);
      const bad: string[] = [];
      for (const it of all) {
        const d = commands.get(it.id!);
        if (!d || d.deferred || STATEFUL.has(it.id!) || KNOWN_DIFF[name]?.includes(it.id!)) continue;
        const expected = it.enabled_in_scenes === '全部场景' ? true : Array.isArray(it.enabled_in_scenes) ? it.enabled_in_scenes.includes(name) : true;
        const got = queryCommand(it.id!, ctx).enabled;
        if (got !== expected) bad.push(`${it.id} ${it.name}：应${expected ? '可用' : '灰'}，实际${got ? '可用' : '灰'}`);
      }
      report.push(...bad.map(b => `[${name}] ${b}`));
      expect(bad).toEqual([]);
    });
  }
});

describe('应用状态相关的命令', () => {
  const view = (st: Store, sel: Id[] = []) => ({ store: st, sel, marks: {}, textEdit: undefined, hasTraces: st.page.objects.some(o => o.trace), tool: 'move' });
  const app = (x: Partial<Extra> = {}) => ({ anim: { isAnimating: (id: Id) => !!x.animating?.includes(id), running: !!x.running, paused: false, involves: (_v: unknown, objs: { id: Id }[]) => objs.some(o => !!x.animating?.includes(o.id)) }, settings: { autoSnap: false }, clipboardIsImage: () => false, canPaste: () => !!x.canPaste, textbarVisible: false, motion: { visible: false }, toolboxVisible: true, toolSelectAllName: () => undefined });
  const q = (id: number, st: Store, sel: Id[] = [], x: Partial<Extra> = {}) => queryCommand(id, { app: app(x) as never, view: view(st, sel) as never, shift: false });
  it('动画进行中：加速、减速、停止动画可用；没有动画时灰', () => {
    const st = new Store();
    for (const id of [36918, 36919, 36920]) { expect(q(id, st).enabled).toBe(false); expect(q(id, st, [], { running: true }).enabled).toBe(true); }
    expect(q(36917, st, [], { running: true }).name).toBe('暂停动画');   // 没有选择、有动画在跑：管全部
    expect(q(36918, st, [], { running: true }).name).toBe('全部加速'); expect(q(36920, st, [], { running: true }).name).toBe('停止所有运动');
    const p = st.run('点', () => st.add({ k: 'free', x: 1, y: 1 }).id), r = st.run('点', () => st.add({ k: 'free', x: 9, y: 9 }).id);
    expect(q(36917, st, [r], { running: true, animating: [p] }).enabled).toBe(true);                                     // 选中没在动的点：“动画”照常
    expect(q(36918, st, [r], { running: true, animating: [p] }).enabled).toBe(false);                                     // 加速、减速、停止灰
    expect(q(36917, st, [p], { running: true, animating: [p] }).enabled).toBe(false);                                     // 选中正在动的点：“动画”灰
    for (const id of [36918, 36919, 36920]) expect(q(id, st, [p], { running: true, animating: [p] }).enabled).toBe(true);
  });
  it('已复制：粘贴可用；没有可粘贴的内容时灰', () => { const st = new Store(); expect(q(36880, st).enabled).toBe(false); expect(q(36880, st, [], { canPaste: true }).enabled).toBe(true); });
  it('刚撤消过：重做可用并带操作名；撤消按钮随撤消栈变化', () => {
    const st = new Store();
    expect(q(36876, st).enabled).toBe(false); expect(q(36877, st).enabled).toBe(false);
    st.begin('构造点'); st.add({ k: 'free', x: 1, y: 1 }); st.commit();
    expect(q(36876, st).name).toBe('撤消构造点'); st.doUndo();
    expect(q(36877, st).enabled).toBe(true); expect(q(36877, st).name).toBe('重做构造点'); expect(q(36876, st).enabled).toBe(false);
  });
  it('有隐藏对象时“显示所有隐藏”可用；有追踪时“擦除追踪踪迹”可用，与选择无关', () => {
    const st = new Store();
    expect(q(36912, st).enabled).toBe(false); expect(q(36916, st).enabled).toBe(false);
    st.run('x', () => { st.add({ k: 'free', x: 1, y: 1 }, { hidden: true }); st.add({ k: 'free', x: 2, y: 2 }, { trace: true }); });
    expect(q(36912, st).enabled).toBe(true); expect(q(36916, st).enabled).toBe(true);
  });
  it('保存：文档有改动或还没有文件名时可用', () => {
    const st = new Store();
    const clean = queryCommand(36868, { app: app() as never, view: { ...view(st), path: 'x.gsp' } as never, shift: false });
    expect(clean.enabled).toBe(false);
    st.run('x', () => { st.add({ k: 'free', x: 1, y: 1 }); });
    expect(queryCommand(36868, { app: app() as never, view: { ...view(st), path: 'x.gsp' } as never, shift: false }).enabled).toBe(true);
  });
});
