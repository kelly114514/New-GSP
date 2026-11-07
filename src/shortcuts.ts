/** 快捷键表：由菜单规格填充，键盘处理按组合键字符串查表。 */
export const SHORTCUTS = new Map<string, number>();

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.shiftKey && (e.ctrlKey || e.metaKey)) parts.push('Shift');
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}
