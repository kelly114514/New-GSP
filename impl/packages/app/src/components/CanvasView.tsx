import { drawPageScene, fitView, hitTest, panView, zoomAt } from '@gsp-plus/render';
import type { PageDrawList, View } from '@gsp-plus/render';
import { useEffect, useRef } from 'react';
import { beginFreePointDrag, freePointDragTarget } from '../model/canvasDrag';

/** 超过这个距离（CSS 像素）才算拖动平移，否则算点击。 */
const DRAG_THRESHOLD = 3;

export interface CanvasViewProps {
  /** 当前页的绘制描述；没有页时为 null。 */
  scene: PageDrawList | null;
  selectedIndex: number | null;
  /** 点击画布：命中对象时给出序号，点空白时为 null。 */
  onSelect: (index: number | null) => void;
  /** 没有内容时显示的提示。 */
  emptyText: string;
  /** pointerdown 在自由点上：开始一次拖动事务。返回 false 表示不能拖动。 */
  onFreePointDragStart?: (index: number) => boolean;
  /** pointermove：预览新坐标。返回 false 表示事务已被取消（Escape、撤销等），本次手势不再拖动。 */
  onFreePointDragMove?: (index: number, x: number, y: number) => boolean;
  /** pointerup：提交（坐标没变则不产生历史）。 */
  onFreePointDragEnd?: () => void;
  /** pointercancel / 失去指针捕获：恢复起点。 */
  onFreePointDragCancel?: () => void;
}

interface DragState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  objectIndex: number | null;
  /** 自由点拖动事务已在别处结束（Escape、撤销等）：余下的手势什么也不做。 */
  dead: boolean;
  offsetX: number;
  offsetY: number;
}

/**
 * 画布：只负责事件和尺寸，绘制交给 @gsp-plus/render。
 * 打开新页时“适合窗口”；拖动平移，滚轮缩放（以光标为中心）。
 */
export function CanvasView({
  scene,
  selectedIndex,
  onSelect,
  emptyText,
  onFreePointDragStart,
  onFreePointDragMove,
  onFreePointDragEnd,
  onFreePointDragCancel,
}: CanvasViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ width: 1, height: 1 });
  const sceneRef = useRef<PageDrawList | null>(scene);
  const selectedRef = useRef<number | null>(selectedIndex);
  const dragRef = useRef<DragState | null>(null);

  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas === null || canvas === undefined || !ctx) return;
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    const s = sceneRef.current;
    if (s !== null) drawPageScene(ctx, s, viewRef.current, { selectedIndex: selectedRef.current, width, height });
  };

  // 尺寸：挂载时测量，之后随容器变化重设位图并重画
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    const resize = () => {
      const width = Math.max(1, Math.floor(wrap.clientWidth));
      const height = Math.max(1, Math.floor(wrap.clientHeight));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      sizeRef.current = { width, height };
      paint();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // 每次几何更新只重画；换页或换文件才重新适合窗口
  useEffect(() => {
    sceneRef.current = scene;
    paint();
  }, [scene]);

  useEffect(() => {
    const { width, height } = sizeRef.current;
    viewRef.current = fitView(scene?.bounds ?? null, width, height);
    paint();
  }, [scene?.source]);

  // 选中变化：只重画
  useEffect(() => {
    selectedRef.current = selectedIndex;
    paint();
  }, [selectedIndex]);

  // 滚轮缩放：必须非 passive 才能阻止页面滚动
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const lineHeight = e.deltaMode === 1 ? 16 : 1;
      const factor = Math.exp(-e.deltaY * lineHeight * 0.0015);
      viewRef.current = zoomAt(viewRef.current, e.clientX - rect.left, e.clientY - rect.top, factor);
      paint();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const fitToContent = () => {
    const { width, height } = sizeRef.current;
    viewRef.current = fitView(sceneRef.current?.bounds ?? null, width, height);
    paint();
  };

  const localPoint = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        className="canvas"
        ref={canvasRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = localPoint(e);
          const s = sceneRef.current;
          let freeDrag = onFreePointDragStart === undefined ? null : beginFreePointDrag(s, viewRef.current, p.x, p.y);
          if (freeDrag !== null && onFreePointDragStart?.(freeDrag.objectIndex) !== true) freeDrag = null;
          dragRef.current = {
            startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, dead: false,
            objectIndex: freeDrag?.objectIndex ?? null, offsetX: freeDrag?.offsetX ?? 0, offsetY: freeDrag?.offsetY ?? 0,
          };
          if (freeDrag !== null) onSelect(freeDrag.objectIndex);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag === null || drag.dead) return;
          if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
          drag.moved = true;
          if (drag.objectIndex !== null) {
            const p = localPoint(e);
            const target = freePointDragTarget({ ...drag, objectIndex: drag.objectIndex }, viewRef.current, p.x, p.y);
            if (onFreePointDragMove?.(drag.objectIndex, target.x, target.y) !== true) drag.dead = true;
          } else viewRef.current = panView(viewRef.current, e.clientX - drag.lastX, e.clientY - drag.lastY);
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          paint();
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (drag?.objectIndex != null) onFreePointDragEnd?.();
          if (drag === null || drag.moved) return;
          const s = sceneRef.current;
          const p = localPoint(e);
          onSelect(s === null ? null : hitTest(s, viewRef.current, p.x, p.y));
        }}
        onPointerCancel={() => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag?.objectIndex != null) onFreePointDragCancel?.();
        }}
        onLostPointerCapture={() => {
          // pointerup 里先清空了 dragRef，所以这里只会在手势中途丢失捕获时走到
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag?.objectIndex != null) onFreePointDragCancel?.();
        }}
      />
      {scene === null && <div className="canvas-empty">{emptyText}</div>}
      <button type="button" className="canvas-fit" onClick={fitToContent} disabled={scene === null}>
        适合窗口
      </button>
      <div className="canvas-hint">拖动自由点 · 空白拖动平移 · 滚轮缩放 · 点击选中</div>
    </div>
  );
}



