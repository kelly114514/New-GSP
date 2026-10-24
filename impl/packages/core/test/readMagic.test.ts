import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION, readMagic } from '../src/index';

describe('readMagic', () => {
  it('返回前 4 个字节的 ASCII 字符串', () => {
    expect(readMagic(Uint8Array.of(0x47, 0x53, 0x50, 0x34, 0x00, 0x01))).toBe('GSP4');
  });

  it('恰好 4 字节', () => {
    expect(readMagic(new TextEncoder().encode('ABCD'))).toBe('ABCD');
  });

  it('不足 4 字节时返回实际拥有的字节，空输入返回空串', () => {
    expect(readMagic(Uint8Array.of(0x47, 0x53))).toBe('GS');
    expect(readMagic(new Uint8Array(0))).toBe('');
  });

  it('只看前 4 个字节，高位字节逐字节映射而不丢失', () => {
    expect(readMagic(Uint8Array.of(0x47, 0xff, 0x50, 0x34, 0x58))).toBe(`G${String.fromCharCode(0xff)}P4`);
  });

  it('可以读取 Uint8Array 的子视图', () => {
    const whole = Uint8Array.of(0, 0, 0x47, 0x53, 0x50, 0x34, 0);
    expect(readMagic(whole.subarray(2))).toBe('GSP4');
  });
});

describe('CORE_VERSION', () => {
  it('与 package.json 的 version 一致', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(CORE_VERSION).toBe(pkg.version);
  });
});
