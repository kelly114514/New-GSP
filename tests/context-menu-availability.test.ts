import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contextItems, PALETTE } from '../src/ui/menus';
import { analyse, queryCommand, type Ctx } from '../src/commands';
import { createSystem } from '../src/core/construct';
import { Store } from '../src/core/store';
import type { Id } from '../src/core/model';
import menuSpec from '../src/menu-spec.json';

type RawItem = { id: number; state: number; text?: string; children?: RawItem[] };
type ContextEntry = { cmd?: number; label?: (s: ReturnType<typeof analyse>, v: never) => string; palette?: boolean; children?: ContextEntry[]; sep?: boolean };
const raw: Record<string, { menu?: RawItem[]; error?: string }> = {};
for (const file of ['context-menus.json', 'context-menus-more.json', 'context-menus-real.json']) {
  Object.assign(raw, JSON.parse(readFileSync(join(__dirname, `../../reference/raw/runtime/${file}`), 'utf8')));
}
const flattenRaw = (items: RawItem[]): RawItem[] => items.flatMap(i => [i, ...(i.children ? flattenRaw(i.children) : [])]);
const flattenNew = (items: ContextEntry[]): ContextEntry[] => items.flatMap(i => [i, ...(i.children ? flattenNew(i.children) : [])]);
const menuNames = new Map((menuSpec as { items: { id?: number; name?: string; children?: { id?: number; name?: string; children?: never[] }[] }[] }[]).flatMap(m => m.items.flatMap(i => [i, ...(i.children ?? [])])).filter(i => i.id !== undefined).map(i => [i.id!, i.name ?? '']));

function contextFixture(name: string): { st: Store; id: Id } {
  const st = new Store();
  let id: Id = 0;
  st.run(`构造右键菜单场景：${name}`, () => {
    if (name === 'empty') return;
    const a = st.add({ k: 'free', x: 100, y: 100 }).id;
    const b = st.add({ k: 'free', x: 300, y: 100 }).id;
    const c = st.add({ k: 'free', x: 200, y: 300 }).id;
    const segment = () => st.add({ k: 'seg', a, b }).id;
    switch (name) {
      case 'empty': break;
      case 'point': id = a; break;
      case 'segment': id = segment(); break;
      case 'circle': id = st.add({ k: 'circle', c: a, p: b }).id; break;
      case 'interior': id = st.add({ k: 'poly', pts: [a, b, c] }).id; break;
      case 'measurement': id = st.add({ k: 'measure', m: 'distance', refs: [a, b] }, { at: { x: 10, y: 10 } }).id; break;
      case 'parameter': id = st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }, { at: { x: 10, y: 40 } }).id; break;
      case 'ray': id = st.add({ k: 'ray', a, b }).id; break;
      case 'line': id = st.add({ k: 'line', a, b }).id; break;
      case 'arc': id = st.add({ k: 'arc3', a, b, c }).id; break;
      case 'button': id = st.add({ k: 'button', action: { type: 'hideshow', targets: [a], mode: 'toggle' }, text: 'x', at: { x: 10, y: 80 }, w: 60, h: 25 }).id; break;
      case 'function': id = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 10, y: 120 } }).id; break;
      case 'table': {
        const param = st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }, { at: { x: 10, y: 40 } }).id;
        id = st.add({ k: 'table', cols: [param], rows: [[1]] }, { at: { x: 10, y: 150 } }).id;
        break;
      }
      case 'image': id = st.add({ k: 'image', data: '', mime: 'image/png', at: { x: 10, y: 180 }, w: 40, h: 30 }).id; break;
      case 'calc': id = st.add({ k: 'calc', expr: { t: 'num', v: 3 }, unit: 'none' }, { at: { x: 10, y: 220 } }).id; break;
      case 'point_on_path': id = st.add({ k: 'onpath', path: segment(), t: 0.5 }).id; break;
      case 'function_graph': {
        const func = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'x' } }, { at: { x: 10, y: 120 } }).id;
        const sys = createSystem(st).id;
        id = st.add({ k: 'plot', func, sys, samples: 64 }).id;
        break;
      }
      case 'locus': {
        const driver = st.add({ k: 'onpath', path: segment(), t: 0.5 }).id;
        id = st.add({ k: 'locus', driver, out: driver, samples: 64 }).id;
        break;
      }
      case 'iteration_image': {
        const iter = st.add({ k: 'iterate', pre: [a], maps: [[a]], body: [a], depth: { fixed: 1 } }).id;
        id = st.add({ k: 'iterimg', src: a, iter }).id;
        break;
      }
      case 'text': id = st.add({ k: 'text', text: '说明', at: { x: 10, y: 260 }, w: 60, h: 24, font: { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' } }).id; break;
      default: throw new Error(`没有右键菜单场景夹具：${name}`);
    }
  });
  return { st, id };
}

