/**
 * 对象模型便利层：把无损树里的页 / 工具区展开成“对象列表”，每个对象带 1 起的序号、
 * 约束 ID、主类、genera、父序号、自由点坐标、约束描述符等。全部只读；树本身仍是唯一的事实来源，
 * 改了树之后重新调用 readDocumentModel 即可得到新视图。
 */

import { lookupConstraint } from './constraints.ts';
import type { ConstraintDescriptor } from './constraints.ts';
import { GspDecodeError } from './errors.ts';
import { textEncodingForLayout } from './text.ts';
import type { TextEncoding } from './text.ts';
import { groupOf, isObjectNode, objectNodesOf, pagesOf, toolsOf } from './tree.ts';
import type { ContainerNode, GspDocument, ObjectNode } from './tree.ts';
import { decodeContainerHeader, decodeFontEntry, decodeTextStyleEntry } from './views/container.ts';
import type { ContainerHeader, FontEntry, TextStyleEntry } from './views/container.ts';
import { docHeaderOf } from './views/docHeader.ts';
import type { DocHeader } from './views/docHeader.ts';
import { decodeEmbeddedImage } from './views/image.ts';
import type { EmbeddedImage } from './views/image.ts';
import {
  decodeFreePoint,
  decodeImageIndex,
  decodeLabel,
  decodeObjectHeader,
  decodeParents,
  decodeStyleRef,
} from './views/object.ts';
import type { FreePoint, ObjectHeader, ObjectLabel } from './views/object.ts';
import { decodeNulString } from './views/strings.ts';
import type { DecodedNulString } from './views/strings.ts';

export interface ObjectInfo {
  /** 容器内的对象序号，从 1 起（2002 父表和 9000 等记录用的就是这个序号）。 */
  index: number;
  node: ObjectNode;
  header: ObjectHeader;
  /** 约束外部 ID（对象头 +0）；0 = 自由对象。 */
  constraintId: number;
  /** 主类外部 ID（对象头 +6）。 */
  mainKind: number;
  /** genera 外部 ID（对象头 +8）。 */
  genera: number;
  /** 2002 里的父对象序号（1 起，同一容器内）；没有 2002 为空数组。 */
  parents: number[];
  /** 自由点坐标（2201）；没有 2201 的对象为 undefined。 */
  freePoint: FreePoint | undefined;
  /** 约束描述符；约束 ID 不在目录里为 undefined。 */
  constraint: ConstraintDescriptor | undefined;
  /** 标签（2005）。 */
  label: ObjectLabel | undefined;
  /** 样式引用（2008）：本容器内 1203 的序号（0 起）。 */
  styleRef: number | undefined;
  /** 图片序号（8004）：文档组里 1300 的序号（0 起）。 */
  imageIndex: number | undefined;
}

export interface ContainerModel {
  type: 'page' | 'tool';
  /** 在同类容器里的下标，从 0 起。 */
  index: number;
  node: ContainerNode;
  /** 页头 / 工具区头（36 字节）；长度不对为 undefined。 */
  header: ContainerHeader | undefined;
  /** 页名 / 工具名（1100）；没有为 undefined。 */
  name: DecodedNulString | undefined;
  fonts: FontEntry[];
  textStyles: TextStyleEntry[];
  objects: ObjectInfo[];
}

export interface DocumentModel {
  doc: GspDocument;
  /** 900 头的布局版本（5 或 4）。 */
  layout: number;
  /** 解码文本用的编码。 */
  encoding: TextEncoding;
  header: DocHeader;
  /** 附加信息组里的嵌入图片，按组内次序。 */
  images: EmbeddedImage[];
  pages: ContainerModel[];
  tools: ContainerModel[];
}

export interface ModelOptions {
  /** 布局 4 文件的 ANSI 代码页，缺省 GBK；语料里有一个 Big5 文件。 */
  ansiEncoding?: 'gbk' | 'big5';
}

function bad(where: string, what: string): never {
  throw new GspDecodeError(where, what);
}

