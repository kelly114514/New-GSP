/**
 * 嵌入图片 1300（规格 §5.7）：`u32 宽 | u32 高 | 完整 PNG 文件`，PNG 从载荷偏移 8 起到末尾。
 */

import { readU32 } from '../bytes.ts';

export interface EmbeddedImage {
  width: number;
  height: number;
  /** 完整 PNG 文件的字节（载荷的视图）。 */
  png: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 解码 1300；不足 8 字节返回 undefined。 */
export function decodeEmbeddedImage(payload: Uint8Array): EmbeddedImage | undefined {
  if (payload.length < 8) return undefined;
  return {
    width: readU32(payload, 0),
    height: readU32(payload, 4),
    png: payload.subarray(8),
  };
}

/** 字节是否以 PNG 签名开头。 */
export function hasPngSignature(png: Uint8Array): boolean {
  if (png.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** 读 PNG 的 IHDR 宽高（偏移 16、20，大端）；不是合规 PNG 头返回 undefined。 */
export function readPngSize(png: Uint8Array): { width: number; height: number } | undefined {
  if (png.length < 24 || !hasPngSignature(png)) return undefined;
  const be32 = (o: number): number =>
    (((png[o] ?? 0) << 24) | ((png[o + 1] ?? 0) << 16) | ((png[o + 2] ?? 0) << 8) | (png[o + 3] ?? 0)) >>> 0;
  return { width: be32(16), height: be32(20) };
}
