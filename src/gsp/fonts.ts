/** 原版文件使用已通过原版另存验证的 Windows 字体中文名。 */
export function originalFontName(name: string): string {
  switch (name.trim().toLowerCase()) {
    case 'simsun': return '宋体';
    case 'simhei': return '黑体';
    case 'kaiti': return '楷体';
    case 'microsoft yahei': return '微软雅黑';
    default: return name;
  }
}

/** 字体常见属性值来自全库的 1201 记录。 */
const attributes = new Map([
  ['Times New Roman', 1], ['黑体', 4], ['楷体', 4],
  ['Wingdings', 8], ['Wingdings 2', 9], ['Symbol', 9],
]);

export function fontRecord(name: string): Uint8Array {
  const utf8 = new TextEncoder().encode(name);
  const bytes = new Uint8Array(4 + ((utf8.length + 2) & ~1));
  new DataView(bytes.buffer).setUint16(0, attributes.get(name) ?? 0, true);
  bytes.set(utf8, 2); // 预留 NUL、偶数对齐和末尾 u16。
  return bytes;
}
