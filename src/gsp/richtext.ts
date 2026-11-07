/** 读取文本容器和对象插入标记。文字载荷按字节长度读取，避免把正文中的尖括号当标签。 */
import type { FontSpec, TextRun } from '../core/model';

export function readRichText(bytes: Uint8Array, refCount: number, firstRef: number, legacy = false): string | undefined {
  return readRichTextRuns(bytes, refCount, firstRef, { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' }, undefined, legacy)?.map(r => r.text).join('');
}
/** 同一个字节解析器同时保留各层S样式，不通过正则切割文字载荷。 */
export function readRichTextRuns(bytes: Uint8Array, refCount: number, firstRef: number, base: FontSpec, style?: (head: string, parent: FontSpec) => FontSpec, legacy = false): TextRun[] | undefined {
  let at = 0, valid = true;
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const text = (data: Uint8Array) => {
    if (legacy) return new TextDecoder('gbk').decode(data);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { return new TextDecoder('gbk').decode(data); }
  };
  const element = (font: FontSpec): TextRun[] => {
    if (bytes[at++] !== 60) { valid = false; return []; }
    if (bytes[at] === 84) {
      at++;
      if (ascii(at, at + 3) === "''>") { at += 3; return []; }
      const begin = at;
      while (at < bytes.length && /[0-9a-f]/i.test(String.fromCharCode(bytes[at]))) at++;
      if (bytes[at] !== 120 || at === begin) { valid = false; return []; }
      const n = parseInt(ascii(begin, at), 16); at++;
      if (at + n >= bytes.length || bytes[at + n] !== 62) { valid = false; return []; }
      const s = text(bytes.subarray(at, at + n)); at += n + 1; return [{ text: s, font: { ...font } }];
    }
    const begin = at;
    while (at < bytes.length && bytes[at] !== 60 && bytes[at] !== 62) at++;
    const head = ascii(begin, at), children: TextRun[][] = [];
    const current = head.startsWith('S') && style ? style(head.slice(1), font) : font;
    let directRef = false;
    while (at < bytes.length && bytes[at] === 60 && valid) {
      if (bytes[at + 1] === 63) directRef = true;
      children.push(element(current));
    }
    if (bytes[at++] !== 62) valid = false;
    const ref = /^\?1?x(\d+)$/.exec(head);
    if (ref) {
      const index = Number(ref[1]) - firstRef;
      if (index < 0 || index >= refCount) { valid = false; return []; }
      return [{ text: `${index}`, font: { ...current } }];
    }
    const alternative = /^\?(\d+)$/.exec(head);
    if (alternative) return children[Math.max(0, Number(alternative[1]) - 1)] ?? [];
    // 旧版编码器把同一行的文字和插入对象直接放在 VL 下；保留这些文件的读回兼容。
    const inlineRefs = head.startsWith('V') && directRef;
    return children.flatMap((runs, i) => i && head.startsWith('V') && !inlineRefs ? [{ text: '\n', font: { ...current } }, ...runs] : runs);
  };
  const chunks: TextRun[] = [];
  while (at < bytes.length && bytes[at] !== 0 && valid) {
    if (bytes[at] !== 60) { valid = false; break; }
    chunks.push(...element(base));
  }
  return valid ? chunks : undefined;
}
