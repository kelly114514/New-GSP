export type ShortcutAction = 'open' | 'saveAs' | 'undo' | 'redo';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** 这些 input 类型不接收文字，聚焦它们时不需要让出编辑快捷键。 */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit']);

/** 焦点元素是否是会自己处理 Ctrl+Z 等编辑快捷键的输入控件。 */
export function isTextInputElement(
  el: { tagName?: string; isContentEditable?: boolean; type?: string } | null | undefined,
): boolean {
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el.type ?? 'text').toLowerCase());
  return false;
}

/**
 * 把按键映射成动作：Ctrl+O 打开、Ctrl+Shift+S 另存为、Ctrl+Z 撤销、Ctrl+R 重做。
 * 输入控件聚焦时撤销/重做交还给控件自己的原生编辑行为，返回 null。
 */
export function shortcutAction(e: KeyLike, textInputFocused: boolean): ShortcutAction | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey) {
    if (key === 'o') return 'open';
    if (textInputFocused) return null;
    if (key === 'z') return 'undo';
    if (key === 'r') return 'redo';
    return null;
  }
  return key === 's' ? 'saveAs' : null;
}
