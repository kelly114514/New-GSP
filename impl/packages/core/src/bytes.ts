/** 字节小工具。全部整数小端。 */

export const EMPTY_BYTES: Uint8Array = new Uint8Array(0);

/** 给一段 Uint8Array 建 DataView（尊重 byteOffset）。 */
export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** 读小端 u16。调用者保证 offset+2 不越界。 */
export function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

/** 读小端 u32（返回非负数）。调用者保证 offset+4 不越界。 */
export function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** 读小端 i16。 */
export function readI16(bytes: Uint8Array, offset: number): number {
  return (readU16(bytes, offset) << 16) >> 16;
}

/** 读小端 f64。调用者保证 offset+8 不越界。 */
export function readF64(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true);
}

/** 写小端 u16。 */
export function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

/** 写小端 u32。 */
export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** 写小端 f64。 */
export function writeF64(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 8).setFloat64(0, value, true);
}

/** 十六进制串，字节间用空格。limit 限制最多输出多少个字节（其余省略，不加记号）。 */
export function toHex(bytes: Uint8Array, limit: number = bytes.length): string {
  const n = Math.min(bytes.length, limit);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push((bytes[i] ?? 0).toString(16).padStart(2, '0'));
  }
  return parts.join(' ');
}

/** 逐字节比较。 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 拼接若干段字节。 */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
