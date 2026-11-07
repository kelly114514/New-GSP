/** 旧课件8002记录：12字节容器头后是标准DIB。补BMP文件头供浏览器解码，不改像素。 */
export function legacyBitmap(record: Uint8Array): { bytes: Uint8Array; width: number; height: number } | undefined {
  if (record.length < 52 || String.fromCharCode(...record.subarray(0, 4)) !== ' DIB') return;
  const dib = record.subarray(12), v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const header = v.getUint32(0, true), width = v.getInt32(4, true), height = Math.abs(v.getInt32(8, true));
  const bits = v.getUint16(14, true), compression = v.getUint32(16, true);
  if (header < 40 || header > dib.length || v.getUint16(12, true) !== 1 || ![1, 4, 8, 16, 24, 32].includes(bits) || ![0, 3].includes(compression) || width <= 0 || height <= 0 || width * height > 25000000) return;
  const colors = v.getUint32(32, true) || (bits <= 8 ? 2 ** bits : 0);
  const offset = header + colors * 4 + (header === 40 && compression === 3 ? 12 : 0);
  const size = Math.ceil(width * bits / 32) * 4 * height;
  if (offset > dib.length || size > dib.length - offset) return;
  const bytes = new Uint8Array(14 + dib.length), b = new DataView(bytes.buffer);
  bytes.set([66, 77]); b.setUint32(2, bytes.length, true); b.setUint32(10, 14 + offset, true); bytes.set(dib, 14);
  return { bytes, width, height };
}
