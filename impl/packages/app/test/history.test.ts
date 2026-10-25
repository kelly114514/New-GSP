import { describe, expect, it } from 'vitest';
import { EditHistory } from '../src/model/history';
import { isTextInputElement, shortcutAction } from '../src/model/shortcuts';
import { windowTitleFor } from '../src/model/title';
import { MENU_LABELS, menuItems } from '../src/menus';
import type { MenuAvailability } from '../src/menus';

const entry = (page: number, object: number, bx: number, ax: number) => ({
  page,
  object,
  before: { x: bx, y: 0 },
  after: { x: ax, y: 0 },
});

describe('EditHistory', () => {
  it('撤销/重做按顺序取项，并记录页次、对象与前后坐标', () => {
    const h = new EditHistory();
    h.push(entry(0, 1, 0, 1));
    h.push(entry(2, 5, 1, 2));
    expect(h.depth).toBe(2);
    expect(h.undo()).toEqual(entry(2, 5, 1, 2));
    expect(h.undo()).toEqual(entry(0, 1, 0, 1));
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual(entry(0, 1, 0, 1));
    expect(h.redo()).toEqual(entry(2, 5, 1, 2));
    expect(h.redo()).toBeNull();
  });

  it('撤销后推入新项会清空重做分支', () => {
    const h = new EditHistory();
    h.push(entry(0, 1, 0, 1));
    h.push(entry(0, 1, 1, 2));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(entry(0, 1, 1, 9));
    expect(h.canRedo).toBe(false);
    expect(h.snapshot().applied.map((e) => e.after.x)).toEqual([1, 9]);
  });

  it('推入的项被复制，外部改动不影响历史', () => {
    const h = new EditHistory();
    const e = entry(0, 1, 0, 1);
    h.push(e);
    e.after.x = 99;
    expect(h.undo()!.after.x).toBe(1);
  });
});

describe('快捷键', () => {
  const key = (k: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({
    key: k,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: mods.meta ?? false,
  });

  it('Ctrl+O/Ctrl+Shift+S/Ctrl+Z/Ctrl+R', () => {
    expect(shortcutAction(key('o', { ctrl: true }), false)).toBe('open');
    expect(shortcutAction(key('S', { ctrl: true, shift: true }), false)).toBe('saveAs');
    expect(shortcutAction(key('z', { ctrl: true }), false)).toBe('undo');
    expect(shortcutAction(key('Z', { ctrl: true }), false)).toBe('undo');
    expect(shortcutAction(key('r', { ctrl: true }), false)).toBe('redo');
  });

  it('不带 Ctrl、带 Alt/Meta 或多余 Shift 的组合不触发', () => {
    expect(shortcutAction(key('z'), false)).toBeNull();
    expect(shortcutAction(key('z', { ctrl: true, alt: true }), false)).toBeNull();
    expect(shortcutAction(key('z', { ctrl: true, meta: true }), false)).toBeNull();
    expect(shortcutAction(key('z', { ctrl: true, shift: true }), false)).toBeNull();
    expect(shortcutAction(key('r', { ctrl: true, shift: true }), false)).toBeNull();
    expect(shortcutAction(key('s', { ctrl: true }), false)).toBeNull();
  });

  it('输入控件聚焦时不截获撤销/重做', () => {
    expect(shortcutAction(key('z', { ctrl: true }), true)).toBeNull();
    expect(shortcutAction(key('r', { ctrl: true }), true)).toBeNull();
    expect(shortcutAction(key('o', { ctrl: true }), true)).toBe('open');
  });

  it('识别文本输入控件', () => {
    expect(isTextInputElement({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextInputElement({ tagName: 'INPUT' })).toBe(true);
    expect(isTextInputElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextInputElement({ tagName: 'SELECT' })).toBe(true);
    expect(isTextInputElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextInputElement({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextInputElement({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextInputElement({ tagName: 'CANVAS' })).toBe(false);
    expect(isTextInputElement(null)).toBe(false);
  });
});

describe('菜单项', () => {
  const none: MenuAvailability = { hasDocument: false, canUndo: false, canRedo: false, busy: false };

  it('文件菜单：打开…与另存为…；无文档时另存为禁用', () => {
    const items = menuItems('文件', none);
    expect(items.map((i) => [i.label, i.shortcut, i.enabled])).toEqual([
      ['打开…', 'Ctrl+O', true],
      ['另存为…', 'Ctrl+Shift+S', false],
    ]);
    expect(menuItems('文件', { ...none, hasDocument: true })[1]!.enabled).toBe(true);
  });

  it('异步打开/保存进行中，打开和另存为都禁用', () => {
    const items = menuItems('文件', { ...none, hasDocument: true, busy: true });
    expect(items.map((i) => i.enabled)).toEqual([false, false]);
  });

  it('编辑菜单：撤销与重做按历史可用性启用', () => {
    expect(menuItems('编辑', none).map((i) => [i.label, i.shortcut, i.enabled])).toEqual([
      ['撤销', 'Ctrl+Z', false],
      ['重做', 'Ctrl+R', false],
    ]);
    const some = menuItems('编辑', { ...none, hasDocument: true, canUndo: true });
    expect(some.map((i) => i.enabled)).toEqual([true, false]);
    const redo = menuItems('编辑', { ...none, hasDocument: true, canRedo: true });
    expect(redo.map((i) => i.enabled)).toEqual([false, true]);
    // 没有文档时即便历史标志为真也禁用
    expect(menuItems('编辑', { ...none, canUndo: true, canRedo: true }).map((i) => i.enabled)).toEqual([false, false]);
  });

  it('其它菜单暂无下拉内容', () => {
    for (const label of MENU_LABELS) {
      if (label !== '文件' && label !== '编辑') expect(menuItems(label, none)).toEqual([]);
    }
  });
});

describe('窗口标题', () => {
  it('没有文档、干净、有未保存修改', () => {
    expect(windowTitleFor(null, false)).toBe('GSP-plus');
    expect(windowTitleFor('a.gsp', false)).toBe('GSP-plus - a.gsp');
    expect(windowTitleFor('a.gsp', true)).toBe('GSP-plus - a.gsp（有未保存修改）');
  });
});
