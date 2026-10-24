import { versionInfo } from '@gsp-plus/render';

export interface StatusBarProps {
  /** 文件名；没有打开文件时为 null。 */
  fileName: string | null;
  layout: number | null;
  pageCount: number;
  toolCount: number;
  /** 当前页的对象数。 */
  objectCount: number;
  drawnCount: number;
  unsupportedCount: number;
  /** 右侧的一句话状态。 */
  message: string;
}

export function StatusBar({
  fileName,
  layout,
  pageCount,
  toolCount,
  objectCount,
  drawnCount,
  unsupportedCount,
  message,
}: StatusBarProps) {
  return (
    <footer className="statusbar" role="status">
      <span className="statusbar__item">文件：{fileName ?? '未打开'}</span>
      {layout !== null && (
        <>
          <span className="statusbar__item">布局版本：{layout}</span>
          <span className="statusbar__item">页数：{pageCount}</span>
          <span className="statusbar__item">工具区：{toolCount} 个</span>
          <span className="statusbar__item">当前页对象：{objectCount}</span>
          <span className="statusbar__item">
            已绘制 {drawnCount} / 暂不支持 {unsupportedCount}
          </span>
        </>
      )}
      <span className="statusbar__main">{message}</span>
      <span className="statusbar__item statusbar__item--dim">{versionInfo()}</span>
    </footer>
  );
}
