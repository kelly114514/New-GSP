/**
 * 读取器：字节 → 无损树。
 *
 * 严格拒绝（GspFormatError，带字节偏移和原因）：
 * - 魔数不是 `GSP4`；
 * - 截断、记录长度越界（记录层，§2）；
 * - 第一条记录不是 28 字节载荷的 900，或文件在 901 之前结束（§2）；
 * - 结束记录与开始记录不配对、成对记录出现在不允许的容器里、文件结束时还有未闭合的开始记录（§3）；
 * - 902 信封的提示串结构不合规（§5.2、§5.5，原版遇到会崩溃）；
 * - 2000 对象头短于 12 字节（§8.1，原版报格式错误）。
 *
 * 其余一律照收：不认识的 kind 留在它出现的位置，载荷不解码、不规范化。
 * 更细的一致性（页数、对象数、父序号……）由 validate.ts 的 validateDocument 报告，不影响读入。
 */

import { GspFormatError } from './errors.ts';
import {
  MAGIC_LENGTH,
  RECORD_HEADER_LENGTH,
  hasMagic,
  readRecordAt,
  recordByteLength,
} from './records.ts';
import type { GspRecord } from './records.ts';
import type {
  ContainerNode,
  ContainerType,
  DocItem,
  EnvelopeItem,
  EnvelopeNode,
  GspDocument,
  ObjectNode,
} from './tree.ts';
import { parseEnvelopePayload } from './views/envelope.ts';

/** 文档头 900 的载荷字节数（§4）。 */
const DOC_HEADER_BYTES = 28;
/** 2000 对象头的最短载荷（§8.1）。 */
const OBJECT_HEADER_MIN_BYTES = 12;

const KIND_DOC_BEGIN = 900;
const KIND_DOC_END = 901;
const KIND_ENVELOPE_BEGIN = 902;
const KIND_ENVELOPE_END = 903;
const KIND_PAGE_BEGIN = 1000;
const KIND_PAGE_END = 1001;
const KIND_TOOL_BEGIN = 1002;
const KIND_TOOL_END = 1003;
const KIND_BLOB_BEGIN = 1004;
const KIND_BLOB_END = 1005;
const KIND_GROUP_BEGIN = 1006;
const KIND_GROUP_END = 1007;
const KIND_OBJECT_BEGIN = 2000;
const KIND_OBJECT_END = 2007;

/** 开始记录 → 对应的结束记录；不是开始记录返回 0。 */
function closerOf(kind: number): number {
  switch (kind) {
    case KIND_DOC_BEGIN:
      return KIND_DOC_END;
    case KIND_ENVELOPE_BEGIN:
      return KIND_ENVELOPE_END;
    case KIND_PAGE_BEGIN:
      return KIND_PAGE_END;
    case KIND_TOOL_BEGIN:
      return KIND_TOOL_END;
    case KIND_BLOB_BEGIN:
      return KIND_BLOB_END;
    case KIND_GROUP_BEGIN:
      return KIND_GROUP_END;
    case KIND_OBJECT_BEGIN:
      return KIND_OBJECT_END;
    default:
      return 0;
  }
}

/** 结束记录 → 对应的开始记录；不是结束记录返回 0。 */
function openerOf(kind: number): number {
  switch (kind) {
    case KIND_DOC_END:
      return KIND_DOC_BEGIN;
    case KIND_ENVELOPE_END:
      return KIND_ENVELOPE_BEGIN;
    case KIND_PAGE_END:
      return KIND_PAGE_BEGIN;
    case KIND_TOOL_END:
      return KIND_TOOL_BEGIN;
    case KIND_BLOB_END:
      return KIND_BLOB_BEGIN;
    case KIND_GROUP_END:
      return KIND_GROUP_BEGIN;
    case KIND_OBJECT_END:
      return KIND_OBJECT_BEGIN;
    default:
      return 0;
  }
}

/** 在 parent 开始记录之内，哪些成对记录可以开始（§3.1、§3.4）。 */
function mayOpenInside(parentKind: number, childKind: number): boolean {
  switch (parentKind) {
    case KIND_DOC_BEGIN:
      return childKind === KIND_ENVELOPE_BEGIN;
    case KIND_ENVELOPE_BEGIN:
      return (
        childKind === KIND_PAGE_BEGIN ||
        childKind === KIND_TOOL_BEGIN ||
        childKind === KIND_BLOB_BEGIN ||
        childKind === KIND_GROUP_BEGIN
      );
    case KIND_PAGE_BEGIN:
    case KIND_TOOL_BEGIN:
      return childKind === KIND_OBJECT_BEGIN;
    default:
      return false;
  }
}

function containerTypeOf(endKind: number): ContainerType {
  switch (endKind) {
    case KIND_PAGE_END:
      return 'page';
    case KIND_TOOL_END:
      return 'tool';
    case KIND_GROUP_END:
      return 'group';
    default:
      return 'blob';
  }
}

interface Frame {
  begin: GspRecord;
  offset: number;
  items: unknown[];
}

