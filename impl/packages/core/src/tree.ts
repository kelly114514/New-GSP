/**
 * 无损树（规格 §3、§10.1）。
 *
 * ```
 * 文档  := 900  (记录 | 信封)*  901  尾随字节
 * 信封  := 902  (记录 | 容器)*  903     ; 正常恰有一个容器
 * 容器  := 1000 页 | 1002 工具区 | 1006 附加信息组 | 1004 二进制块   各自以 1001/1003/1007/1005 结束
 *          内容 (记录 | 对象)*
 * 对象  := 2000  记录*  2007
 * ```
 *
 * 每条记录都保存 kind、原始载荷和补齐字节原值；不认识的 kind 留在它出现的位置。
 * 树里没有任何“缓存的派生字节”：写出器只用载荷长度和载荷内容。
 */

import type { GspRecord } from './records.ts';

/** 对象节点：2000、子记录（保持原次序）、2007。 */
export interface ObjectNode {
  nodeType: 'object';
  begin: GspRecord;
  records: GspRecord[];
  end: GspRecord;
}

/** 容器种类：页(1000)、工具区(1002)、附加信息组(1006)、二进制块(1004，语料没有)。 */
export type ContainerType = 'page' | 'tool' | 'group' | 'blob';

export type ContainerItem = GspRecord | ObjectNode;

/** 页 / 工具区 / 组 / 块：开始记录、按原次序的记录和对象、结束记录。 */
export interface ContainerNode {
  nodeType: ContainerType;
  begin: GspRecord;
  items: ContainerItem[];
  end: GspRecord;
}

export type EnvelopeItem = GspRecord | ContainerNode;

/** 兼容信封：902、内容（正常恰有一个容器）、903。 */
export interface EnvelopeNode {
  nodeType: 'envelope';
  begin: GspRecord;
  items: EnvelopeItem[];
  end: GspRecord;
}

export type DocItem = GspRecord | EnvelopeNode;

/** 一份 .gsp 文档。魔数 `GSP4` 是隐含的，写出时自动加上。 */
export interface GspDocument {
  /** 900 记录（28 字节载荷，§4）。 */
  header: GspRecord;
  /** 900 与 901 之间，按原次序：信封，以及（假如有）不认识的散记录。 */
  items: DocItem[];
  /** 901 记录。 */
  end: GspRecord;
  /** 901 之后的多余字节（语料没有这种文件）。 */
  trailing: Uint8Array;
}

type AnyNode = GspRecord | ObjectNode | ContainerNode | EnvelopeNode;

function nodeTypeOf(item: AnyNode): string | undefined {
  return (item as { nodeType?: string }).nodeType;
}

export function isObjectNode(item: ContainerItem): item is ObjectNode {
  return nodeTypeOf(item) === 'object';
}

export function isEnvelopeNode(item: DocItem): item is EnvelopeNode {
  return nodeTypeOf(item) === 'envelope';
}

export function isContainerNode(item: EnvelopeItem): item is ContainerNode {
  const t = nodeTypeOf(item);
  return t === 'page' || t === 'tool' || t === 'group' || t === 'blob';
}

/** 文档里的全部信封，按文件次序。 */
export function envelopesOf(doc: GspDocument): EnvelopeNode[] {
  const out: EnvelopeNode[] = [];
  for (const item of doc.items) {
    if (isEnvelopeNode(item)) out.push(item);
  }
  return out;
}

/** 文档里指定种类的全部容器（取信封里的容器），按文件次序。 */
export function containersOf(doc: GspDocument, type: ContainerType): ContainerNode[] {
  const out: ContainerNode[] = [];
  for (const item of doc.items) {
    if (!isEnvelopeNode(item)) continue;
    for (const child of item.items) {
      if (isContainerNode(child) && child.nodeType === type) out.push(child);
    }
  }
  return out;
}

/** 全部页（1000），按文件次序，下标从 0 起。 */
export function pagesOf(doc: GspDocument): ContainerNode[] {
  return containersOf(doc, 'page');
}

/** 全部自定义工具区（1002），按文件次序。 */
export function toolsOf(doc: GspDocument): ContainerNode[] {
  return containersOf(doc, 'tool');
}

/** 附加信息组（1006，仅布局 5）；没有则 undefined。 */
export function groupOf(doc: GspDocument): ContainerNode | undefined {
  return containersOf(doc, 'group')[0];
}

/** 容器里的对象节点，按出现次序；第 i 个（从 0 起）的对象序号是 i+1。 */
export function objectNodesOf(container: ContainerNode): ObjectNode[] {
  const out: ObjectNode[] = [];
  for (const item of container.items) {
    if (isObjectNode(item)) out.push(item);
  }
  return out;
}

/**
 * 按文件次序访问文档里的每一条记录（含各层 begin/end）。
 * 写出器、统计和调试输出都用它，保证看到的次序与文件一致。
 */
export function forEachRecord(doc: GspDocument, visit: (record: GspRecord) => void): void {
  visit(doc.header);
  for (const docItem of doc.items) {
    if (!isEnvelopeNode(docItem)) {
      visit(docItem);
      continue;
    }
    visit(docItem.begin);
    for (const envItem of docItem.items) {
      if (!isContainerNode(envItem)) {
        visit(envItem);
        continue;
      }
      visit(envItem.begin);
      for (const item of envItem.items) {
        if (!isObjectNode(item)) {
          visit(item);
          continue;
        }
        visit(item.begin);
        for (const r of item.records) visit(r);
        visit(item.end);
      }
      visit(envItem.end);
    }
    visit(docItem.end);
  }
  visit(doc.end);
}
