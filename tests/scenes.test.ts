/** 把原版实测的选择场景转成命令状态测试：菜单命令在每个场景下的可用性应与原版一致。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { executeCommand, queryCommand, commands, CMD_CUSTOM, type Ctx } from '../src/commands';
import { createSystem } from '../src/core/construct';
import { Store } from '../src/core/store';
import type { Id } from '../src/core/model';
import { PALETTE } from '../src/ui/menus';
import { App } from '../src/app';
import { decodeFile, encodeFile } from '../src/gsp/codec';

interface Item { id?: number; name?: string; enabled_in_scenes?: string[] | string; children?: Item[]; separator?: boolean }
const spec = JSON.parse(readFileSync(join(__dirname, '../../reference/spec/menus.json'), 'utf8')) as { scenes: string[]; menus: { items: Item[] }[] };
const runtimeMenus = JSON.parse(readFileSync(join(__dirname, '../src/menu-spec.json'), 'utf8')) as { items: Item[] }[];
type RawMenuItem = { id: number; text: string; state: number; children?: RawMenuItem[] };
type RawScene = { normal: RawMenuItem[]; shift: RawMenuItem[] };
const rawScenes = new Map<string, RawScene>();
for (const file of ['scenes-points.json', 'scenes-verified.json', 'scenes-more.json']) {
  const values = JSON.parse(readFileSync(join(__dirname, `../../reference/raw/runtime/${file}`), 'utf8')) as Record<string, RawScene>;
  for (const [key, value] of Object.entries(values)) rawScenes.set(key, value);
}
const probeScenes = JSON.parse(readFileSync(join(__dirname, '../../reference/raw/runtime/menu-availability-probes.json'), 'utf8')) as { probes: Record<string, RawScene> };
for (const [key, value] of Object.entries(probeScenes.probes)) rawScenes.set(key, value);
const RAW_KEY: Record<string, string> = {
  '无选择': 'empty', '1 个自由点': 'one_point', '2 个自由点': 'two_points', '3 个自由点': 'three_points',
  '3 个自由点（反序选择）': 'three_points_reversed', '1 条线段': 'one_segment', '2 条不相交线段': 'two_segments',
  '2 条相交线段': 'two_crossing_segments', '线段 + 线外 1 点': 'point_segment', '1 条射线': 'one_ray',
  '1 条直线': 'one_line', '直线 + 线外 1 点': 'point_line', '2 条相交直线': 'two_crossing_lines',
  '1 个圆': 'one_circle', '圆 + 圆外 1 点': 'circle_point', '2 个相交圆': 'two_circles',
  '圆 + 圆上 2 点': 'circle_two_points_on', '1 段圆上的弧': 'one_arc', '三角形内部': 'triangle_interior',
  '1 个长度度量值': 'one_measurement', '2 个长度度量值': 'two_measurements', '有坐标系时 1 个自由点': 'point_with_axes',
  '1 点 + 1 参数（参数最后选）': 'point_and_param', '1 个参数': 'one_param', '有隐藏对象、无选择': 'hidden_exists',
  '有追踪踪迹、无选择': 'trace_erasable', '动画进行中、选中动画点': 'animating', '已复制、无选择': 'paste_available',
  '刚撤消过': 'redo_available', '线上的点': 'point_on_path', '1 个操作类按钮': 'one_button', '2 个操作类按钮': 'two_buttons',
  '1 个函数': 'function_selected', '绘制出的函数图像': 'function_plotted', '1 个计算结果': 'calc_selected',
  '1 张空表格': 'table_selected', '有数据的表格': 'table_with_data',
  '已创建自定义变换、选中点及其象': 'custom_transform', '反射得到的点': 'reflected_point',
  '1 张图片': 'image_selected', '图片 + 三角形内部': 'image_and_polygon', '选中坐标系对象': 'axes_object',
  '点 + 距离度量值': 'point_distance', '点 + 角度度量值': 'point_angle',
  '两个圆心 + 一个距离值': 'two_centers_one_distance', '一个圆心 + 两个长度值': 'one_center_two_lengths',
};
const flat = (items: Item[]): Item[] => items.flatMap(i => [i, ...(i.children ? flat(i.children) : [])]);
const flatRaw = (items: RawMenuItem[]): RawMenuItem[] => items.flatMap(i => [i, ...(i.children ? flatRaw(i.children) : [])]);
const runtimeMenuItems = runtimeMenus.flatMap(m => flat(m.items)).filter(i => i.id !== undefined && !i.children?.length);
const originalMenuItems = spec.menus.flatMap(m => flat(m.items)).filter(i => i.id !== undefined && !i.children?.length);
// 3201 是首个按文档内容动态生成的自定义变换命令，仅在 custom_transform 快照中出现。
const rawComparisonIds = [...new Set([...runtimeMenuItems.map(i => i.id!), CMD_CUSTOM])];
const ORIGINAL_ID: Record<number, number> = { [-1]: 57664 };
// 这些是原版发行版带的外部链接；新版依项目规则不复制原版的帮助/社区链接入口。
const INTENTIONAL_OMISSIONS = new Set([36866, 36867, 45056, 45057, 45058, 45059, 45061, 45062, 45063, 45064, 45066, 45067, 45068, 45069, 45071]);

interface Extra { sel: Id[]; running?: boolean; animating?: Id[]; canPaste?: boolean; clipboardImage?: boolean; undone?: boolean }
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
  '2 个操作类按钮': st => { const p = free(st, 1, 1); st.setHidden([p], true); return [button(st, p), button(st, p)]; },
  '1 个函数': st => [st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 5, y: 5 } }).id],
  '1 个计算结果': st => [st.add({ k: 'calc', expr: { t: 'num', v: 3 }, unit: 'none' }, { at: { x: 5, y: 5 } }).id],
  '1 张空表格': st => [st.add({ k: 'table', cols: [param(st)], rows: [] }, { at: { x: 5, y: 40 } }).id],
  '有数据的表格': st => [st.add({ k: 'table', cols: [param(st)], rows: [[1]] }, { at: { x: 5, y: 40 } }).id],
  '点 + 距离度量值': st => {
    const a = free(st, 100, 100), b = free(st, 300, 100), center = free(st, 200, 300);
    const distance = st.add({ k: 'measure', m: 'distance', refs: [a, b] }, { at: { x: 10, y: 10 } }).id;
    return [distance, center];
  },
  '点 + 角度度量值': st => {
    const a = free(st, 100, 100), vertex = free(st, 200, 100), b = free(st, 200, 200), center = free(st, 300, 300);
    const angle = st.add({ k: 'measure', m: 'angle', refs: [a, vertex, b] }, { at: { x: 10, y: 10 } }).id;
    return [angle, center];
  },
  '两个圆心 + 一个距离值': st => {
    const a = free(st, 100, 100), b = free(st, 300, 100), c = free(st, 100, 300), d = free(st, 300, 300);
    const distance = st.add({ k: 'measure', m: 'distance', refs: [a, b] }, { at: { x: 10, y: 10 } }).id;
    return [distance, c, d];
  },
  '一个圆心 + 两个长度值': st => {
    const a = free(st, 100, 100), b = free(st, 250, 100), c = free(st, 100, 200), d = free(st, 250, 200), center = free(st, 300, 300);
    const s1 = st.add({ k: 'seg', a, b }).id, s2 = st.add({ k: 'seg', a: c, b: d }).id;
    const m1 = st.add({ k: 'measure', m: 'length', refs: [s1] }, { at: { x: 10, y: 10 } }).id;
    const m2 = st.add({ k: 'measure', m: 'length', refs: [s2] }, { at: { x: 10, y: 40 } }).id;
    return [m1, m2, center];
  },
  '反射得到的点': st => { const s = seg(st); return [st.add({ k: 'reflect', src: free(st, 200, 300), mirror: s }).id]; },
  '1 张图片': st => ({ sel: [image(st)], canPaste: true, clipboardImage: true }),
  '图片 + 三角形内部': st => ({ sel: [image(st), tri(st)], canPaste: true, clipboardImage: true }),
  '选中坐标系对象': st => [createSystem(st).id],
  '已创建自定义变换、选中点及其象': st => {
    const mirror = seg(st), src = free(st, 200, 300), img = st.add({ k: 'reflect', src, mirror }).id;
    st.page.transforms = [{ name: '反射', src, img }];
    return [src, img];
  },
  '绘制出的函数图像': st => { const sys = createSystem(st); const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 5, y: 5 } }); return [st.add({ k: 'plot', func: f.id, sys: sys.id, samples: 300 }).id]; },
  '动画进行中、选中动画点': st => { const p = free(st, 100, 100); return { sel: [p], running: true, animating: [p] }; },
  '已复制、无选择': st => { seg(st); return { sel: [], canPaste: true }; },
  '刚撤消过': st => {
    let a = 0, b = 0;
    st.run('构造点', () => { a = free(st, 100, 100); b = free(st, 300, 100); });
    st.run('构造线段', () => { st.add({ k: 'seg', a, b }); });
    st.doUndo();
    return { sel: [a, b], undone: true };
  },
};

const all = spec.menus.flatMap(mm => flat(mm.items)).filter(i => i.id !== undefined && i.enabled_in_scenes !== undefined);
// 取决于应用状态（剪贴板、撤消栈、动画、保存状态、隐藏/追踪内容）的命令另行断言
// 这些命令的可用与否取决于整个应用的历史（剪贴板、撤消栈、动画、保存状态、隐藏/追踪内容），原版采集时前面场景留下的状态会带进后面的场景；改在下面的“应用状态”用例里直接断言
const STATEFUL = new Set([36868, 36876, 36877, 36880, 36912, 36916, 36918, 36919, 36920]);
const PASTE_BASELINES = new Set(['已复制、无选择', '1 张图片', '图片 + 三角形内部']);
const AUDITED_DIFF_IDS = new Set([32882, 32883, 32884, 32892, 32893, 36893, 36914, 36941, 36944, 36963]);
// 动画命令的状态已按原版重测（probe_animstate）对齐，不再有已知差异
/** 36950 的规格已按 probe_custom3.py 重测修正，两个不相干自由点不再豁免。 */
const KNOWN_DIFF: Record<string, number[]> = {
  '已创建自定义变换、选中点及其象': [36893], // 原版此关联点对的常规分离/合并命令为灰；新版允许合并
};   // 36977：原版选中位图时也可用（“定义图片函数”），新版只做手绘笔迹的绘图函数

