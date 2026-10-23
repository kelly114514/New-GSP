import { CORE_VERSION } from '@gsp-plus/core';

export { drawGrid } from './grid';
export type { GridOptions } from './grid';

/** 绘制包版本，需与 package.json 的 version 保持一致。 */
export const RENDER_VERSION = '0.1.0';

/** 人类可读的版本说明，例如状态栏显示用。 */
export function versionInfo(): string {
  return `render ${RENDER_VERSION} / core ${CORE_VERSION}`;
}