export interface ParseOptions {
  /**
   * 是否先复制一份输入再建树（缺省 true）。
   * 记录载荷是输入缓冲区的视图；不复制的话，调用方之后改动输入缓冲区会改变文档。
   * 追求零复制又能保证不改输入时可设为 false。
   */
  copy?: boolean;
}

/** 读取 .gsp 字节，建立无损树。 */
export function parseGsp(input: Uint8Array, options: ParseOptions = {}): GspDocument {
  if (!hasMagic(input)) {
    throw new GspFormatError(
      'bad-magic',
      0,
      input.length < MAGIC_LENGTH
        ? `file is only ${input.length} bytes, too short for the "GSP4" magic`
        : 'file does not start with the "GSP4" magic',
    );
  }
  const bytes = options.copy === false ? input : input.slice();
  const total = bytes.length;

  // 第一条记录必须是 900。
  let pos = MAGIC_LENGTH;
  if (pos >= total) {
    throw new GspFormatError('bad-first-record', pos, 'file ends right after the magic; the first record must be 900');
  }
  const header = readRecordAt(bytes, pos);
  if (header.kind !== KIND_DOC_BEGIN) {
    throw new GspFormatError('bad-first-record', pos, `first record is kind ${header.kind}, expected 900`);
  }
  if (header.payload.length !== DOC_HEADER_BYTES) {
    throw new GspFormatError(
      'bad-first-record',
      pos,
      `record 900 has a ${header.payload.length}-byte payload, expected ${DOC_HEADER_BYTES}`,
    );
  }
  const stack: Frame[] = [{ begin: header, offset: pos, items: [] }];
  pos += recordByteLength(header);

  for (;;) {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      // 不可能：900 闭合时已在下面返回。
      throw new GspFormatError('unbalanced-nesting', pos, 'internal error: nesting stack is empty');
    }
    if (pos >= total) {
      if (stack.length === 1) {
        throw new GspFormatError(
          'bad-last-record',
          pos,
          'file ends before the closing record 901 (the last record must be 901)',
        );
      }
      throw new GspFormatError(
        'unbalanced-nesting',
        pos,
        `file ends inside kind ${top.begin.kind} opened at byte offset ${top.offset} (missing kind ${closerOf(top.begin.kind)})`,
      );
    }

    const offset = pos;
    const record = readRecordAt(bytes, offset);
    pos += recordByteLength(record);
    const kind = record.kind;

    const closes = openerOf(kind);
    if (closes !== 0) {
      // 结束记录：必须与最近未闭合的开始记录配对。
      if (top.begin.kind !== closes) {
        throw new GspFormatError(
          'unbalanced-nesting',
          offset,
          `kind ${kind} closes kind ${closes}, but the innermost open record is kind ${top.begin.kind} (opened at byte offset ${top.offset})`,
        );
      }
      stack.pop();
      if (kind === KIND_DOC_END) {
        return {
          header,
          items: top.items as DocItem[],
          end: record,
          trailing: bytes.subarray(pos),
        };
      }
      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        throw new GspFormatError('unbalanced-nesting', offset, `kind ${kind} has no enclosing record`);
      }
      parent.items.push(buildNode(top, record));
      continue;
    }

    if (closerOf(kind) !== 0) {
      // 开始记录。900 只能是第一条。
      if (!mayOpenInside(top.begin.kind, kind)) {
        throw new GspFormatError(
          'unexpected-nesting',
          offset,
          `kind ${kind} cannot start inside kind ${top.begin.kind} (opened at byte offset ${top.offset})`,
        );
      }
      if (kind === KIND_ENVELOPE_BEGIN) {
        const parsed = parseEnvelopePayload(record.payload);
        if (!parsed.ok) {
          throw new GspFormatError(
            'bad-envelope',
            offset + RECORD_HEADER_LENGTH + parsed.at,
            parsed.reason,
          );
        }
      } else if (kind === KIND_OBJECT_BEGIN && record.payload.length < OBJECT_HEADER_MIN_BYTES) {
        throw new GspFormatError(
          'bad-object-header',
          offset,
          `object header (kind 2000) has a ${record.payload.length}-byte payload, the minimum is ${OBJECT_HEADER_MIN_BYTES}`,
        );
      }
      stack.push({ begin: record, offset, items: [] });
      continue;
    }

    // 普通记录（含不认识的 kind）：原样挂在当前容器里。
    top.items.push(record);
  }
}

function buildNode(frame: Frame, end: GspRecord): ObjectNode | ContainerNode | EnvelopeNode {
  switch (end.kind) {
    case KIND_OBJECT_END:
      return {
        nodeType: 'object',
        begin: frame.begin,
        records: frame.items as GspRecord[],
        end,
      };
    case KIND_ENVELOPE_END:
      return {
        nodeType: 'envelope',
        begin: frame.begin,
        items: frame.items as EnvelopeItem[],
        end,
      };
    default:
      return {
        nodeType: containerTypeOf(end.kind),
        begin: frame.begin,
        items: frame.items as ContainerNode['items'],
        end,
      };
  }
}
