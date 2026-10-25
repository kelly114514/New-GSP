import { describe, expect, it } from 'vitest';
import { editorCommand } from '../src/model/shortcuts';

function key(key: string, patch: Partial<KeyboardEvent> = {}) {
  return { key, ctrlKey: true, altKey: false, shiftKey: false, target: null, defaultPrevented: false, ...patch };
}

describe('编辑器快捷键', () => {
  it.each([['o', 'open'], ['z', 'undo'], ['R', 'redo']])('Ctrl+%s分派%s', (pressed, command) => {
    expect(editorCommand(key(pressed))).toBe(command);
  });
  it('Ctrl+Shift+S另存为，Escape取消拖动', () => {
    expect(editorCommand(key('S', { shiftKey: true }))).toBe('saveAs');
    expect(editorCommand(key('Escape', { ctrlKey: false }))).toBe('cancel');
  });
  it.each(['input', 'textarea', 'select', 'contenteditable'])('%s保留原生编辑快捷键', (control) => {
    const target = { isContentEditable: control === 'contenteditable', closest: () => control === 'contenteditable' ? null : {} } as unknown as EventTarget;
    for (const pressed of ['z', 'r', 'o', 'Escape']) expect(editorCommand(key(pressed, { target }))).toBeNull();
    expect(editorCommand(key('s', { target, shiftKey: true }))).toBeNull();
  });
  it('不拦截已处理事件、Alt组合和未定义的全部撤销快捷键', () => {
    expect(editorCommand(key('z', { defaultPrevented: true }))).toBeNull();
    expect(editorCommand(key('z', { altKey: true }))).toBeNull();
    expect(editorCommand(key('z', { shiftKey: true }))).toBeNull();
    expect(editorCommand(key('s'))).toBeNull();
  });
});