function readObject(
  node: ObjectNode,
  index: number,
  layout: number,
  encoding: TextEncoding,
  where: string,
): ObjectInfo {
  const here = `${where} / object ${index}`;
  const header = decodeObjectHeader(node.begin.payload, layout);
  if (header === undefined) bad(here, 'object header (kind 2000) is shorter than 12 bytes');
  let parents: number[] = [];
  let freePoint: FreePoint | undefined;
  let label: ObjectLabel | undefined;
  let styleRef: number | undefined;
  let imageIndex: number | undefined;
  let sawParents = false;
  for (const r of node.records) {
    switch (r.kind) {
      case 2002: {
        if (sawParents) break;
        sawParents = true;
        const p = decodeParents(r.payload);
        if (p === undefined) bad(here, `kind 2002 payload of ${r.payload.length} bytes is not u32 count + count*u32`);
        parents = p;
        break;
      }
      case 2201: {
        if (freePoint !== undefined) break;
        const p = decodeFreePoint(r.payload);
        if (p === undefined) bad(here, `kind 2201 payload is ${r.payload.length} bytes, expected 16`);
        freePoint = p;
        break;
      }
      case 2005: {
        if (label !== undefined) break;
        const l = decodeLabel(r.payload, encoding);
        if (l === undefined) bad(here, `kind 2005 payload of ${r.payload.length} bytes is malformed`);
        label = l;
        break;
      }
      case 2008: {
        if (styleRef !== undefined) break;
        const s = decodeStyleRef(r.payload);
        if (s === undefined) bad(here, `kind 2008 payload is ${r.payload.length} bytes, expected 2`);
        styleRef = s;
        break;
      }
      case 8004: {
        if (imageIndex !== undefined) break;
        const s = decodeImageIndex(r.payload);
        if (s === undefined) bad(here, `kind 8004 payload is ${r.payload.length} bytes, expected 2`);
        imageIndex = s;
        break;
      }
      default:
        break;
    }
  }
  return {
    index,
    node,
    header,
    constraintId: header.constraintId,
    mainKind: header.mainKind,
    genera: header.genera,
    parents,
    freePoint,
    constraint: lookupConstraint(header.constraintId),
    label,
    styleRef,
    imageIndex,
  };
}

/** 展开一个页或工具区。 */
export function readContainerModel(
  node: ContainerNode,
  type: 'page' | 'tool',
  index: number,
  layout: number,
  encoding: TextEncoding,
): ContainerModel {
  const where = `${type} ${index}`;
  let name: DecodedNulString | undefined;
  const fonts: FontEntry[] = [];
  const textStyles: TextStyleEntry[] = [];
  for (const item of node.items) {
    if (isObjectNode(item)) continue;
    switch (item.kind) {
      case 1100:
        if (name === undefined) name = decodeNulString(item.payload, encoding);
        break;
      case 1201: {
        const f = decodeFontEntry(item.payload);
        if (f === undefined) bad(where, `kind 1201 payload of ${item.payload.length} bytes is malformed`);
        fonts.push(f);
        break;
      }
      case 1203: {
        const s = decodeTextStyleEntry(item.payload);
        if (s === undefined) bad(where, `kind 1203 payload is ${item.payload.length} bytes, expected 20`);
        textStyles.push(s);
        break;
      }
      default:
        break;
    }
  }
  const objects: ObjectInfo[] = [];
  const nodes = objectNodesOf(node);
  for (let i = 0; i < nodes.length; i++) {
    const objectNode = nodes[i];
    if (objectNode === undefined) continue;
    objects.push(readObject(objectNode, i + 1, layout, encoding, where));
  }
  return {
    type,
    index,
    node,
    header: decodeContainerHeader(node.begin.payload),
    name,
    fonts,
    textStyles,
    objects,
  };
}

/** 展开整份文档：页、工具区、嵌入图片。 */
export function readDocumentModel(doc: GspDocument, options: ModelOptions = {}): DocumentModel {
  const header = docHeaderOf(doc);
  const layout = header.layout;
  const encoding = textEncodingForLayout(layout, options.ansiEncoding ?? 'gbk');
  const images: EmbeddedImage[] = [];
  const group = groupOf(doc);
  if (group !== undefined) {
    for (const item of group.items) {
      if (isObjectNode(item) || item.kind !== 1300) continue;
      const img = decodeEmbeddedImage(item.payload);
      if (img === undefined) bad(`group / image ${images.length}`, 'kind 1300 payload is shorter than 8 bytes');
      images.push(img);
    }
  }
  const pages = pagesOf(doc).map((p, i) => readContainerModel(p, 'page', i, layout, encoding));
  const tools = toolsOf(doc).map((t, i) => readContainerModel(t, 'tool', i, layout, encoding));
  return { doc, layout, encoding, header, images, pages, tools };
}
