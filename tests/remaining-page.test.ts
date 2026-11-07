import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { legacyBitmap } from '../src/gsp/bitmap';
import { evaluatePage } from '../src/core/engine';

describe('原版页面剩余对象的证据回归', () => {
  it('旧式DIB只补文件头，检查步长/颜色表和边界', () => {
    const record = new Uint8Array(12 + 40 + 16), v = new DataView(record.buffer);
    record.set(new TextEncoder().encode(' DIB'));
    v.setUint32(12, 40, true); v.setInt32(16, 2, true); v.setInt32(20, 2, true); v.setUint16(24, 1, true); v.setUint16(26, 24, true);
    const bmp = legacyBitmap(record)!;
    expect(bmp.width).toBe(2); expect(bmp.height).toBe(2);
    expect([...bmp.bytes.subarray(0, 2)]).toEqual([66, 77]);
    expect(bmp.bytes.subarray(14)).toEqual(record.subarray(12));
    expect(legacyBitmap(record.slice(0, -1))).toBeUndefined();
    v.setInt32(16, 0x7fffffff, true); expect(legacyBitmap(record)).toBeUndefined();
  });
  const fixture = resolve(import.meta.dirname, '../../reference/raw/runtime/fixtures-p1/arc-measure.gsp');
  it.skipIf(!existsSync(fixture))('原版新建三点弧，度量→弧长，方法44读取与重新写入', () => {
    const doc = decodeGsp(new Uint8Array(readFileSync(fixture))).doc;
    const measure = doc.pages[0].objects.at(-1)!;
    expect(measure.def).toEqual({ k: 'measure', m: 'arclength', refs: [4] });
    const value = evaluatePage(doc.pages[0]).get(measure.id)?.shape;
    expect(value?.k === 'num' && value.q.v).toBeCloseTo(100 * Math.PI / (96 / 2.54));
    expect(decodeGsp(encodeGsp(doc)).doc.pages[0].objects.at(-1)?.def).toEqual(measure.def);
  });
  const old = resolve(import.meta.dirname, '../../sketchpad5/Samples/4.x实例/经典实例.gsp');
  it.skipIf(!existsSync(old))('旧课件的8002位图变为可渲染BMP，保留像素载荷', () => {
    const doc = decodeGsp(new Uint8Array(readFileSync(old))).doc;
    const image = doc.pages.flatMap(p => p.objects).find(o => o.def.k === 'image' && o.def.mime === 'image/bmp');
    expect(image?.def.k).toBe('image');
    if (image?.def.k !== 'image') return;
    expect(image.def.w).toBeGreaterThan(0); expect(image.def.h).toBeGreaterThan(0);
    expect(Buffer.from(image.def.data, 'base64').subarray(0, 2).toString()).toBe('BM');
  });
});
