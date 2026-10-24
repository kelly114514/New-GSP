import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeFreePoint,
  forEachRecord,
  objectNodesOf,
  pagesOf,
  parseGsp,
  readDocumentModel,
  setFreePointCoordinates,
  validateDocument,
  writeGsp,
} from '../src/index';
import { baselineSamplesDir, readBytes, repoRoot } from './support';

interface BaselineObject {
  id: number;
  external_constraint: number;
  external_kind: number;
  external_genera: number;
  field_08: number;
  field_04: number;
  style_words: number[];
  colorref: number;
  parents: number[];
  saved_coordinates?: number[];
}
interface BaselineSample {
  bytes: number;
  sha256: string;
  format_version: number;
  pages: number;
  objects: BaselineObject[];
}

const baseline = JSON.parse(
  readFileSync(join(repoRoot, 'samples', 'baseline', 'baseline.json'), 'utf8'),
) as { samples: Record<string, BaselineSample> };

describe('基准样本的对象图与 baseline.json 一致', () => {
  for (const [name, expected] of Object.entries(baseline.samples)) {
    it(name, () => {
      const bytes = readBytes(join(baselineSamplesDir, name));
      expect(bytes.length).toBe(expected.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected.sha256);

      const doc = parseGsp(bytes);
      const model = readDocumentModel(doc);
      expect(model.layout).toBe(expected.format_version);
      expect(model.pages.length).toBe(expected.pages);
      expect(model.tools.length).toBe(0);
      expect(validateDocument(doc)).toEqual([]);

      const objects = model.pages[0]?.objects ?? [];
      expect(objects.length).toBe(expected.objects.length);
      objects.forEach((o, i) => {
        const e = expected.objects[i]!;
        expect(o.index).toBe(e.id);
        expect(o.header.constraintId).toBe(e.external_constraint);
        expect(o.header.mainKind).toBe(e.external_kind);
        expect(o.header.genera).toBe(e.external_genera);
        // baseline.json 的 field_08 / field_04 对应状态字（+2）和 field04（+4）
        expect(o.header.status).toBe(e.field_08);
        expect(o.header.field04).toBe(e.field_04);
        expect(o.header.style).toEqual(e.style_words);
        expect(o.header.colorRef).toBe(e.colorref);
        expect(o.parents).toEqual(e.parents);
        if (e.saved_coordinates === undefined) {
          expect(o.freePoint).toBeUndefined();
        } else {
          expect([o.freePoint?.x, o.freePoint?.y]).toEqual(e.saved_coordinates);
        }
        expect(o.constraint?.extId).toBe(e.external_constraint);
      });
      // 约束描述符取自目录：中点、线段
      if (name === 'midpoint.gsp') {
        expect(objects[3]?.constraint?.descriptionTemplate).toContain('中点');
        expect(objects[2]?.constraint?.descriptionTemplate).toContain('线段');
      }
    });
  }

  it('每个基准样本字节级往返', () => {
    for (const name of Object.keys(baseline.samples)) {
      const bytes = readBytes(join(baselineSamplesDir, name));
      expect(Buffer.compare(writeGsp(parseGsp(bytes)), bytes), name).toBe(0);
    }
  });
});

describe('编辑原语 setFreePointCoordinates', () => {
  const file = join(baselineSamplesDir, 'midpoint.gsp');

  it('只改那 16 个字节，输出仍可读，新坐标读得回', () => {
    const original = readBytes(file);
    const doc = parseGsp(original);
    setFreePointCoordinates(doc, 0, 1, 251, 174);
    const out = writeGsp(doc);

    expect(out.length).toBe(original.length);
    const diff: number[] = [];
    for (let i = 0; i < out.length; i++) if (out[i] !== original[i]) diff.push(i);
    expect(diff.length).toBeGreaterThan(0);
    // 变化的字节全部落在第 1 个对象的 2201 载荷的 16 字节内，且是连续的 16 字节窗口
    const first = diff[0]!;
    const last = diff[diff.length - 1]!;
    expect(last - first).toBeLessThan(16);
    // 找到 2201 载荷在文件里的位置：直接在原文件里搜索原坐标字节
    const target = new Uint8Array(16);
    new DataView(target.buffer).setFloat64(0, 211, true);
    new DataView(target.buffer).setFloat64(8, 147, true);
    let at = -1;
    for (let i = 0; i + 16 <= original.length && at < 0; i++) {
      if (original.subarray(i, i + 16).every((b, j) => b === target[j])) at = i;
    }
    expect(at).toBeGreaterThan(0);
    expect(first).toBeGreaterThanOrEqual(at);
    expect(last).toBeLessThan(at + 16);

    const reparsed = parseGsp(out);
    const model = readDocumentModel(reparsed);
    expect(model.pages[0]?.objects[0]?.freePoint).toEqual({ x: 251, y: 174 });
    expect(model.pages[0]?.objects[1]?.freePoint).toEqual({ x: 411, y: 281 });
    expect(validateDocument(reparsed)).toEqual([]);
  });

  it('不修改输入缓冲区，也不依赖缓存字节（对象节点里的载荷换成新数组）', () => {
    const original = readBytes(file);
    const snapshot = original.slice();
    const doc = parseGsp(original, { copy: false });
    setFreePointCoordinates(doc, pagesOf(doc)[0]!, 1, 1.5, -2.25);
    expect(Buffer.compare(original, snapshot)).toBe(0);
    const node = objectNodesOf(pagesOf(doc)[0]!)[0]!;
    const rec = node.records.find((r) => r.kind === 2201)!;
    expect(decodeFreePoint(rec.payload)).toEqual({ x: 1.5, y: -2.25 });
  });

  it('改后与 midpoint-moved.gsp 的模型一致（原版移动后的文件）', () => {
    const doc = parseGsp(readBytes(file));
    setFreePointCoordinates(doc, 0, 1, 251, 174);
    const moved = readDocumentModel(parseGsp(readBytes(join(baselineSamplesDir, 'midpoint-moved.gsp'))));
    const mine = readDocumentModel(doc);
    expect(mine.pages[0]?.objects.map((o) => [o.constraintId, o.parents, o.freePoint])).toEqual(
      moved.pages[0]?.objects.map((o) => [o.constraintId, o.parents, o.freePoint]),
    );
  });

  it('不是自由点或越界时抛 RangeError', () => {
    const doc = parseGsp(readBytes(file));
    expect(() => setFreePointCoordinates(doc, 0, 3, 1, 1)).toThrow(RangeError); // 线段
    expect(() => setFreePointCoordinates(doc, 0, 4, 1, 1)).toThrow(RangeError); // 中点
    expect(() => setFreePointCoordinates(doc, 0, 99, 1, 1)).toThrow(RangeError);
    expect(() => setFreePointCoordinates(doc, 5, 1, 1, 1)).toThrow(RangeError);
    expect(() => setFreePointCoordinates(doc, 0, 1, Number.NaN, 1)).toThrow(RangeError);
  });

  it('forEachRecord 与写出字节数一致', () => {
    const doc = parseGsp(readBytes(file));
    let n = 0;
    forEachRecord(doc, () => n++);
    expect(n).toBeGreaterThan(50);
  });
});