function ctxFor(st: Store, sel: Id[], x: Partial<Extra> = {}, shift = false): Ctx {
  const view = { store: st, sel, marks: {}, textEdit: undefined, hasTraces: st.page.objects.some(o => o.trace), tool: 'move' };
  const app = { anim: { isAnimating: (id: Id) => !!x.animating?.includes(id), running: !!x.running, paused: false, involves: (_v: unknown, objs: { id: Id }[]) => objs.some(o => !!x.animating?.includes(o.id)) }, settings: { autoSnap: false }, clipboardIsImage: () => !!x.clipboardImage, canPaste: () => !!x.canPaste, textbarVisible: false, motion: { visible: false }, toolboxVisible: true, toolSelectAllName: () => undefined };
  return { app: app as never, view: view as never, shift };
}

const report: string[] = [];
let comparedCells = 0;
const rawDiffs: { scene: string; shift: boolean; id: number; name: string; original: boolean; newer: boolean }[] = [];
function paletteAudit() {
  const slots = Array.from({ length: 16 }, (_, i) => 32859 + i);
  const disabledById = Object.fromEntries(slots.map(id => [id, 0])) as Record<number, number>;
  const disabledSnapshots: { scene: string; shift: boolean }[] = [];
  let snapshots = 0;
  let mismatches = 0;
  for (const name of Object.keys(SCENES)) {
    const key = RAW_KEY[name], raw = key ? rawScenes.get(key) : undefined;
    if (!raw) continue;
    for (const shift of [false, true]) {
      const items = new Map(flatRaw(raw[shift ? 'shift' : 'normal']).map(i => [i.id, i]));
      const st = new Store();
      let made: Id[] | Extra = [];
      if (name === '刚撤消过') made = SCENES[name](st); else st.run('scene', () => { made = SCENES[name](st); });
      const extra: Extra = Array.isArray(made) ? { sel: made } : made;
      const enabled = queryCommand(36909, ctxFor(st, extra.sel, extra, shift)).enabled;
      snapshots++;
      for (const id of slots) if ((items.get(id)?.state ?? 1) & 3) disabledById[id]++;
      for (const id of slots) if (((items.get(id)?.state ?? 1) & 3) === 0 !== enabled) mismatches++;
      if (slots.some(id => ((items.get(id)?.state ?? 1) & 3) !== 0)) disabledSnapshots.push({ scene: name, shift });
    }
  }
  const currentSlots = PALETTE.length;
  return {
    originalSlots: slots.length,
    currentSlots,
    snapshots,
    cellsPerOriginalSlot: snapshots,
    originalDisabledSnapshots: disabledSnapshots,
    originalDisabledCellsById: disabledById,
    currentSwatchesHaveDisabledState: true,
    currentSwatchDisabledStateMismatchCells: mismatches,
    originalSwatchControlsWithoutCurrentCounterpart: Math.max(0, slots.length - currentSlots),
    unrepresentedOriginalSwatchCells: snapshots * Math.max(0, slots.length - currentSlots),
    colorsById: Object.fromEntries(slots.map((id, i) => [id, PALETTE[i]])),
    mappingNote: '色值及顺序与原版程序色表和逐色采集课件 tc01-colors.gsp 一致。',
  };
}
describe('原版选择场景下的命令可用状态', () => {
  afterAll(() => {
    if (process.env.MISMATCH_OUT) writeFileSync(process.env.MISMATCH_OUT, report.join(String.fromCharCode(10)));
    if (process.env.AVAILABILITY_AUDIT_OUT) writeFileSync(process.env.AVAILABILITY_AUDIT_OUT, JSON.stringify({
      source: '原版运行时菜单快照与新版 queryCommand；含 4 个距离/半径定向补采场景',
      scenes: Object.keys(SCENES).length,
      currentMenuItems: runtimeMenuItems.length,
      dynamicCommandSlots: 1,
      matrixCells: Object.keys(SCENES).length * rawComparisonIds.length * 2,
      comparedCells,
      colorPalette: paletteAudit(),
      diffs: rawDiffs,
    }, null, 2));
  });
  it('场景名与规格一致', () => { for (const n of Object.keys(SCENES)) expect(spec.scenes).toContain(n); });
  it('原版菜单所有 147 个叶项均纳入对照或列为外链省略', () => {
    const mapped = new Set(runtimeMenuItems.map(i => ORIGINAL_ID[i.id!] ?? i.id!));
    const uncovered = originalMenuItems.map(i => i.id!).filter(id => !mapped.has(id) && !INTENTIONAL_OMISSIONS.has(id));
    const missingFromNew = originalMenuItems.map(i => i.id!).filter(id => !mapped.has(id));
    expect(originalMenuItems).toHaveLength(147);
    expect(runtimeMenuItems).toHaveLength(132);
    expect(uncovered).toEqual([]);
    expect(new Set(missingFromNew)).toEqual(INTENTIONAL_OMISSIONS);
  });
  it('主菜单 16 个色块的状态与原版快照一致', () => {
    const audit = paletteAudit();
    expect(audit.snapshots).toBe(Object.keys(SCENES).length * 2);
    expect(Object.values(audit.originalDisabledCellsById)).toHaveLength(16);
    expect(audit.currentSlots).toBe(16);
    expect(audit.currentSwatchDisabledStateMismatchCells).toBe(0);
  });
  for (const [name, build] of Object.entries(SCENES)) {
    it(`场景：${name}`, () => {
      const st = new Store();
      let made: Id[] | Extra = [];
      if (name === '刚撤消过') made = build(st); else st.run('scene', () => { made = build(st); });
      const extra: Extra = Array.isArray(made) ? { sel: made } : made;
      const ctx = ctxFor(st, extra.sel, extra);
      const rawKey = RAW_KEY[name];
      const raw = rawKey ? rawScenes.get(rawKey) : undefined;
      expect(raw, `缺少原版运行时基线：${name}`).toBeDefined();
      for (const shift of [false, true]) {
        const original = new Map(flatRaw(raw![shift ? 'shift' : 'normal']).map(i => [i.id, i]));
        const stateCtx = ctxFor(st, extra.sel, extra, shift);
        for (const id of rawComparisonIds) {
          // 旧批量快照曾在进程间继承系统剪贴板；仅比较明确定义剪贴板内容的三个场景。
          if (id === 36880 && !PASTE_BASELINES.has(name)) continue;
          const baseId = ORIGINAL_ID[id] ?? id;
          const base = original.get(baseId);
          if (!base) continue;
          comparedCells++;
          // 2026-11-05 的 probe_custom3.py 重测取代旧的 two_points 快照。
          const expected = id === 36950 && name === '2 个自由点' ? false : (base.state & 3) === 0;
          const actual = queryCommand(id, stateCtx).enabled;
          if (actual !== expected) rawDiffs.push({ scene: name, shift, id, name: base.text.split('\t')[0], original: expected, newer: actual });
        }
      }
      const bad: string[] = [];
      for (const it of all) {
        const d = commands.get(it.id!);
        if (!d || d.deferred || STATEFUL.has(it.id!) || AUDITED_DIFF_IDS.has(it.id!) || KNOWN_DIFF[name]?.includes(it.id!)) continue;
        const expected = it.enabled_in_scenes === '全部场景' ? true : Array.isArray(it.enabled_in_scenes) ? it.enabled_in_scenes.includes(name) : true;
        const got = queryCommand(it.id!, ctx).enabled;
        if (got !== expected) bad.push(`${it.id} ${it.name}：应${expected ? '可用' : '灰'}，实际${got ? '可用' : '灰'}`);
      }
      report.push(...bad.map(b => `[${name}] ${b}`));
      expect(bad).toEqual([]);
    });
  }
  it('已对照的主菜单命令状态与原版一致', () => {
    expect(rawDiffs).toEqual([]);
  });
  it('菜单色块按原版逐色采集课件的顺序排列', () => {
    const name = 'tc01-colors.gsp';
    const { doc } = decodeFile(readFileSync(join(__dirname, '../../reference/raw/runtime/fixtures-v2', name)), name);
    const texts = doc.pages[0].objects.flatMap(o => o.def.k === 'text' ? [o.def] : []);
    expect(texts.map(t => t.text)).toEqual(Array.from({ length: 16 }, (_, i) => `c${i}`));
    expect(PALETTE).toEqual(texts.map(t => t.font.color));
  });
});

