/** 操作按钮的外观尺寸：原版按标签文字自动定大小（截图 example-40.gsp：Arial 12 像素的“Animate Point”按钮 89×17.5）。
 * 左侧是对象颜色的色条，右侧是带立体边的灰色按钮面；高度约为字号 + 5，宽度约为文字宽 + 15。 */
import { TEXT_DEFAULTS, type FontSpec } from './model';

/** 粗略估计文字宽度（命中测试和保存用；绘制时按实际字体测量）。 */
export function estimateTextWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    w += c >= 0x2e80 ? 1 : ch === ' ' ? 0.28 : /[A-Z]/.test(ch) ? 0.67 : /[il.,:;'|!]/.test(ch) ? 0.25 : /[mwMW]/.test(ch) ? 0.83 : 0.53;
  }
  return w * size * (bold ? 1.06 : 1);
}

export const BUTTON_BAR = 6;
export function buttonSize(text: string, font?: Pick<FontSpec, 'size' | 'bold'>): { w: number; h: number } {
  const size = font?.size ?? TEXT_DEFAULTS.button.style.size;
  return { w: Math.round(estimateTextWidth(text, size, font?.bold) + 9 + BUTTON_BAR), h: Math.round(size + 5) };
}
