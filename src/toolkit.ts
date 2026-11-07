/** 工具库：把工具文件夹里的工具文件和文档内嵌的工具变成可用的 Tool（延迟解析，菜单打开时才解析对应的组）。 */
import { decodeToolBody, readTools } from './gsp/codec';
import { buildTool, type Tool } from './core/tooling';
import type { EmbeddedTool } from './core/model';

export interface ToolRef { name: string; group?: string; embedded: EmbeddedTool; prereqCount: number }
/** 菜单里的一组：一个工具文件。 */
export interface ToolGroup { name: string; file: string; tools: ToolRef[] }

/** 文件名 → 组名：“01 线工具.gsp” → “线工具”。 */
export const groupName = (file: string) => file.replace(/\.gsp$/i, '').replace(/^\s*\d+\s*[.、_\-\s]?\s*/, '') || file.replace(/\.gsp$/i, '');

/** 载入一个工具文件；读不完整、没有工具的文件返回 undefined。 */
export function loadToolFile(file: string, bytes: Uint8Array): ToolGroup | undefined {
  const name = groupName(file), list = readTools(bytes);
  if (!list.length) return undefined;
  return { name, file, tools: list.map(t => ({ name: t.name, group: name, embedded: t, prereqCount: t.prereq.length })) };
}

const cache = new WeakMap<EmbeddedTool, Tool>();
/** 解析成可用的 Tool（带缓存）。 */
export function resolveTool(ref: ToolRef): Tool {
  let t = cache.get(ref.embedded);
  if (!t) { const { page } = decodeToolBody(ref.embedded); t = buildTool(ref.embedded, page, ref.group); cache.set(ref.embedded, t); }
  return t;
}

/** 文档内嵌的工具（没有组名）。 */
export function resolveEmbedded(t: EmbeddedTool, group?: string): Tool {
  let r = cache.get(t);
  if (!r) { const { page } = decodeToolBody(t); r = buildTool(t, page, group); cache.set(t, r); }
  return r;
}