it('Shift 合并点和参数，保留参数及其依赖，并用原版附着文本格式保存', async () => {
  const st = new Store();
  const point = st.add({ k: 'free', x: 100, y: 100 });
  const param = st.add({ k: 'param', name: 't', value: 2, unit: 'none', showEdit: true }, { at: { x: 20, y: 20 } });
  const calc = st.add({ k: 'calc', expr: { t: 'ref', id: param.id }, unit: 'none' }, { at: { x: 20, y: 60 } });
  const view = { store: st, sel: [point.id, param.id], setSel(ids: Id[]) { this.sel = ids; } };
  const app = Object.assign(Object.create(App.prototype), {
    settings: { font: { name: 'Arial', size: 16, color: '#000000', bold: false, italic: false, underline: false } },
    refresh() {},
  });
  const ctx: Ctx = { app, view: view as never, shift: true };
  expect(queryCommand(36893, { ...ctx, shift: false }).enabled).toBe(false);
  expect(queryCommand(36893, ctx)).toMatchObject({ name: '合并文本到点', enabled: true });
  await executeCommand(36893, ctx);
  const [id] = view.sel;
  expect(st.get(id)?.def).toMatchObject({ k: 'text', anchor: point.id, refs: [param.id], text: '0' });
  expect(st.get(param.id)).toMatchObject({ def: { k: 'param', value: 2 }, at: { x: 20, y: 20 }, hidden: false });
  st.update(point.id, { k: 'free', x: 140, y: 130 });
  st.update(param.id, { k: 'param', name: 't', value: 5, unit: 'none', showEdit: true });
  expect(st.results.get(id)?.shape).toMatchObject({ k: 'box', at: { x: 120, y: 118 } });
  expect(st.results.get(calc.id)?.shape).toMatchObject({ k: 'num', q: { v: 5 } });
  const encoded = encodeFile(st.doc, undefined);
  expect(encoded.ok).toBe(true);
  if (encoded.ok) expect(decodeFile(encoded.bytes, '合并.gsp').doc.pages[0].objects.at(-1)?.def)
    .toMatchObject({ k: 'text', anchor: point.id, refs: [param.id], off: { x: -20, y: -12 } });
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
    createSystem(st);
    expect(q(36912, st).enabled).toBe(false); // 方形坐标系的内部纵向单位点默认隐藏，不属于用户隐藏对象
    st.run('x', () => { st.add({ k: 'free', x: 1, y: 1 }, { hidden: true }); st.add({ k: 'free', x: 2, y: 2 }, { trace: true }); });
    expect(q(36912, st).enabled).toBe(true); expect(q(36916, st).enabled).toBe(true);
  });
  it('保存：空白未修改文档置灰，发生改动后可用', () => {
    const st = new Store();
    const clean = queryCommand(36868, { app: app() as never, view: { ...view(st) } as never, shift: false });
    expect(clean.enabled).toBe(false);
    st.run('x', () => { st.add({ k: 'free', x: 1, y: 1 }); });
    expect(queryCommand(36868, { app: app() as never, view: { ...view(st) } as never, shift: false }).enabled).toBe(true);
  });
  it('以圆心和半径绘圆接受正的距离计算结果（截图中的 AB − CA 场景）', async () => {
    const st = new Store();
    let center = 0, radius = 0;
    st.run('构造距离差', () => {
      const a = free(st, 0, 0), b = free(st, 260, 0), c = free(st, 140, 80);
      const ab = st.add({ k: 'measure', m: 'distance', refs: [a, b] }).id;
      const ca = st.add({ k: 'measure', m: 'distance', refs: [c, a] }).id;
      radius = st.add({ k: 'calc', expr: { t: 'bin', op: '-', a: { t: 'ref', id: ab }, b: { t: 'ref', id: ca } }, unit: 'distance' }).id;
      center = c;
    });
    const v = { ...view(st, [radius, center]), setSel(ids: Id[]) { this.sel = ids; } };
    const fakeApp = { ...app(), refresh() {} };
    expect(queryCommand(36934, { app: fakeApp as never, view: v as never, shift: false }).enabled).toBe(true);
    await executeCommand(36934, { app: fakeApp as never, view: v as never, shift: false });
    const made = st.page.objects.find(o => o.def.k === 'circle-seg' && o.def.c === center && o.def.seg === radius);
    expect(made).toBeDefined();
    expect(st.results.get(made!.id)?.shape?.k).toBe('circle');
  });
  it('点的值使用选定路径并产生可求值的度量', async () => {
    const st = new Store(); let path = 0, point = 0;
    st.run('构造', () => { path = seg(st, 0, 0, 100, 0); point = free(st, 25, 50); });
    const v = { ...view(st, [path, point]), setSel(ids: Id[]) { this.sel = ids; } };
    const fakeApp = { ...app(), refresh() {}, nextTextPos: () => ({ x: 10, y: 10 }) };
    const c = { app: fakeApp as never, view: v as never, shift: true };
    expect(queryCommand(36963, c).enabled).toBe(true);
    await executeCommand(36963, c);
    expect(st.get(v.sel[0])?.def).toMatchObject({ k: 'measure', m: 'pointvalue', refs: [point, path] });
    expect(st.results.get(v.sel[0])?.shape).toMatchObject({ k: 'num', q: { v: 0.25 } });
  });
  it('同时选择点和度量值时标记所选度量', async () => {
    const st = new Store(); let point = 0, distance = 0, angle = 0;
    st.run('构造', () => {
      const a = free(st, 0, 0), b = free(st, 100, 0), c = free(st, 100, 100); point = c;
      distance = st.add({ k: 'measure', m: 'distance', refs: [a, b] }).id;
      angle = st.add({ k: 'measure', m: 'angle', refs: [a, b, c] }).id;
    });
    const v = view(st, [point, distance]);
    const c = { app: { ...app(), refresh() {}, flashStatus() {} } as never, view: v as never, shift: false };
    await executeCommand(36944, c);
    expect(v.marks).toEqual({ distance });
    v.sel = [point, angle];
    await executeCommand(36941, c);
    expect(v.marks).toEqual({ distance, angle: { m: angle } });
  });
  it('本页 32 个动态自定义变换命令均可用，超过上限的空槽置灰', () => {
    const st = new Store();
    let src = 0, img = 0;
    st.run('建立变换链', () => {
      const mirror = seg(st), point = free(st, 200, 300);
      src = point; img = st.add({ k: 'reflect', src: point, mirror }).id;
      st.page.transforms = Array.from({ length: 32 }, (_, i) => ({ name: `变换${i + 1}`, src, img }));
    });
    const c = { app: { ...app(), refresh() {} } as never, view: view(st, [src]) as never, shift: false };
    for (let i = 0; i < 32; i++) {
      expect(commands.has(CMD_CUSTOM + i)).toBe(true);
      expect(queryCommand(CMD_CUSTOM + i, c).enabled).toBe(true);
      expect(queryCommand(CMD_CUSTOM + i, c).name).toBe(`变换${i + 1}`);
    }
    expect(queryCommand(CMD_CUSTOM + 32, c).enabled).toBe(false);
  });
});
