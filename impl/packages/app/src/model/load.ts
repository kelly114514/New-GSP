import { GspDecodeError, GspFormatError, parseGsp, readDocumentModel } from '@gsp-plus/core';
import type { DocumentModel, GspErrorCode } from '@gsp-plus/core';

export type LoadResult = { ok: true; model: DocumentModel } | { ok: false; message: string };

/** 错误码的中文概括；原因原文（英文，来自读取器）接在后面。 */
const SUMMARY: Record<GspErrorCode, string> = {
  'bad-magic': '不是几何画板 .gsp 文件（文件头不是 GSP4）',
  truncated: '文件不完整（在中途被截断）',
  'length-out-of-bounds': '文件内部记录长度越界',
  'bad-first-record': '文件头记录异常',
  'bad-last-record': '文件尾记录缺失',
  'unbalanced-nesting': '记录嵌套不配对',
  'unexpected-nesting': '记录出现在不允许的位置',
  'bad-envelope': '兼容信封结构不合规',
  'bad-object-header': '对象头长度不足',
};

/** 把错误转成给用户看的中文说明。 */
export function describeLoadError(error: unknown): string {
  if (error instanceof GspFormatError) {
    const hex = error.offset.toString(16).toUpperCase();
    return `打开失败：${SUMMARY[error.code]}。原因：${error.reason}（字节偏移 ${error.offset}，0x${hex}）`;
  }
  if (error instanceof GspDecodeError) {
    return `打开失败：文件结构无法解读。原因：${error.message}`;
  }
  return `打开失败：${error instanceof Error ? error.message : String(error)}`;
}

/** 解析并展开一份 .gsp。失败时返回中文消息，不抛异常。 */
export function loadGspDocument(bytes: Uint8Array): LoadResult {
  try {
    return { ok: true, model: readDocumentModel(parseGsp(bytes)) };
  } catch (error) {
    return { ok: false, message: describeLoadError(error) };
  }
}
