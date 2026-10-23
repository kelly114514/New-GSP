/** 顶部菜单栏的菜单名，顺序与原版几何画板一致。目前只是静态标签，尚无下拉内容。 */
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