function ctxFor(st: Store, sel: Id[]): Ctx {
  const view = { store: st, sel, marks: {}, textEdit: undefined, hasTraces: st.page.objects.some(o => o.trace), tool: 'move' };
  const app = {
    anim: { running: false, paused: false, isAnimating: () => false, involves: () => false },
    settings: { autoSnap: false, autoLabelMeasured: false },
    clipboardIsImage: () => false, canPaste: () => false,
    textbarVisible: false, motion: { visible: false }, toolboxVisible: true,
    toolSelectAllName: () => undefined,
  };
  return { app: app as never, view: view as never, shift: false };
}

describe('原版右键菜单命令可用状态', () => {
  const contexts = Object.keys(raw).sort();
  let observedDiffs: { scene: string; id: number; original: boolean; newer: boolean; name: string }[] = [];

  afterAll(() => {
    if (!process.env.CONTEXT_AVAILABILITY_AUDIT_OUT) return;
    const inventory = contexts.map(name => {
      const { st, id } = contextFixture(name);
      const selection = id === 0 ? [] : [id];
      const view = { store: st, sel: selection, marks: {}, textEdit: undefined, hasTraces: false, tool: 'move' };
      const c = ctxFor(st, selection);
      const original = flattenRaw(raw[name].menu!).filter(i => i.id !== 0).map(i => ({ id: i.id, label: (i.text ?? '').replace(/\(&.\)/g, '').replace(/…$/, ''), enabled: (i.state & 3) === 0 }));
      const current: Record<string, unknown>[] = [];
      for (const item of contextItems(view as never)) {
        if (item.sep) continue;
        if (item.palette) {
          const enabled = queryCommand(36909, c).enabled;
          current.push({ kind: 'palette', label: '颜色', swatches: PALETTE.length, swatchesEnabled: enabled, otherRow: enabled, otherRowEnabled: enabled });
          continue;
        }
        const q = queryCommand(item.cmd!, c);
        const label = item.label ? item.label(analyse(view as never), view as never) : q.name ?? menuNames.get(item.cmd!) ?? '';
        current.push({ kind: 'command', id: item.cmd, label, enabled: q.enabled, unresolvedLabel: label.length === 0 });
      }
      return { name, original, current };
    });
    const imagePalette = flattenRaw(raw.image.menu!).filter(i => i.id >= 32859 && i.id <= 32874);
    const image = contextFixture('image');
    writeFileSync(process.env.CONTEXT_AVAILABILITY_AUDIT_OUT, JSON.stringify({
      source: 'reference/raw/runtime/context-menus*.json；新版由 queryCommand / contextItems 生成。原版右键命令为运行时编号，未与新版主菜单编号建立完整同义映射。',
      contexts: contexts.length,
      rightClickPalette: {
        currentSwatches: PALETTE.length,
        colorsInOrder: PALETTE,
        imageOriginalSwatches: imagePalette.length,
        imageOriginalAllDisabled: imagePalette.every(i => (i.state & 3) !== 0),
        imageCurrentSwatchesEnabled: queryCommand(36909, ctxFor(image.st, [image.id])).enabled ? PALETTE.length : 0,
        imageOriginalHasOtherRow: imagePalette.some(i => i.text?.includes('其它')),
        imageCurrentHasOtherRow: false,
      },
      diffs: observedDiffs,
      structuralComparisonBoundary: '以下原版与新版菜单项完整清单均已输出；右键菜单原版命令 ID 是按菜单动态分配的 37007+，当前无完整同义映射，结构差异需要人工按名称/用途判读。',
      inventory,
      unverifiedOptionDifferences: [
        '各类右键菜单的全部行尚未按语义建立原版与新版一一映射；inventory 字段供逐项核对。',
        '色块值及顺序见主菜单审计；弹出菜单的色块布局未逐像素比对。',
      ],
    }, null, 2));
  });

  it('20 类原版右键场景均有运行时快照，快照中的普通命令启用状态可读', () => {
    expect(contexts).toEqual(Object.keys(raw).sort());
    for (const name of contexts) {
      const menu = raw[name]?.menu;
      expect(menu, `缺少原版右键快照：${name}`).toBeDefined();
      for (const entry of flattenRaw(menu!)) {
        if (entry.id === 0) continue;
        // 原版颜色调色板在图片上置灰；其它右键普通命令均启用。
        if (name === 'image' && entry.id >= 32859 && entry.id <= 32874) expect(entry.state & 3).not.toBe(0);
        else expect(entry.state & 3, `${name} / 原版命令 ${entry.id}`).toBe(0);
      }
    }
  });

  it('右键菜单已有命令的可用状态与原版快照一致', () => {
    const problems: string[] = [];
    observedDiffs = [];
    for (const name of contexts) {
      const { st, id } = contextFixture(name);
      const selection = id === 0 ? [] : [id];
      const view = { store: st, sel: selection, marks: {}, textEdit: undefined, hasTraces: false, tool: 'move' };
      const c = ctxFor(st, selection);
      const commands = flattenNew(contextItems(view as never)).map(x => x.cmd).filter((x): x is number => x !== undefined);
      for (const command of commands) {
        const q = queryCommand(command, c);
        if (!q.enabled) {
          problems.push(`${name}: ${command} ${q.name ?? ''}`);
          observedDiffs.push({ scene: name, id: command, original: true, newer: false, name: q.name ?? '' });
        }
      }
    }
    expect(problems).toEqual([]);
    const iterimg = contextFixture('iteration_image');
    expect(flattenNew(contextItems({ store: iterimg.st, sel: [iterimg.id], marks: {}, textEdit: undefined, hasTraces: false, tool: 'move' } as never)).map(i => i.cmd)).toContain(36917);
  });

  it('图片上的原版颜色选项及调色板按钮全部置灰', () => {
    const image = contextFixture('image');
    const q = ctxFor(image.st, [image.id]);
    expect(queryCommand(36908, q).enabled).toBe(false);
    expect(queryCommand(36909, q).enabled).toBe(false);
    const rawPalette = flattenRaw(raw.image.menu!).filter(i => i.id >= 32859 && i.id <= 32874);
    expect(rawPalette).toHaveLength(16);
    expect(rawPalette.every(i => (i.state & 3) !== 0)).toBe(true);
    expect(PALETTE).toHaveLength(16);
  });
  it('函数和图片右键菜单提供相应的函数命令', () => {
    for (const [name, cmd] of [['function', 36976], ['image', 36977]] as const) {
      const { st, id } = contextFixture(name);
      const view = { store: st, sel: [id], marks: {}, textEdit: undefined, hasTraces: false, tool: 'move' };
      expect(contextItems(view as never).some(item => item.cmd === cmd)).toBe(true);
      expect(queryCommand(cmd, ctxFor(st, [id])).enabled).toBe(true);
    }
  });
});
