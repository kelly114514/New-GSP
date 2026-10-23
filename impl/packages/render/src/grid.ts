/** 网格背景的绘制参数。长度单位均为 CSS 像素。 */
export interface GridOptions {
  /** 背景填充色。 */
  background?: string;
  /** 细网格线颜色。 */
  minorColor?: string;
  /** 粗网格线颜色。 */
  majorColor?: string;
  /** 细网格间距。 */
  minorStep?: number;
  /** 每隔多少条细线画一条粗线。 */
  majorEvery?: number;
}

const DEFAULTS: Required<GridOptions> = {
  background: '#ffffff',
  minorColor: '#e8edf3',
  majorColor: '#c8d1dc',
  minorStep: 20,
  majorEvery: 5,
};

/**
 * 在 (0,0)–(width,height) 范围内绘制纯色背景和网格。
 * 坐标按 CSS 像素计；高 DPI 缩放由调用方通过 ctx.setTransform 处理。
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: GridOptions = {},
): void {
  const o = { ...DEFAULTS, ...options };
  if (!(o.minorStep > 0) || !(o.majorEvery >= 1)) {
    throw new RangeError('minorStep 必须大于 0，majorEvery 必须不小于 1');
  }

  ctx.save();
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = 1;
  const cols = Math.floor(width / o.minorStep);
  const rows = Math.floor(height / o.minorStep);

  // 先画细线再画粗线，粗线不会被细线盖住。
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? o.majorColor : o.minorColor;
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      if ((i % o.majorEvery === 0) !== major) continue;
      const x = Math.round(i * o.minorStep) + 0.5; // +0.5：1px 线落在像素中心，边缘清晰
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let j = 0; j <= rows; j++) {
      if ((j % o.majorEvery === 0) !== major) continue;
      const y = Math.round(j * o.minorStep) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
