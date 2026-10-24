import { describe, expect, it } from 'vitest';
import { GspFormatError, parseGsp, readRecordAt, recordByteLength, splitRecords, writeGsp } from '../src/index';
import { baselineSampleFiles, readBytes } from './support';
import { encodeFile, minimalRecords, words } from './support/synthetic';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof GspFormatError) return e.code;
    throw e;
  }
  return 'no-error';
}

describe('记录层', () => {
  it('splitRecords 返回记录、偏移，奇数长度记录带补齐字节原值', () => {
    const bytes = encodeFile([
      { kind: 7, payload: Uint8Array.of(1, 2, 3), pad: 0x4f },
      { kind: 8, payload: Uint8Array.of(9, 9) },
    ]);
    const { records, offsets } = splitRecords(bytes);
    expect(records.map((r) => r.kind)).toEqual([7, 8]);
    expect(offsets).toEqual([4, 16]);
    expect(records[0]?.pad).toBe(0x4f);
    expect(Array.from(records[0]?.payload ?? [])).toEqual([1, 2, 3]);
    expect(recordByteLength(records[0]!)).toBe(12);
  });

  it('魔数不对 / 太短：bad-magic，偏移 0', () => {
    for (const bytes of [new Uint8Array(0), Uint8Array.of(0x47, 0x53), new TextEncoder().encode('GSPk0000')]) {
      expect(codeOf(() => parseGsp(bytes))).toBe('bad-magic');
      expect(codeOf(() => splitRecords(bytes))).toBe('bad-magic');
    }
  });

  it('记录头被截断、长度越界、缺补齐字节都有明确错误和偏移', () => {
    const good = encodeFile([{ kind: 5, payload: Uint8Array.of(1, 2, 3), pad: 0 }]);
    // 记录头不完整
    expect(() => readRecordAt(good.subarray(0, 8), 4)).toThrowError(/record header needs 8 bytes/);
    // 载荷被截断
    try {
      readRecordAt(good.subarray(0, 13), 4);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GspFormatError);
      expect((e as GspFormatError).code).toBe('length-out-of-bounds');
      expect((e as GspFormatError).offset).toBe(4);
    }
    // 缺补齐字节
    try {
      readRecordAt(good.subarray(0, good.length - 1), 4);
      expect.unreachable();
    } catch (e) {
      expect((e as GspFormatError).code).toBe('truncated');
      expect((e as GspFormatError).offset).toBe(15);
    }
  });

  it('最小合法文档往返；非 0 的补齐字节原样保留', () => {
    const records = minimalRecords();
    // 给 900 之后的页头换成奇数长度的未知记录来带非 0 补齐
    records.splice(3, 0, { kind: 9999, payload: Uint8Array.of(1, 2, 3), pad: 0xaa });
    const bytes = encodeFile(records);
    const doc = parseGsp(bytes);
    expect(Buffer.compare(writeGsp(doc), bytes)).toBe(0);
  });
});

