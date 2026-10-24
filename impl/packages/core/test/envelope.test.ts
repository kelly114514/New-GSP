import { describe, expect, it } from 'vitest';
import {
  GspFormatError,
  buildEnvelopePayload,
  decodeEnvelope,
  envelopeStringTexts,
  parseEnvelopePayload,
  parseGsp,
  splitRecords,
} from '../src/index';
import { baselineSampleFiles, readBytes } from './support';
import { readCrashFixture } from './support/synthetic';

describe('崩溃夹具 crash-19byte-envelope.gsp', () => {
  it('被读取器拒绝，错误码 bad-envelope，指向信封载荷里的位置', () => {
    const bytes = readCrashFixture();
    let error: unknown;
    try {
      parseGsp(bytes);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GspFormatError);
    const err = error as GspFormatError;
    expect(err.code).toBe('bad-envelope');
    expect(err.reason).toMatch(/pad byte/);
    // 偏移落在第一个 902 的载荷里
    const { records, offsets } = splitRecords(bytes);
    const idx = records.findIndex((r) => r.kind === 902);
    expect(records[idx]?.payload.length).toBe(19);
    const start = (offsets[idx] ?? 0) + 8;
    expect(err.offset).toBeGreaterThanOrEqual(start);
    expect(err.offset).toBeLessThanOrEqual(start + 19); // 缺失的补齐字节就在载荷末尾
  });
});

describe('信封载荷 §5.2', () => {
  const header = [1, 4, 4, 3, 3, 2, 0, 0];

  it('buildEnvelopePayload 与 parseEnvelopePayload 互逆，补齐字节保留', () => {
    const payload = buildEnvelopePayload(header, [{ raw: new Uint8Array(0), pad: 0x4f }, 'abc', '中文']);
    const parsed = parseEnvelopePayload(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.info.header).toEqual(header);
    expect(parsed.info.strings.map((s) => s.pad)).toEqual([0x4f, null, 0]);
    expect(envelopeStringTexts(parsed.info, 'utf-8')).toEqual(['', 'abc', '中文']);
    expect(payload.length).toBe(16 + 4 + 6 + (2 + 6 + 1 + 1));
  });

  it('基线样本的信封都合规', () => {
    for (const f of baselineSampleFiles()) {
      const { records } = splitRecords(readBytes(f));
      for (const r of records.filter((x) => x.kind === 902)) {
        expect(decodeEnvelope(r.payload), f).toBeDefined();
      }
    }
  });

  it('拒绝各种不合规结构', () => {
    const good = buildEnvelopePayload(header, ['', 'a', 'bc']);
    expect(parseEnvelopePayload(good).ok).toBe(true);
    const bad = (p: Uint8Array): string => {
      const r = parseEnvelopePayload(p);
      return r.ok ? 'ok' : r.reason;
    };
    expect(bad(good.subarray(0, 10))).toMatch(/shorter than the 16-byte header/);
    expect(bad(good.subarray(0, good.length - 1))).toMatch(/pad byte|payload ends/);
    expect(bad(good.subarray(0, 16 + 4))).toMatch(/no length prefix/); // 只有一个串
    const extra = new Uint8Array(good.length + 2);
    extra.set(good);
    expect(bad(extra)).toMatch(/unexpected bytes/);
    const withNul = buildEnvelopePayload(header, ['', 'abc', 'x']);
    withNul[16 + 4 + 2 + 1] = 0; // 串 1 中间嵌入 NUL
    expect(bad(withNul)).toMatch(/NUL/);
    const wrongLen = good.slice();
    wrongLen[16] = 1; // 串 0 声明长度 1，但后面是 NUL
    expect(bad(wrongLen)).not.toBe('ok');
  });

  it('19 字节 = 16 字节头 + 3 个 00 不合规（崩溃条件）', () => {
    const payload = new Uint8Array(19);
    const r = parseEnvelopePayload(payload);
    expect(r.ok).toBe(false);
  });
});
