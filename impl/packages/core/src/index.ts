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

// 相对导入一律带 .ts 扩展名：Node 24 直接运行 TS（scripts/gsp-dump.ts）、vitest、Vite、tsc 都认。
export * from './bytes.ts';
export * from './constraints.ts';
export * from './debug.ts';
export * from './edit.ts';
export * from './errors.ts';
export * from './model.ts';
export * from './parser.ts';
export * from './recordKinds.ts';
export * from './records.ts';
export * from './text.ts';
export * from './tree.ts';
export * from './validate.ts';
export * from './views/container.ts';
export * from './views/docHeader.ts';
export * from './views/envelope.ts';
export * from './views/image.ts';
export * from './views/object.ts';
export * from './views/strings.ts';
export * from './writer.ts';
export * from './geometry.ts';
export * from './arc.ts';
export * from './measure.ts';
export * from './numeric/units.ts';
export * from './numeric/expression.ts';