describe('结构校验（负面用例）', () => {
  const sample = baselineSampleFiles().map((f) => ({ name: f.split(/[\\/]/).pop() ?? f, bytes: readBytes(f) }));

  it('第一条记录不是 900 / 不是 28 字节：bad-first-record', () => {
    const recs = minimalRecords();
    expect(codeOf(() => parseGsp(encodeFile(recs.slice(1))))).toBe('bad-first-record');
    const shortHeader = [{ kind: 900, payload: words(5, 1) }, ...recs.slice(1)];
    expect(codeOf(() => parseGsp(encodeFile(shortHeader)))).toBe('bad-first-record');
    expect(codeOf(() => parseGsp(Uint8Array.of(0x47, 0x53, 0x50, 0x34)))).toBe('bad-first-record');
  });

  it('文件在 901 之前结束：bad-last-record；内层未闭合：unbalanced-nesting', () => {
    const recs = minimalRecords();
    expect(codeOf(() => parseGsp(encodeFile(recs.slice(0, -1))))).toBe('bad-last-record');
    expect(codeOf(() => parseGsp(encodeFile(recs.slice(0, 5))))).toBe('unbalanced-nesting');
  });

  it('结束记录与开始记录不配对：unbalanced-nesting', () => {
    const recs = minimalRecords();
    recs[5] = { kind: 1003 }; // 页用工具区的结束记录闭合
    expect(codeOf(() => parseGsp(encodeFile(recs)))).toBe('unbalanced-nesting');
    const stray = minimalRecords();
    stray.splice(1, 0, { kind: 903 });
    expect(codeOf(() => parseGsp(encodeFile(stray)))).toBe('unbalanced-nesting');
  });

  it('成对记录出现在不允许的位置：unexpected-nesting', () => {
    const recs = minimalRecords();
    recs.splice(4, 0, { kind: 2000, payload: new Uint8Array(28) }); // 对象里再开对象
    expect(codeOf(() => parseGsp(encodeFile(recs)))).toBe('unexpected-nesting');
    const direct = minimalRecords();
    direct.splice(1, 0, { kind: 1000, payload: new Uint8Array(36) }); // 900 里直接放页
    expect(codeOf(() => parseGsp(encodeFile(direct)))).toBe('unexpected-nesting');
  });

  it('对象头短于 12 字节：bad-object-header', () => {
    const recs = minimalRecords();
    recs[3] = { kind: 2000, payload: new Uint8Array(10) };
    expect(codeOf(() => parseGsp(encodeFile(recs)))).toBe('bad-object-header');
  });

  it('不认识的 kind 保留在原位置（文档层、信封层、页、对象），往返一致', () => {
    const recs = minimalRecords();
    recs.splice(1, 0, { kind: 12345, payload: Uint8Array.of(1) }); // 文档层
    recs.splice(4, 0, { kind: 12346, payload: Uint8Array.of(2, 3) }); // 信封层（902 之后、1000 之前）
    recs.splice(6, 0, { kind: 12347, payload: Uint8Array.of(4, 5, 6) }); // 页内
    recs.splice(8, 0, { kind: 12348 }); // 对象内
    const bytes = encodeFile(recs);
    const doc = parseGsp(bytes);
    expect(Buffer.compare(writeGsp(doc), bytes)).toBe(0);
    expect(doc.items.some((i) => 'kind' in i && i.kind === 12345)).toBe(true);
  });

  it('901 之后的多余字节作为尾部块保留', () => {
    const trailing = Uint8Array.of(1, 2, 3, 4, 5);
    const bytes = encodeFile(minimalRecords(), trailing);
    const doc = parseGsp(bytes);
    expect(Array.from(doc.trailing)).toEqual([1, 2, 3, 4, 5]);
    expect(Buffer.compare(writeGsp(doc), bytes)).toBe(0);
  });

  it('copy 选项：缺省复制输入，改输入不影响文档', () => {
    const bytes = encodeFile(minimalRecords());
    const doc = parseGsp(bytes);
    const copyBefore = writeGsp(doc);
    bytes.fill(0xee, 4);
    expect(Buffer.compare(writeGsp(doc), copyBefore)).toBe(0);
  });

  it('基线样本的任意前缀（截断）都被拒绝', () => {
    for (const { name, bytes } of sample) {
      for (let n = 0; n < bytes.length; n++) {
        const code = codeOf(() => parseGsp(bytes.subarray(0, n)));
        expect(code, `${name} 截到 ${n} 字节`).not.toBe('no-error');
      }
    }
  });

  it('翻转任一记录长度字段的第 0、1、15、31 位都被拒绝', () => {
    for (const { name, bytes } of sample) {
      const { offsets } = splitRecords(bytes);
      for (const bit of [0, 1, 15, 31]) {
        for (const off of offsets) {
          const mutated = bytes.slice();
          mutated[off + (bit >> 3)] = (mutated[off + (bit >> 3)] ?? 0) ^ (1 << (bit & 7));
          const code = codeOf(() => parseGsp(mutated));
          expect(code, `${name} 偏移 ${off} 位 ${bit}`).not.toBe('no-error');
        }
      }
    }
  });
});
