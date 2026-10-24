/**
 * 语义一致性检查（规格 §3.2、§4、§5、§7、§8）。
 *
 * 读取器（parseGsp）只在文件结构层面拒绝输入；这里检查“合法文件应当满足、但不影响无损读写”的不变量：
 * 页数 / 工具数 / 信封数、信封与内容容器对应、页头对象数、父序号合法、自由点记录与约束对应……
 * 返回问题清单，空数组表示全部通过。写出器不会调用它；编辑之后（尤其是改了结构）建议调用。
 */

import { textEncodingForLayout, decodeText } from './text.ts';
import {
  envelopesOf,
  isContainerNode,
  isObjectNode,
  objectNodesOf,
} from './tree.ts';
import type { ContainerNode, GspDocument } from './tree.ts';
import {
  decodeContainerHeader,
  decodeToolGivenObjects,
  decodeU32Array,
  decodeU32Value,
} from './views/container.ts';
import { decodeDocHeader } from './views/docHeader.ts';
import {
  ENVELOPE_TYPE_GROUP,
  ENVELOPE_TYPE_PAGE,
  ENVELOPE_TYPE_TOOL,
  parseEnvelopePayload,
} from './views/envelope.ts';
import { decodeObjectHeader, decodeParents, decodeStyleRef, decodeImageIndex } from './views/object.ts';

export interface ValidationIssue {
  /** 位置，如 `page 2 / object 5`。 */
  path: string;
  message: string;
}

/** 提示串转 UTF-16 后的最大码元数（§5.3）。 */
export const ENVELOPE_STRING_MAX_UTF16 = 255;

