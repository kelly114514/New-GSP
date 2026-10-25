/** 顶部菜单栏的菜单名，顺序与原版几何画板一致。目前只有“文件”和“编辑”有下拉内容。 */
export const MENU_LABELS = [
  '文件',
  '编辑',
  '显示',
  '构造',
  '变换',
  '度量',
  '数据',
  '绘图',
  '窗口',
  '帮助',
] as const;

export type MenuLabel = (typeof MENU_LABELS)[number];

export type MenuCommand = 'open' | 'saveAs' | 'undo' | 'redo';

export interface MenuItemSpec {
  command: MenuCommand;
  label: string;
  shortcut: string;
  enabled: boolean;
}

/** 决定菜单项能否使用的当前状态。 */
export interface MenuAvailability {
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 正在进行异步打开/保存。 */
  busy: boolean;
}

/** 某个菜单下拉里的项；没有下拉内容的菜单返回空数组。无可用动作时项照常显示但 enabled 为 false。 */
export function menuItems(menu: MenuLabel, a: MenuAvailability): MenuItemSpec[] {
  if (menu === '文件') {
    return [
      { command: 'open', label: '打开…', shortcut: 'Ctrl+O', enabled: !a.busy },
      { command: 'saveAs', label: '另存为…', shortcut: 'Ctrl+Shift+S', enabled: a.hasDocument && !a.busy },
    ];
  }
  if (menu === '编辑') {
    return [
      { command: 'undo', label: '撤销', shortcut: 'Ctrl+Z', enabled: a.hasDocument && a.canUndo },
      { command: 'redo', label: '重做', shortcut: 'Ctrl+R', enabled: a.hasDocument && a.canRedo },
    ];
  }
  return [];
}
