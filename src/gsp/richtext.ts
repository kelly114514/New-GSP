/** 读取文本容器和对象插入标记。文字载荷按字节长度读取，避免把正文中的尖括号当标签。 */
import type { FontSpec, TextRun } from '../core/model';

/** 仅接受含文本、行列和已核验字体属性的标记；其它来源内容不能被整段替换。 */
export function isPlainTextMarkup(bytes: Uint8Array): boolean {
  let at = 0;
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const element = (depth: number): boolean => {
    if (depth > 64 || bytes[at++] !== 60) return false;
    if (bytes[at] === 84) {
      at++;
      if (ascii(at, at + 3) === "''>") { at += 3; return true; }
      const start = at;
      while (at < bytes.length && /[0-9a-f]/i.test(String.fromCharCode(bytes[at]))) at++;
      if (at === start || bytes[at++] !== 120) return false;
      const n = parseInt(ascii(start, at - 1), 16);
      if (!Number.isSafeInteger(n) || at + n >= bytes.length || bytes[at + n] !== 62) return false;
      at += n + 1; return true;
    }
    const start = at;
    while (at < bytes.length && bytes[at] !== 60 && bytes[at] !== 62) at++;
    const head = ascii(start, at);
    if (head !== 'VL' && head !== 'H' && !/^S(?:#[0-9a-f]+|P[0-9a-f]*|[WSU][12]|[RGL][0-9a-f]+)*$/i.test(head)) return false;
    while (at < bytes.length && bytes[at] === 60) if (!element(depth + 1)) return false;
    return bytes[at++] === 62;
  };
  while (at < bytes.length) if (!element(0)) return false;
  return at === bytes.length;
}

export function readRichText(bytes: Uint8Array, refCount: number, firstRef: number, legacy = false, legacyDecimalRefs = false): string | undefined {
  return readRichTextRuns(bytes, refCount, firstRef, { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' }, undefined, legacy, legacyDecimalRefs)?.map(r => r.text).join('');
}
/** 同一个字节解析器同时保留各层S样式，不通过正则切割文字载荷。 */
export function readRichTextRuns(bytes: Uint8Array, refCount: number, firstRef: number, base: FontSpec, style?: (head: string, parent: FontSpec) => FontSpec, legacy = false, legacyDecimalRefs = false): TextRun[] | undefined {
  let at = 0, valid = true;
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const text = (data: Uint8Array) => {
    if (legacy) return new TextDecoder('gbk').decode(data);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { return new TextDecoder('gbk').decode(data); }
  };
  const element = (font: FontSpec, vectorRows = false): TextRun[] => {
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
      children.push(element(current, head === '{'));
    }
    if (bytes[at++] !== 62) valid = false;
    const ref = /^\?1?x(?:([AD])(?=[0-9a-f]{4}$))?([0-9a-f]{1,4})$/i.exec(head);
    if (ref) {
      const [, mode, digits] = ref;
      const decimal = legacyDecimalRefs && digits.length < 4 && /^\d+$/.test(digits);
      const index = parseInt(digits, decimal ? 10 : 16) - firstRef;
      if (index < 0 || index >= refCount) { valid = false; return []; }
      return [{ text: `${index}${mode ? ':' + mode.toUpperCase() : ''}`, font: { ...current } }];
    }
    const glyph = ({ '!103': '−', '!62': 'β', '!70': 'π', '!AE': '→', '!D7': '×', '!DE': '⇒' } as Record<string, string>)[head];
    if (glyph) return [{ text: glyph, font: { ...current } }];
    if (head === '{') return [{ text: '(', font: { ...current } }, ...children.flat(), { text: ')', font: { ...current } }];
    if ((head === '+' || head === '-') && children.length === 2) {
      const index = children[1].map(r => r.text).join('');
      if (/^[0-9+−-]+$/.test(index)) {
        const glyphs = head === '+' ? '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻' : '₀₁₂₃₄₅₆₇₈₉₊₋';
        const mapped = children[1].map(r => ({ ...r, text: r.text.replace(/[0-9+−-]/g, ch => glyphs[ch === '+' ? 10 : /[−-]/.test(ch) ? 11 : Number(ch)]) }));
        return [...children[0], ...mapped];
      }
      if (index) return [
        ...children[0], { text: head === '+' ? '^(' : '_(', font: { ...current } },
        ...children[1], { text: ')', font: { ...current } },
      ];
    }
    const alternative = /^\?(\d+)$/.exec(head);
    if (alternative) return children[Math.max(0, Number(alternative[1]) - 1)] ?? [];
    // 旧版编码器把同一行的文字和插入对象直接放在 VL 下；保留这些文件的读回兼容。
    if (vectorRows && head.startsWith('V')) return children.flatMap((runs, i) => i ? [{ text: ', ', font: { ...current } }, ...runs] : runs);
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

/** 富文本的结构树：分数、上下标、根号、括号保留成节点，按公式排版绘制（原版 复变换.gsp 的 z→1/z，正六边形点迭代说明的 √、上标）。 */
export type RichNode =
  | { t: 'run'; text: string; font: FontSpec }
  | { t: 'ref'; index: number; mode?: 'A' | 'D'; font: FontSpec }
  | { t: 'row'; items: RichNode[] }
  | { t: 'col'; items: RichNode[] }
  | { t: 'frac'; num: RichNode; den: RichNode }
  | { t: 'sup'; base: RichNode; exp: RichNode }
  | { t: 'sub'; base: RichNode; sub: RichNode }
  | { t: 'root'; body: RichNode }
  | { t: 'paren'; body: RichNode; font: FontSpec };

const STRUCT = new Set(['frac', 'sup', 'sub', 'root', 'paren']);
export const hasStructure = (n: RichNode): boolean => STRUCT.has(n.t) || ((n.t === 'row' || n.t === 'col') && n.items.some(hasStructure));

export function readRichTextTree(bytes: Uint8Array, refCount: number, firstRef: number, base: FontSpec, style?: (head: string, parent: FontSpec) => FontSpec, legacy = false, legacyDecimalRefs = false): RichNode | undefined {
  let at = 0, valid = true;
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const text = (data: Uint8Array) => {
    if (legacy) return new TextDecoder('gbk').decode(data);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { return new TextDecoder('gbk').decode(data); }
  };
  const row = (items: RichNode[]): RichNode => (items.length === 1 ? items[0] : { t: 'row', items });
  const element = (font: FontSpec): RichNode => {
    if (bytes[at++] !== 60) { valid = false; return { t: 'row', items: [] }; }
    if (bytes[at] === 84) {
      at++;
      if (ascii(at, at + 3) === "''>") { at += 3; return { t: 'row', items: [] }; }
      const begin = at;
      while (at < bytes.length && /[0-9a-f]/i.test(String.fromCharCode(bytes[at]))) at++;
      if (bytes[at] !== 120 || at === begin) { valid = false; return { t: 'row', items: [] }; }
      const n = parseInt(ascii(begin, at), 16); at++;
      if (at + n >= bytes.length || bytes[at + n] !== 62) { valid = false; return { t: 'row', items: [] }; }
      const s = text(bytes.subarray(at, at + n)); at += n + 1; return { t: 'run', text: s, font: { ...font } };
    }
    const begin = at;
    while (at < bytes.length && bytes[at] !== 60 && bytes[at] !== 62) at++;
    const head = ascii(begin, at), children: RichNode[] = [];
    const current = head.startsWith('S') && style ? style(head.slice(1), font) : font;
    let directRef = false;
    while (at < bytes.length && bytes[at] === 60 && valid) {
      if (bytes[at + 1] === 63) directRef = true;
      children.push(element(current));
    }
    if (bytes[at++] !== 62) valid = false;
    const ref = /^\?1?x(?:([AD])(?=[0-9a-f]{4}$))?([0-9a-f]{1,4})$/i.exec(head);
    if (ref) {
      const [, mode, digits] = ref;
      const decimal = legacyDecimalRefs && digits.length < 4 && /^\d+$/.test(digits);
      const index = parseInt(digits, decimal ? 10 : 16) - firstRef;
      if (index < 0 || index >= refCount) { valid = false; return { t: 'row', items: [] }; }
      return { t: 'ref', index, ...(mode ? { mode: mode.toUpperCase() as 'A' | 'D' } : {}), font: { ...current } };
    }
    const glyph = ({ '!103': '−', '!62': 'β', '!70': 'π', '!AE': '→', '!D7': '×', '!DE': '⇒' } as Record<string, string>)[head];
    if (glyph) return { t: 'run', text: glyph, font: { ...current } };
    if (head === '{') return { t: 'paren', body: row(children), font: { ...current } };
    if (head === '(') return { t: 'paren', body: row(children), font: { ...current } };
    if (head === '/' && children.length === 2) return { t: 'frac', num: children[0], den: children[1] };
    if (head === 'R' && children.length >= 1) return { t: 'root', body: row(children) };
    if (head === '+' && children.length === 2) return { t: 'sup', base: children[0], exp: children[1] };
    if (head === '-' && children.length === 2) return { t: 'sub', base: children[0], sub: children[1] };
    const alternative = /^\?(\d+)$/.exec(head);
    if (alternative) return children[Math.max(0, Number(alternative[1]) - 1)] ?? { t: 'row', items: [] };
    if (head.startsWith('V') && !directRef) return { t: 'col', items: children };
    return row(children);
  };
  const items: RichNode[] = [];
  while (at < bytes.length && bytes[at] !== 0 && valid) {
    if (bytes[at] !== 60) { valid = false; break; }
    items.push(element(base));
  }
  return valid ? row(items) : undefined;
}
