import { describe, expect, it } from 'vitest';
import {
  SORT_VALUE_UNSET,
  decodeContainerHeader,
  decodeDocHeader,
  decodeEmbeddedImage,
  decodeFontEntry,
  decodeLabel,
  decodeNulString,
  decodeObjectHeader,
  decodeParents,
  decodeText,
  decodeTextStyleEntry,
  parseGsp,
  readDocumentModel,
  setDocHeaderWord,
  textEncodingForLayout,
  writeGsp,
} from '../src/index';
import { baselineSamplesDir } from './support';
import { readBytes } from './support';
import { join } from 'node:path';
import { words } from './support/synthetic';

describe('文本解码 §6', () => {
  it('布局 5 → UTF-8；布局 4 → GBK，可改选 Big5', () => {
    expect(textEncodingForLayout(5)).toBe('utf-8');
    expect(textEncodingForLayout(4)).toBe('gbk');
    expect(textEncodingForLayout(4, 'big5')).toBe('big5');
  });

  it('GBK / Big5 / UTF-8 正确解码', () => {
    expect(decodeText(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4), 'gbk')).toBe('中文');
    expect(decodeText(Uint8Array.of(0xa4, 0xa4, 0xa4, 0xe5), 'big5')).toBe('中文');
    expect(decodeText(new TextEncoder().encode('中文'), 'utf-8')).toBe('中文');
  });

  it('坏字节、被截断的双字节字符不抛异常，得到替换字符', () => {
    expect(decodeText(Uint8Array.of(0x41, 0xff, 0xfe, 0x42), 'utf-8')).toContain('�');
    expect(() => decodeText(Uint8Array.of(0x41, 0xd6), 'gbk')).not.toThrow();
    expect(decodeText(Uint8Array.of(0x41, 0xd6), 'gbk')).toMatch(/^A/);
    expect(() => decodeText(Uint8Array.of(0xa4), 'big5')).not.toThrow();
  });

  it('UTF-8 BOM 不被吞掉', () => {
    expect(decodeText(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41), 'utf-8')).toBe('﻿A');
  });
});

describe('NUL 结尾串', () => {
  it('保留残留字节，无 NUL 时不抛异常', () => {
    const s = decodeNulString(Uint8Array.of(0x41, 0x42, 0, 0x7f), 'utf-8');
    expect(s.text).toBe('AB');
    expect(Array.from(s.tail)).toEqual([0, 0x7f]);
    expect(s.terminated).toBe(true);
    const u = decodeNulString(Uint8Array.of(0x41, 0x42), 'utf-8');
    expect(u.text).toBe('AB');
    expect(u.terminated).toBe(false);
  });
});

describe('文档头 / 页头', () => {
  it('900 头 14 个 u16', () => {
    const h = decodeDocHeader(words(5, 1, 0, 0, 0, 0, 1, 4, 0, 1194, 640, 9, 2, 0));
    expect(h).toMatchObject({ layout: 5, pageCount: 1, windowWidth: 1194, windowHeight: 640, textEncodingId: 9, envelopeCount: 2 });
    expect(decodeDocHeader(new Uint8Array(27))).toBeUndefined();
  });

  it('setDocHeaderWord 只改 2 个字节', () => {
    const doc = parseGsp(readBytes(join(baselineSamplesDir, 'empty.gsp')));
    const before = writeGsp(doc);
    setDocHeaderWord(doc, 8, 0);
    expect(Buffer.compare(writeGsp(doc), before)).toBe(0);
    setDocHeaderWord(doc, 9, 800);
    const after = writeGsp(doc);
    const diff = Array.from(after).flatMap((b, i) => (b !== before[i] ? [i] : []));
    expect(diff.length).toBeLessThanOrEqual(2);
    expect(decodeDocHeader(parseGsp(after).header.payload)?.windowWidth).toBe(800);
    expect(() => setDocHeaderWord(doc, 14, 0)).toThrow(RangeError);
  });

  it('页头 36 字节，对象数在 +24', () => {
    const p = new Uint8Array(36);
    new DataView(p.buffer).setUint32(24, 7, true);
    new DataView(p.buffer).setInt16(4, -5, true);
    expect(decodeContainerHeader(p)).toMatchObject({ objectCount: 7, viewX: -5 });
    expect(decodeContainerHeader(new Uint8Array(30))).toBeUndefined();
  });

  it('字体 1201、文本样式 1203', () => {
    const f = decodeFontEntry(Uint8Array.of(1, 0, 0x41, 0x72, 0, 9, 9, 9));
    expect(f?.attributes).toBe(1);
    expect(f?.name.tail.length).toBe(4);
    const s = decodeTextStyleEntry(words(2, 24, 2, 1, 1, 1, 1, 1, 1, 1));
    expect(s).toMatchObject({ fontIndex: 2, size: 24 });
    expect(decodeTextStyleEntry(new Uint8Array(18))).toBeUndefined();
  });
});

