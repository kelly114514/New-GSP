/**
 * 页面数值偏好与显示单位（规格 §7.7、§8.11，验收契约“求值模型”）。
 *
 * 值一律在页面显示单位里；本文件只提供显示单位与基准单位之间的换算、单位文字，
 * 以及“这个量纲在当前页面上到底能不能显示”的判定。缺失或越界的页面偏好按
 * “值算不出来”处理，不假设 96 DPI，也不假设厘米。
 */

export type Dimension = 'number' | 'length' | 'angle' | 'area';

/** 页面数值偏好。缺失用 undefined，绝不在这里填默认值。 */
export interface PageNumericPreferences {
  /** 10041：0 像素、1 厘米、2 英寸；缺失为 undefined。 */
  distanceUnit: 0 | 1 | 2 | undefined;
  /** 10042：0 弧度、1 普通度、2 方向度；缺失为 undefined。 */
  angleUnit: 0 | 1 | 2 | undefined;
  /** 9008 页面 DPI；缺失为 undefined。 */
  dpi: number | undefined;
}

/** 一个距离单位对应多少页面 px：px=1、cm=dpi/2.54、in=dpi。 */
export function distanceUnitScale(unit: 0 | 1 | 2, dpi: number): number {
  if (unit === 0) return 1;
  if (unit === 1) return dpi / 2.54;
  return dpi;
}

/** 一个角度单位对应多少弧度：弧度=1、普通度与方向度都是 π/180。 */
export function angleUnitScale(unit: 0 | 1 | 2): number {
  return unit === 0 ? 1 : Math.PI / 180;
}

/** 距离单位文字（逐字）。 */
export function distanceUnitText(unit: 0 | 1 | 2): string {
  return unit === 0 ? '像素' : unit === 1 ? '厘米' : '英寸';
}

/**
 * 角度单位文字。10042=0 一律“弧度”；1 与 2 都是度数，字形由对象字体决定：
 * Symbol 字体用私用区 U+F0B0，其余字体用 U+00B0。
 */
export function angleUnitText(unit: 0 | 1 | 2, fontIsSymbol: boolean): string {
  if (unit === 0) return '弧度';
  return fontIsSymbol ? '\uF0B0' : '\u00B0';
}

export type UnitTextResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * 量纲 + 页面偏好 + 字体 → `displayUnitText`。面积与 10041=0/2 的低置信项也在这里；
 * 偏好缺失时返回以 `value-undefined` 开头的 reason，由调用方转成 unsupported。
 */
export function unitTextFor(dimension: Dimension, page: PageNumericPreferences, fontIsSymbol: boolean): UnitTextResult {
  if (dimension === 'number') return { ok: true, text: '' };
  if (dimension === 'angle') {
    if (page.angleUnit === undefined) return { ok: false, reason: 'value-undefined:missing-10042' };
    return { ok: true, text: angleUnitText(page.angleUnit, fontIsSymbol) };
  }
  if (page.distanceUnit === undefined) return { ok: false, reason: 'value-undefined:missing-10041' };
  const text = distanceUnitText(page.distanceUnit);
  // 面积单位的上标布局尚未核对（验收契约明列 coverage gap），这里只给出稳定的调试字符串。
  return { ok: true, text: dimension === 'area' ? `${text}\u00B2` : text };
}

export type BaseScaleResult = { ok: true; scale: number } | { ok: false; reason: string };

/**
 * 显示单位值 → 基准单位的倍数（长度 px、角度弧度、面积 px²、无量纲 1）。
 * 需要 DPI 的换算缺 9008 时明确失败（`page-dpi-missing`）；语料只有 96 与 72 两种值，
 * 而 px/cm、px/in 的静态换算只在 96 下成立，非 96 一律按“值算不出来”处理（验收契约 §求值模型 6）。
 */
export function baseUnitScale(dimension: Dimension, page: PageNumericPreferences): BaseScaleResult {
  if (dimension === 'number') return { ok: true, scale: 1 };
  if (dimension === 'angle') {
    if (page.angleUnit === undefined) return { ok: false, reason: 'value-undefined:missing-10042' };
    return { ok: true, scale: angleUnitScale(page.angleUnit) };
  }
  if (page.distanceUnit === undefined) return { ok: false, reason: 'value-undefined:missing-10041' };
  if (page.distanceUnit === 0) return { ok: true, scale: 1 };
  if (page.dpi === undefined) return { ok: false, reason: 'page-dpi-missing' };
  if (page.dpi !== 96) return { ok: false, reason: `page-dpi-non-96:${page.dpi}` };
  const scale = distanceUnitScale(page.distanceUnit, page.dpi);
  return { ok: true, scale: dimension === 'area' ? scale * scale : scale };
}
