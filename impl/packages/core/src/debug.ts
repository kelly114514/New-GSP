/**
 * 调试输出：把文档树转成可读的、可 JSON 序列化的对象。
 *
 * 每条记录给出 kind、规格表里的名字、载荷长度；已解码的记录给出字段，其余给出十六进制（默认最多 64 字节）。
 * 只读，不影响文档。
 */

import { toHex } from './bytes.ts';
import { recordKindName } from './recordKinds.ts';
import type { GspRecord } from './records.ts';
import { decodeText, textEncodingForLayout } from './text.ts';
import type { TextEncoding } from './text.ts';
import { isContainerNode, isEnvelopeNode, isObjectNode } from './tree.ts';
import type { ContainerType, GspDocument } from './tree.ts';
import {
  decodeContainerHeader,
  decodeFontEntry,
  decodeLabelCounter,
  decodePaletteEntry,
  decodeTextStyleEntry,
  decodeToolGivenObjects,
  decodeU16Value,
  decodeU32Array,
  decodeU32Value,
} from './views/container.ts';
import { decodeDocHeader } from './views/docHeader.ts';
import { envelopeContentName, parseEnvelopePayload } from './views/envelope.ts';
import { decodeEmbeddedImage, hasPngSignature } from './views/image.ts';
import {
  decodeFreePoint,
  decodeImageIndex,
  decodeLabel,
  decodeObjectHeader,
  decodeParents,
  decodeStyleRef,
} from './views/object.ts';
import { readNulString } from './views/strings.ts';
import { gspByteLength } from './writer.ts';

export interface DebugOptions {
  /** 不透明载荷最多输出多少字节的十六进制，缺省 64。 */
  hexLimit?: number;
  /** 布局 4 文件的 ANSI 代码页，缺省 GBK。 */
  ansiEncoding?: 'gbk' | 'big5';
}

export interface DebugRecord {
  kind: number;
  name: string;
  /** 载荷字节数。 */
  length: number;
  /** 奇数长度时补齐字节的原值，仅当不是 0 才输出。 */
  pad?: number;
  /** 已解码的字段。 */
  fields?: Record<string, unknown>;
  /** 没有解码器的载荷的十六进制（可能被截断）。 */
  hex?: string;
  hexTruncated?: boolean;
}

export interface DebugObject {
  type: 'object';
  /** 容器内的对象序号，从 1 起。 */
  index: number;
  begin: DebugRecord;
  records: DebugRecord[];
  end: DebugRecord;
}

export interface DebugContainer {
  type: ContainerType;
  begin: DebugRecord;
  items: Array<DebugRecord | DebugObject>;
  end: DebugRecord;
}

export interface DebugEnvelope {
  type: 'envelope';
  begin: DebugRecord;
  items: Array<DebugRecord | DebugContainer>;
  end: DebugRecord;
}

export interface DebugDocument {
  magic: 'GSP4';
  /** 写出后的字节数。 */
  byteLength: number;
  layout: number;
  encoding: TextEncoding;
  header: DebugRecord;
  items: Array<DebugRecord | DebugEnvelope>;
  end: DebugRecord;
  trailing?: { length: number; hex: string; hexTruncated?: boolean };
}

interface Ctx {
  layout: number;
  encoding: TextEncoding;
  hexLimit: number;
}