export function validateDocument(doc: GspDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  const header = decodeDocHeader(doc.header.payload);
  if (header === undefined) {
    add('document', `header (900) payload is ${doc.header.payload.length} bytes, expected 28`);
    return issues;
  }
  const layout = header.layout;
  const encoding = textEncodingForLayout(layout);

  // ---- 信封与文档头 ----
  const envelopes = envelopesOf(doc);
  const pages: ContainerNode[] = [];
  const tools: ContainerNode[] = [];
  const groups: ContainerNode[] = [];
  let seenPage = false;
  let seenTool = false;
  envelopes.forEach((env, envIndex) => {
    const where = `envelope ${envIndex}`;
    const containers = env.items.filter(isContainerNode);
    if (containers.length !== 1) {
      add(where, `has ${containers.length} content containers, expected exactly 1`);
    }
    const parsed = parseEnvelopePayload(env.begin.payload);
    if (!parsed.ok) {
      add(where, `payload is malformed: ${parsed.reason}`);
    } else {
      const h = parsed.info.header;
      const type = h[0] ?? -1;
      const expected =
        type === ENVELOPE_TYPE_PAGE
          ? 'page'
          : type === ENVELOPE_TYPE_TOOL
            ? 'tool'
            : type === ENVELOPE_TYPE_GROUP
              ? 'group'
              : undefined;
      const actual = containers[0]?.nodeType;
      if (expected !== undefined && actual !== expected) {
        add(where, `content type h[0]=${type} expects a ${expected} container but contains ${actual ?? 'none'}`);
      }
      if (h[3] !== h[4]) add(where, `h[3]=${h[3]} differs from h[4]=${h[4]}`);
      parsed.info.strings.forEach((s, i) => {
        const units = decodeText(s.raw, encoding).length;
        if (units > ENVELOPE_STRING_MAX_UTF16) {
          add(where, `string ${i} is ${units} UTF-16 code units, the limit is ${ENVELOPE_STRING_MAX_UTF16}`);
        }
      });
    }
    for (const c of containers) {
      if (c.nodeType === 'page') {
        if (seenTool) add(where, 'page envelope appears after a tool envelope');
        seenPage = true;
        pages.push(c);
      } else if (c.nodeType === 'tool') {
        seenTool = true;
        tools.push(c);
      } else if (c.nodeType === 'group') {
        if (seenPage || seenTool || envIndex !== 0) add(where, 'group envelope must be the first envelope');
        groups.push(c);
      }
    }
  });

  if (header.pageCount !== pages.length) {
    add('document', `header page count ${header.pageCount} but the file has ${pages.length} pages`);
  }
  if (header.toolCount !== tools.length) {
    add('document', `header tool count ${header.toolCount} but the file has ${tools.length} tools`);
  }
  if (layout >= 5) {
    if (header.envelopeCount !== envelopes.length) {
      add('document', `header envelope count ${header.envelopeCount} but the file has ${envelopes.length} envelopes`);
    }
    if (groups.length !== 1) add('document', `layout ${layout} requires exactly one group (1006), found ${groups.length}`);
  } else {
    if (header.envelopeCount !== 0) add('document', `layout ${layout} header envelope count should be 0, is ${header.envelopeCount}`);
    if (groups.length !== 0) add('document', `layout ${layout} should have no group (1006), found ${groups.length}`);
  }
  if (pages.length > 0 && header.activePage >= pages.length) {
    add('document', `active page ${header.activePage} is not below the page count ${pages.length}`);
  }
  // 页信封的 h[3]：单页且无工具区为 1，否则为 3（§5.2、§5.5）。
  const expectedPromptLevel = pages.length === 1 && tools.length === 0 ? 1 : 3;
  envelopes.forEach((env, envIndex) => {
    const parsed = parseEnvelopePayload(env.begin.payload);
    if (parsed.ok && parsed.info.header[0] === ENVELOPE_TYPE_PAGE && parsed.info.header[3] !== expectedPromptLevel) {
      add(`envelope ${envIndex}`, `page envelope h[3]=${parsed.info.header[3]}, expected ${expectedPromptLevel}`);
    }
  });

  // ---- 图片数 ----
  const imageCount = groups[0] === undefined ? 0 : groups[0].items.filter((i) => !isObjectNode(i) && i.kind === 1300).length;

  // ---- 页与工具区 ----
  const checkContainer = (c: ContainerNode, label: string): void => {
    const objects = objectNodesOf(c);
    const ch = decodeContainerHeader(c.begin.payload);
    if (ch === undefined) {
      add(label, `header payload is ${c.begin.payload.length} bytes, expected 36`);
    } else if (ch.objectCount !== objects.length) {
      add(label, `header object count ${ch.objectCount} but the container has ${objects.length} objects`);
    }
    let fontCount = 0;
    let styleCount = 0;
    for (const item of c.items) {
      if (isObjectNode(item)) continue;
      if (item.kind === 1201) fontCount++;
      else if (item.kind === 1203) styleCount++;
    }
    for (const item of c.items) {
      if (isObjectNode(item)) continue;
      if (item.kind === 1203) {
        const font = item.payload.length >= 2 ? (item.payload[0] ?? 0) | ((item.payload[1] ?? 0) << 8) : -1;
        if (font >= fontCount) add(label, `text style 1203 refers to font ${font} but there are only ${fontCount} fonts (1201)`);
      } else if (item.kind === 9000) {
        const list = decodeU32Array(item.payload);
        if (list === undefined) add(label, 'kind 9000 payload is not a u32 array');
        else if (list.some((v) => v < 1 || v > objects.length)) add(label, `kind 9000 refers to an object outside 1..${objects.length}`);
      } else if (item.kind === 9005) {
        const v = decodeU32Value(item.payload);
        if (v === undefined || v < 1 || v > objects.length) add(label, `kind 9005 does not refer to an object in 1..${objects.length}`);
      } else if (item.kind === 1204) {
        const list = decodeToolGivenObjects(item.payload);
        if (list === undefined) add(label, 'kind 1204 payload is not u32 count + count*u32');
        else if (list.some((v) => v < 1 || v > objects.length)) add(label, `kind 1204 refers to an object outside 1..${objects.length}`);
      }
    }
    objects.forEach((node, i) => {
      const index = i + 1;
      const where = `${label} / object ${index}`;
      const h = decodeObjectHeader(node.begin.payload, layout);
      if (h === undefined) {
        add(where, 'object header is shorter than 12 bytes');
        return;
      }
      let parentsCount = 0;
      let hasFreePoint = false;
      for (const r of node.records) {
        if (r.kind === 2002) {
          parentsCount++;
          const parents = decodeParents(r.payload);
          if (parents === undefined) {
            add(where, `kind 2002 payload of ${r.payload.length} bytes is malformed`);
          } else {
            if (parents.length < 1) add(where, 'kind 2002 lists no parents');
            for (const p of parents) {
              if (p < 1 || p >= index) add(where, `parent index ${p} must be at least 1 and below the object's own index ${index}`);
            }
          }
        } else if (r.kind === 2201) {
          hasFreePoint = true;
          if (r.payload.length !== 16) add(where, `kind 2201 payload is ${r.payload.length} bytes, expected 16`);
        } else if (r.kind === 2008) {
          const s = decodeStyleRef(r.payload);
          if (s === undefined) add(where, 'kind 2008 payload is not 2 bytes');
          else if (s >= styleCount) add(where, `style reference ${s} is not below the ${styleCount} text styles (1203)`);
        } else if (r.kind === 8004) {
          const s = decodeImageIndex(r.payload);
          if (s === undefined) add(where, 'kind 8004 payload is not 2 bytes');
          else if (s >= imageCount) add(where, `image index ${s} is not below the ${imageCount} embedded images`);
        }
      }
      if (h.constraintId !== 0 && parentsCount !== 1) {
        add(where, `constraint ${h.constraintId} requires exactly one kind 2002, found ${parentsCount}`);
      }
      if (h.constraintId === 0 && parentsCount !== 0) {
        add(where, `free object (constraint 0) must not have a kind 2002, found ${parentsCount}`);
      }
      const shouldHaveFreePoint = h.constraintId === 0 && h.mainKind === 1;
      if (shouldHaveFreePoint !== hasFreePoint) {
        add(where, shouldHaveFreePoint ? 'free point has no kind 2201' : 'object has a kind 2201 but is not a free point');
      }
    });
  };
  pages.forEach((p, i) => checkContainer(p, `page ${i}`));
  tools.forEach((t, i) => checkContainer(t, `tool ${i}`));
  return issues;
}
