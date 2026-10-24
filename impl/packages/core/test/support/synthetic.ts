import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildEnvelopePayload, writeU16, writeU32 } from '../../src/index';
import { repoRoot } from './corpus';

/** 一条原始记录（测试用，可指定补齐字节）。 */
export interface RawSpec {
  kind: number;
  payload?: Uint8Array;
  pad?: number;
}

/** 魔数 + 记录序列 → 字节。 */
export function encodeFile(records: readonly RawSpec[], trailing: Uint8Array = new Uint8Array(0)): Uint8Array {
  let total = 4;
  for (const r of records) {
    const n = r.payload?.length ?? 0;
    total += 8 + n + (n & 1);
  }
  const out = new Uint8Array(total + trailing.length);
  out.set([0x47, 0x53, 0x50, 0x34], 0);
  let pos = 4;
  for (const r of records) {
    const p = r.payload ?? new Uint8Array(0);
    writeU32(out, pos, p.length);
    writeU32(out, pos + 4, r.kind);
    out.set(p, pos + 8);
    if (p.length & 1) out[pos + 8 + p.length] = r.pad ?? 0;
    pos += 8 + p.length + (p.length & 1);
  }
  out.set(trailing, pos);
  return out;
}

export function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  values.forEach((v, i) => writeU16(out, i * 2, v));
  return out;
}

export function pageEnvelopePayload(): Uint8Array {
  return buildEnvelopePayload([1, 4, 4, 1, 1, 2, 0, 0], ['', 'too new', 'may lose info']);
}

/** 最小的合法文档：900 + 一个页信封（含一个自由对象）+ 901。 */
export function minimalRecords(): RawSpec[] {
  return [
    { kind: 900, payload: words(5, 1, 0, 0, 0, 0, 1, 4, 0, 1194, 640, 9, 1, 0) },
    { kind: 902, payload: pageEnvelopePayload() },
    { kind: 1000, payload: new Uint8Array(36) },
    { kind: 2000, payload: new Uint8Array(28) },
    { kind: 2007 },
    { kind: 1001 },
    { kind: 903 },
    { kind: 901 },
  ];
}

export const crashFixturePath = resolve(repoRoot, 'spec', 'format', 'fixtures', 'crash-19byte-envelope.gsp');

export function readCrashFixture(): Uint8Array {
  return new Uint8Array(readFileSync(crashFixturePath));
}