function rgbHex(colorRef: number): string {
  const r = colorRef & 0xff;
  const g = (colorRef >> 8) & 0xff;
  const b = (colorRef >> 16) & 0xff;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function nulText(payload: Uint8Array, ctx: Ctx, offset = 0): Record<string, unknown> {
  const s = readNulString(payload, offset);
  const out: Record<string, unknown> = { text: decodeText(s.raw, ctx.encoding) };
  if (s.tail.length > 0) out['tailHex'] = toHex(s.tail);
  if (!s.terminated) out['unterminated'] = true;
  return out;
}

/** 已知记录的字段解码；没有解码器、或形状不对返回 undefined。 */
function describeFields(record: GspRecord, ctx: Ctx): Record<string, unknown> | undefined {
  const p = record.payload;
  const k = record.kind;
  switch (k) {
    case 900: {
      const h = decodeDocHeader(p);
      if (h === undefined) return undefined;
      const { words: _words, ...rest } = h;
      return rest;
    }
    case 902: {
      const parsed = parseEnvelopePayload(p);
      if (!parsed.ok) return { malformed: parsed.reason };
      const header = parsed.info.header;
      return {
        contentType: envelopeContentName(header[0] ?? -1),
        header,
        strings: parsed.info.strings.map((s) => {
          const o: Record<string, unknown> = { text: decodeText(s.raw, ctx.encoding) };
          if (s.pad !== null && s.pad !== 0) o['pad'] = s.pad;
          return o;
        }),
      };
    }
    case 1000:
    case 1002: {
      const h = decodeContainerHeader(p);
      return h === undefined ? undefined : { ...h };
    }
    case 1100:
    case 9004:
    case 9007:
      return nulText(p, ctx);
    case 1201: {
      const f = decodeFontEntry(p);
      if (f === undefined) return undefined;
      const out: Record<string, unknown> = {
        attributes: f.attributes,
        name: decodeText(f.name.raw, ctx.encoding),
      };
      if (f.name.tail.length > 0) out['tailHex'] = toHex(f.name.tail);
      return out;
    }
    case 1203: {
      const s = decodeTextStyleEntry(p);
      return s === undefined ? undefined : { ...s };
    }
    case 1204: {
      const list = decodeToolGivenObjects(p);
      return list === undefined ? undefined : { objects: list };
    }
    case 1300: {
      const img = decodeEmbeddedImage(p);
      if (img === undefined) return undefined;
      return {
        width: img.width,
        height: img.height,
        pngBytes: img.png.length,
        pngSignature: hasPngSignature(img.png),
      };
    }
    case 2000: {
      const h = decodeObjectHeader(p, ctx.layout);
      if (h === undefined) return undefined;
      return {
        constraintId: h.constraintId,
        status: h.status,
        field04: h.field04,
        mainKind: h.mainKind,
        genera: h.genera,
        styleWord: h.styleWord,
        style: h.style,
        colorRef: h.colorRef,
        rgb: rgbHex(h.colorRef),
        reserved15: h.reserved15,
        ratio: h.ratio,
        residual18: h.residual18,
        sortValue: h.sortValue,
        reserved24: h.reserved24,
        headerBytes: h.byteLength,
      };
    }
    case 2002: {
      const parents = decodeParents(p);
      return parents === undefined ? undefined : { parents };
    }
    case 2005: {
      const l = decodeLabel(p, ctx.encoding);
      if (l === undefined) return undefined;
      return {
        words: l.words,
        unknown8Hex: toHex(l.unknown8),
        text: l.text,
        tailHex: toHex(l.tail),
      };
    }
    case 2008: {
      const s = decodeStyleRef(p);
      return s === undefined ? undefined : { textStyle: s };
    }
    case 2201: {
      const pt = decodeFreePoint(p);
      return pt === undefined ? undefined : { x: pt.x, y: pt.y };
    }
    case 8004: {
      const i = decodeImageIndex(p);
      return i === undefined ? undefined : { imageIndex: i };
    }
    case 9000: {
      const list = decodeU32Array(p);
      return list === undefined ? undefined : { objects: list };
    }
    case 9005: {
      const v = decodeU32Value(p);
      return v === undefined ? undefined : { object: v };
    }
    case 9008: {
      const v = decodeU32Value(p);
      return v === undefined ? undefined : { dpi: v };
    }
    case 10020: {
      const e = decodePaletteEntry(p);
      if (e === undefined) return undefined;
      const out: Record<string, unknown> = { ...e };
      if (p.length > 5) out['tailHex'] = toHex(p.subarray(5));
      return out;
    }
    case 10040:
      return p.length === 2 ? { value: p[0] ?? 0, slot: p[1] ?? 0 } : undefined;
    default:
      break;
  }
  if (k >= 2399 && k <= 2419) {
    const c = decodeLabelCounter(p);
    return c === undefined ? undefined : { ...c };
  }
  if ((k >= 10002 && k <= 10008) || (k >= 10021 && k <= 10023) || k === 10041 || k === 10042) {
    const v = decodeU16Value(p);
    return v === undefined ? undefined : { value: v };
  }
  return undefined;
}

function describeRecord(record: GspRecord, ctx: Ctx): DebugRecord {
  const length = record.payload.length;
  const out: DebugRecord = { kind: record.kind, name: recordKindName(record.kind), length };
  if ((length & 1) === 1 && record.pad !== 0) out.pad = record.pad;
  const fields = describeFields(record, ctx);
  if (fields !== undefined) {
    out.fields = fields;
  } else if (length > 0) {
    out.hex = toHex(record.payload, ctx.hexLimit);
    if (length > ctx.hexLimit) out.hexTruncated = true;
  }
  return out;
}

/** 把文档转成可读的调试对象（可直接 JSON.stringify）。 */
export function toDebugJson(doc: GspDocument, options: DebugOptions = {}): DebugDocument {
  const header = decodeDocHeader(doc.header.payload);
  const layout = header?.layout ?? 0;
  const encoding = textEncodingForLayout(layout, options.ansiEncoding ?? 'gbk');
  const ctx: Ctx = { layout, encoding, hexLimit: options.hexLimit ?? 64 };

  const items: DebugDocument['items'] = [];
  for (const docItem of doc.items) {
    if (!isEnvelopeNode(docItem)) {
      items.push(describeRecord(docItem, ctx));
      continue;
    }
    const envItems: DebugEnvelope['items'] = [];
    for (const envItem of docItem.items) {
      if (!isContainerNode(envItem)) {
        envItems.push(describeRecord(envItem, ctx));
        continue;
      }
      const cItems: DebugContainer['items'] = [];
      let objectIndex = 0;
      for (const item of envItem.items) {
        if (!isObjectNode(item)) {
          cItems.push(describeRecord(item, ctx));
          continue;
        }
        objectIndex++;
        cItems.push({
          type: 'object',
          index: objectIndex,
          begin: describeRecord(item.begin, ctx),
          records: item.records.map((r) => describeRecord(r, ctx)),
          end: describeRecord(item.end, ctx),
        });
      }
      envItems.push({
        type: envItem.nodeType,
        begin: describeRecord(envItem.begin, ctx),
        items: cItems,
        end: describeRecord(envItem.end, ctx),
      });
    }
    items.push({
      type: 'envelope',
      begin: describeRecord(docItem.begin, ctx),
      items: envItems,
      end: describeRecord(docItem.end, ctx),
    });
  }
  const out: DebugDocument = {
    magic: 'GSP4',
    byteLength: gspByteLength(doc),
    layout,
    encoding,
    header: describeRecord(doc.header, ctx),
    items,
    end: describeRecord(doc.end, ctx),
  };
  if (doc.trailing.length > 0) {
    out.trailing = { length: doc.trailing.length, hex: toHex(doc.trailing, ctx.hexLimit) };
    if (doc.trailing.length > ctx.hexLimit) out.trailing.hexTruncated = true;
  }
  return out;
}
