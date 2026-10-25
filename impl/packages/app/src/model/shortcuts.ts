export type EditorCommand = 'open' | 'saveAs' | 'undo' | 'redo' | 'cancel';

/** Keep the native editing keys of form controls and editable text. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return element !== null && (element.isContentEditable === true ||
    element.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]') != null);
}

export function editorCommand(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target' | 'defaultPrevented'>): EditorCommand | null {
  if (event.defaultPrevented || isTextEditingTarget(event.target)) return null;
  if (event.key === 'Escape') return 'cancel';
  if (!event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 's' ? 'saveAs' : null;
  if (key === 'o') return 'open';
  if (key === 'z') return 'undo';
  if (key === 'r') return 'redo';
  return null;
}
