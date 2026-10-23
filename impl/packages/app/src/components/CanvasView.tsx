import { drawGrid } from '@gsp-plus/render';
import { useEffect, useRef } from 'react';

export interface CanvasViewProps {
  /** 画布尺寸（CSS 像素）变化时回调。 */
  onResize?: (size: { width: number; height: number }) => void;
}

/** 填满父容器的 Canvas。尺寸变化时按设备像素比重设位图并重绘。 */
export function CanvasView({ onResize }: CanvasViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const redraw = () => {
      const width = Math.max(1, Math.floor(wrap.clientWidth));
      const height = Math.max(1, Math.floor(wrap.clientHeight));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGrid(ctx, width, height);
      onResize?.({ width, height });
    };

    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(wrap);
    // 窗口移到不同缩放比例的显示器时，devicePixelRatio 会变化但容器尺寸不一定变。
    window.addEventListener('resize', redraw);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', redraw);
    };
  }, [onResize]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas className="canvas" ref={canvasRef} />
    </div>
  );
}
