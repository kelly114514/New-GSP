/** 核心库版本，需与 package.json 的 version 保持一致（有测试检查）。 */
export const CORE_VERSION = '0.1.0';

/**
 * 返回字节序列的前 4 个字节，按 ASCII（逐字节映射到 U+0000–U+00FF）转成字符串。
 * 不足 4 字节时返回实际拥有的字节。不做任何格式校验。
 */
export function readMagic(bytes: Uint8Array): string {
  const n = Math.min(4, bytes.length);
  let s = '';
  for (let i = 0; i < n; i++) {
    s += String.fromCharCode(bytes[i] ?? 0);
  }
  return s;
}
