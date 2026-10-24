import { describe, expect, it } from 'vitest';
import { MENU_LABELS } from '../src/menus';

describe('菜单栏标签', () => {
  it('依次是 文件/编辑/显示/构造/变换/度量/数据/绘图/窗口/帮助', () => {
    expect([...MENU_LABELS]).toEqual([
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
    ]);
  });

  it('没有重复', () => {
    expect(new Set(MENU_LABELS).size).toBe(MENU_LABELS.length);
  });
});
