import { versionInfo } from '@gsp-plus/render';

export interface StatusBarProps {
  /** 画布的 CSS 像素尺寸；尚未测量时为 null。 */
  canvasSize: { width: number; height: number } | null;
}

export function StatusBar({ canvasSize }: StatusBarProps) {
  return (
    <footer className="statusbar" role="status">
      <span className="statusbar__main">就绪</span>
      <span className="statusbar__item">
        {canvasSize === null ? '画布：—' : `画布：${canvasSize.width} × ${canvasSize.height}`}
      </span>
      <span className="statusbar__item">{versionInfo()}</span>
    </footer>
  );
}
