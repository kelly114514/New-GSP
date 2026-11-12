/** 后台求一个拖动帧。主线程只会发布位置和结果来自同一份快照的帧。 */
import { evaluatePage, type EvalCtx } from '../core/engine';
import type { Page } from '../core/model';

self.onmessage = ({ data }: MessageEvent<{ page: Page; ctx: EvalCtx }>) => {
  self.postMessage(evaluatePage(data.page, undefined, undefined, data.ctx));
};