describe('对象头 §8.1', () => {
  function header5(): Uint8Array {
    const p = new Uint8Array(28);
    const v = new DataView(p.buffer);
    v.setUint16(0, 2, true); // 约束
    v.setUint16(2, 3, true); // 状态
    v.setUint16(4, 1, true);
    v.setUint16(6, 2, true);
    v.setUint16(8, 14, true);
    v.setUint16(10, 0x0122, true); // w0=2,w1=2,w2=1
    p.set([0x00, 0x00, 0x80, 0x7e], 12);
    v.setUint16(16, 0xbfff, true);
    v.setUint16(18, 0x1234, true);
    v.setUint32(20, 0xfff0bdc1, true);
    v.setUint32(24, 1, true);
    return p;
  }

  it('布局 5：28 字节', () => {
    const h = decodeObjectHeader(header5(), 5)!;
    expect(h).toMatchObject({
      constraintId: 2, status: 3, field04: 1, mainKind: 2, genera: 14,
      style: [2, 2, 1], colorRef: 0x800000, reserved15: 0x7e, ratioRaw: 0xbfff,
      residual18: 0x1234, sortValue: SORT_VALUE_UNSET, reserved24: 1, byteLength: 28,
    });
    expect(h.ratio).toBeCloseTo(0xbfff / 65535, 10);
  });

  it('布局 4：16 字节，缺省比例 1.0、排序值未指定，样式字是枚举', () => {
    const p = header5().slice(0, 16);
    for (const [word, style] of [[0, [1, 1, 1]], [1, [1, 2, 1]], [2, [2, 2, 1]], [7, [1, 2, 1]]] as const) {
      new DataView(p.buffer).setUint16(10, word, true);
      const h = decodeObjectHeader(p, 4)!;
      expect(h.style).toEqual(style);
      expect(h.ratio).toBe(1);
      expect(h.sortValue).toBe(SORT_VALUE_UNSET);
      expect(h.reserved24).toBe(0);
      expect(h.byteLength).toBe(16);
    }
  });

  it('短于 12 字节返回 undefined', () => {
    expect(decodeObjectHeader(new Uint8Array(11), 5)).toBeUndefined();
  });
});

describe('其它记录视图', () => {
  it('父表 2002：长度必须是 4+4×count', () => {
    expect(decodeParents(Uint8Array.of(2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0))).toEqual([2, 1]);
    expect(decodeParents(Uint8Array.of(2, 0, 0, 0, 2, 0, 0, 0))).toBeUndefined();
  });

  it('标签 2005', () => {
    const payload = new Uint8Array(24 + 3 + 1 + 1);
    const v = new DataView(payload.buffer);
    v.setUint16(0, 3, true);
    v.setUint16(22, 3, true);
    payload.set([0x41, 0x42, 0x43, 0, 0x55], 24);
    const l = decodeLabel(payload, 'utf-8')!;
    expect(l.text).toBe('ABC');
    expect(l.words[0]).toBe(3);
    expect(Array.from(l.tail)).toEqual([0, 0x55]);
    expect(decodeLabel(payload.subarray(0, 20), 'utf-8')).toBeUndefined();
  });

  it('嵌入图片 1300', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const payload = new Uint8Array(8 + png.length);
    payload.set([3, 0, 0, 0, 4, 0, 0, 0]);
    payload.set(png, 8);
    const img = decodeEmbeddedImage(payload)!;
    expect(img).toMatchObject({ width: 3, height: 4 });
    expect(Array.from(img.png)).toEqual(Array.from(png));
  });
});

describe('模型：文本编码选择', () => {
  it('布局 5 基准样本用 UTF-8', () => {
    const model = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'point.gsp'))));
    expect(model.encoding).toBe('utf-8');
    expect(model.pages[0]?.fonts[0]?.name.raw.length).toBeGreaterThan(0);
  });
});
