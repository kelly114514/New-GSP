/** 文件编解码：原版 .gsp（已用原版生成的样本核实的子集）与新版课件 .ngsp（完整、无损）。 */
import { readRecords, type RecordEntry } from './records';
import { readRichText, readRichTextRuns } from './richtext';
import { legacyBitmap } from './bitmap';
import { compareContent, describeDifference, sourceSnapshot } from './semantic';
import { type FuncForm, DEFAULT_DISPLAY, TEXT_CATS, TEXT_DEFAULTS, type DisplayPrefs, type TextStyle, newDoc, emptyPage, defaultStyle, parentsOf, isPointDef, type Def, type Doc, type EmbeddedTool, type Id, type Obj, type Page, type Style } from '../core/model';
import { CM, type Expr } from '../core/expr';
import { evaluatePage, type Results } from '../core/engine';
import { imageBox, imageCorners, type Affine } from '../core/image';
import { measureName as measureTitle } from '../ui/render';

export class Unsupported extends Error {}
export interface DecodeResult { doc: Doc; source: Source; notes: string[] }
export interface Source { kind: 'gsp' | 'ngsp' | 'new'; bytes?: Uint8Array; protectedReason?: string; unmodifiedJson?: string }
export type EncodeResult = { ok: true; bytes: Uint8Array; source: Source; ext: 'gsp' | 'ngsp'; notes?: string[] } | { ok: false; reason: string; unsupported: string[] };

const NGSP_MAGIC = 'NGSP1\n';
const enc = new TextEncoder(), dec = new TextDecoder('utf-8');
const gbk = new TextDecoder('gbk');
/** 老工具混用 UTF-8 与简体中文代码页；先严格解 UTF-8，失败才按 GBK 解，原始工具段仍原样保留。 */
function legacyText(bytes: Uint8Array, preferGbk = false): string {
  if (preferGbk) return gbk.decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return gbk.decode(bytes); }
}
/** 文件里的位置是 96 dpi 的逻辑像素（原版实测：150% 缩放下用真实鼠标在物理 300 像素处放点，文件里是 200；文本框命中范围 = 文件里的矩形 × 1.5）。新版的页面坐标也是逻辑像素（视图按屏幕缩放放大），所以读写不需要换算，只取整。 */
const fpx = (v: number) => Math.max(0, Math.round(v));
const upx = (v: number) => v;
const hex = (c: string) => c.length === 7 ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : [0, 0, 0];
const rgb = (r: number, g: number, b: number) => `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;

// ======================= 编码 =======================
class Out {
  chunks: Uint8Array[] = [];
  rec(tag: number, data: Uint8Array = new Uint8Array()) {
    const b = new Uint8Array(8 + data.length), v = new DataView(b.buffer);
    v.setUint32(0, data.length, true); v.setUint32(4, tag, true); b.set(data, 8); this.chunks.push(b);
  }
  bytes(): Uint8Array { const n = this.chunks.reduce((s, c) => s + c.length, 0), r = new Uint8Array(n); let o = 0; for (const c of this.chunks) { r.set(c, o); o += c.length; } return r; }
}
class Buf {
  v: DataView; b: Uint8Array; o = 0;
  constructor(n: number) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); }
  u16(x: number) { this.v.setUint16(this.o, x, true); this.o += 2; return this; }
  i16(x: number) { this.v.setInt16(this.o, x, true); this.o += 2; return this; }
  u32(x: number) { this.v.setUint32(this.o, x, true); this.o += 4; return this; }
  f64(x: number) { this.v.setFloat64(this.o, x, true); this.o += 8; return this; }
  skip(n: number) { this.o += n; return this; }
}

function compat(kind: 'file' | 'page' | 'tool'): Uint8Array {
  const prefix = new Uint8Array(16), view = new DataView(prefix.buffer);
  const versions = { file: [5, 5, 5, 3, 3, 4], page: [1, 4, 4, 1, 1, 2], tool: [2, 4, 4, 3, 3, 4] };
  versions[kind].forEach((v, i) => view.setUint16(i * 2, v, true));
  const msg = enc.encode('文档内容暂不兼容。');
  const part = (n: number) => { const b = new Uint8Array(2 + n + 1); new DataView(b.buffer).setUint16(0, n, true); b.fill(32, 2, 2 + n); b.set(msg, 2); return b; };
  const bits = kind === 'file' ? [prefix, part(121), part(121), part(87)] :
    kind === 'tool' ? [prefix, new Uint8Array(4), part(120), new Uint8Array([6]), part(93)] :
      [prefix, new Uint8Array(4), part(66), new Uint8Array(1), part(121)];
  const out = new Uint8Array(bits.reduce((s, b) => s + b.length, 0)); let i = 0; for (const b of bits) { out.set(b, i); i += b.length; } return out;
}

const PATH_TYPE = { seg: 14, ray: 13, line: 12, circle: 28 } as const;
const MEASURE: Record<string, [number, number, number]> = { // [方法, 大类, 类型]；引用 sys 的度量会再追加坐标系
  length: [36, 7, 48], distance: [37, 7, 48], arclength: [44, 7, 48], perimeter: [39, 7, 48], circumference: [40, 7, 48], radius: [46, 7, 48], angle: [41, 7, 49], arcangle: [43, 7, 49], area: [42, 7, 50], ratio: [47, 7, 51],
  abscissa: [65, 7, 51], ordinate: [66, 7, 51], coorddist: [86, 7, 51], slope: [87, 7, 51], pointvalue: [94, 7, 51],
  coordradius: [124, 7, 51], coordangle: [125, 7, 49],
};

interface SysRole { role: string; two: boolean; tri: boolean; unitX: Id }
interface Ctx { notes: Set<string>; fonts: string[]; images: Map<Obj, number>; results: Results; index: Map<Id, number>; page: Page; sysRole: Map<Id, SysRole>; measureCount: number; labelCounts: number[] }

function header(method: number, cat: number, kind: number, o: Obj, mode: 'point' | 'line' | 'region' | 'plain', extra?: { b2?: number }): Uint8Array {
  const b = new Buf(28);
  b.u16(method).u16(o.hidden ? 1 : 0).u16(o.trace ? 1 : 0).u16(cat).u16(kind);
  const [r, g, bl] = hex(o.style.color);
  const dashCode = o.style.dash === 'solid' ? 2 : o.style.dash === 'dash' ? 1 : 0;
  if (mode === 'point') { b.b[10] = 0x21; b.b[11] = o.style.pointSize; }
  else if (mode === 'line') { b.b[10] = (dashCode << 4) | o.style.width; b.b[11] = 1; }
  else { b.b[10] = 0x21; b.b[11] = 1; }
  if (extra?.b2 !== undefined) b.b[2] = extra.b2;
  b.b[12] = r; b.b[13] = g; b.b[14] = bl;
  b.b[16] = 0xff; b.b[17] = mode === 'region' ? Math.round((o.style.fillAlpha ?? 0.5) * 255) : 0xff;
  b.b[18] = 0x39; b.b[19] = 0x20; b.b[20] = 0xc1; b.b[21] = 0xbd; b.b[22] = 0xf0; b.b[23] = 0xff;
  return b.b;
}
function parentsRec(ids: number[]): Uint8Array { const b = new Buf(4 + ids.length * 4); b.u32(ids.length); ids.forEach(i => b.u32(i)); return b.b; }
function labelRec(text: string, visible: boolean, atPoint: boolean, custom = false): [Uint8Array, Uint8Array] {
  const t = enc.encode(text);
  const b = new Buf((25 + t.length + 1) & ~1); b.u16(6).u16(visible ? 1 : 0).u16(custom ? 1 : 0).i16(atPoint ? 8 : -5).i16(atPoint ? 5 : 5);
  b.o = 12; if (!atPoint) b.f64(0.25);
  b.o = 22; b.u16(t.length); b.b.set(t, 24);
  return [b.b, new Uint8Array(2)];
}
function textRec2307(at?: { x: number; y: number }): Uint8Array {
  const b = new Buf(32); b.u32(0x8fc).u32(22).u32(4).u16(at ? fpx(at.x) : 10).u16(at ? fpx(at.y) : 5).u16(3); b.b.set(enc.encode('<0>'), 18); b.o = 22; b.u16(0).u32(6).u32(2); return b.b;
}


// ---- 表达式/参数记录（2311）：令牌流。数字 0-9、小数点 0x0a、( 0x0b、) 0x0c、x 0x0f；+ - * / ^ 为 0x1000..0x1004；引用第 i 个父对象为 0x6000+i；度/厘米单位 0x0101/0x0201 ----
const OPS = { '+': 0x1000, '-': 0x1001, '*': 0x1002, '/': 0x1003, '^': 0x1004 } as const;
const OPS_BY_TOKEN = new Map<number, keyof typeof OPS>(Object.entries(OPS).map(([k, v]) => [v, k as keyof typeof OPS]));
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
/** 函数令牌 0x2000+n，后面是自变量，以 ) 结束（原版真实鼠标采集 + 画板截图核对数值得出）。 */
const FN_NAMES = ['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'abs', 'sqrt', 'ln', 'log', 'sgn', 'round', 'trunc'] as const;
const UNIT_TOKEN = { angle: 0x0101, distance: 0x0201 } as const;

function numTokens(v: number, unit?: 'angle' | 'distance' | 'none'): number[] {
  const t: number[] = [];
  if (v < 0) t.push(0x1001);
  const str = String(Number(Math.abs(v).toPrecision(12)));
  if (/e/i.test(str)) throw new Unsupported('科学计数法的数值');
  for (const ch of str) t.push(ch === '.' ? 0x0a : ch.charCodeAt(0) - 48);
  if (unit && unit !== 'none') t.push(UNIT_TOKEN[unit]);
  return t;
}

function exprTokens(e: Expr, refIndex: (id: Id) => number, out: number[] = [], parent = 0): number[] {
  switch (e.t) {
    case 'num': { const n = numTokens(e.v, e.u); if (e.v < 0 && parent > 0) out.push(0x0b, ...n, 0x0c); else out.push(...n); return out; }
    case 'x': out.push(0x0f); return out;
    case 'ref': out.push(0x6000 + refIndex(e.id)); return out;
    case 'neg': { const wrap = parent >= 4; if (wrap) out.push(0x0b); out.push(0x1001); exprTokens(e.a, refIndex, out, 3); if (wrap) out.push(0x0c); return out; }   // (−1)^x 的负号要加括号，否则读回来成了 −(1^x)
    case 'bin': {
      const p = PRECEDENCE[e.op], wrap = p < parent;
      if (wrap) out.push(0x0b);
      exprTokens(e.a, refIndex, out, p); out.push(OPS[e.op]); exprTokens(e.b, refIndex, out, p + (e.op === '^' ? 0 : 1));
      if (wrap) out.push(0x0c);
      return out;
    }
    case 'fn': { const i = (FN_NAMES as readonly string[]).indexOf(e.name); if (i < 0) throw new Unsupported(`函数 ${e.name}`); out.push(0x2000 + i); exprTokens(e.a, refIndex, out, 0); out.push(0x0c); return out; }
    case 'call': out.push(0x7000 + refIndex(e.func)); exprTokens(e.a, refIndex, out, 0); out.push(0x0c); return out;   // 自定义函数：0x7000+父对象序号，后接自变量和 )（原版采集：点画板上的函数）
  }
}

function tokensToExpr(tokens: number[], refId: (i: number) => Id): Expr {
  let i = 0;
  const peek = () => tokens[i];
  function number(): Expr {
    let s = '';
    while (i < tokens.length && (tokens[i] <= 9 || tokens[i] === 0x0a)) { s += tokens[i] === 0x0a ? '.' : String(tokens[i]); i++; }
    let u: 'angle' | 'distance' | undefined;
    if (peek() === 0x0100) { i++; return { t: 'num', v: Number(s) * 180 / Math.PI, u: 'angle' }; }
    if (peek() === 0x0101) { u = 'angle'; i++; } else if (peek() === 0x0201) { u = 'distance'; i++; }
    return { t: 'num', v: Number(s), u };
  }
  function atom(): Expr {
    const t = peek();
    if (t === undefined) throw new Unsupported('表达式不完整');
    if (t === 0x0b) { i++; const e = sum(); if (peek() !== 0x0c) throw new Unsupported('括号不配对'); i++; return e; }
    if (t === 0x0f) { i++; return { t: 'x' }; }
    if (t === 0x0d || t === 0x0e) { i++; return { t: 'num', v: t === 0x0d ? Math.PI : Math.E }; }
    if (t >= 0x2000 && t < 0x2000 + FN_NAMES.length) { i++; const a = sum(); if (peek() !== 0x0c) throw new Unsupported('函数括号不配对'); i++; return { t: 'fn', name: FN_NAMES[t - 0x2000], a }; }
    if (t >= 0x6000 && t < 0x7000) { i++; return { t: 'ref', id: refId(t - 0x6000) }; }
    if (t >= 0x7000 && t < 0x8000) { i++; const a = sum(); if (peek() !== 0x0c) throw new Unsupported('函数括号不配对'); i++; return { t: 'call', func: refId(t - 0x7000), a }; }
    if (t <= 9 || t === 0x0a) return number();
    throw new Unsupported(`表达式令牌 0x${t.toString(16)}`);
  }
  function primary(): Expr {
    const a = atom(), t = peek();
    if (t === 0x0100 || t === 0x0101 || t === 0x0201) {
      i++;
      return { t: 'bin', op: '*', a, b: { t: 'num', v: t === 0x0100 ? 180 / Math.PI : 1, u: t === 0x0201 ? 'distance' : 'angle' } };
    }
    return a;
  }
  function power(): Expr { const a = primary(); if (peek() === OPS['^']) { i++; return { t: 'bin', op: '^', a, b: unary() }; } return a; }
  function unary(): Expr { if (peek() === OPS['+']) { i++; return unary(); } /* 0x1005 是旧式负号：原版另存时写成 0x1001 */ if (peek() === OPS['-'] || peek() === 0x1005) { i++; return { t: 'neg', a: unary() }; } return power(); }
  function prod(): Expr { let a = unary(); while (peek() === OPS['*'] || peek() === OPS['/']) { const op = OPS_BY_TOKEN.get(tokens[i++])!; a = { t: 'bin', op: op as '*' | '/', a, b: unary() }; } return a; }
  function sum(): Expr { let a = prod(); while (peek() === OPS['+'] || peek() === OPS['-']) { const op = OPS_BY_TOKEN.get(tokens[i++])!; a = { t: 'bin', op: op as '+' | '-', a, b: prod() }; } return a; }
  const e = sum();
  if (i < tokens.length) throw new Unsupported('表达式有多余内容');
  return e;
}
// ---- 图片（1300 资源 + 类别 16 对象）：原版样本 i01–i03 及 205 个样例 ----
function b64ToBytes(b64: string): Uint8Array { const bin = atob(b64), r = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) r[i] = bin.charCodeAt(i); return r; }
function bytesToB64(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG 的像素宽高（IHDR）；不是 PNG 返回 undefined。 */
function pngSize(b: Uint8Array): { w: number; h: number } | undefined {
  if (b.length < 24 || PNG_MAGIC.some((m, i) => b[i] !== m)) return undefined;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return { w: v.getUint32(16), h: v.getUint32(20) };
}
/** 原版文件里 1300 记录补过偶数字节，PNG 末尾可能多一个字节：按 IEND 截断。 */
function trimPng(b: Uint8Array): Uint8Array {
  for (let i = b.length - 8; i >= 8; i--) if (b[i] === 0x49 && b[i + 1] === 0x45 && b[i + 2] === 0x4e && b[i + 3] === 0x44) return b.subarray(0, i + 8);
  return b;
}
function imageResource(d: { data: string; mime: string }): { bytes: Uint8Array; w: number; h: number } {
  if (d.mime !== 'image/png') throw new Unsupported(`图片格式 ${d.mime}（只有 PNG 能写成原版格式）`);
  const bytes = b64ToBytes(d.data), sz = pngSize(bytes);
  if (!sz || !sz.w || !sz.h) throw new Unsupported('图片数据不是有效的 PNG');
  return { bytes, w: sz.w, h: sz.h };
}
function rec1300(bytes: Uint8Array, w: number, h: number): Uint8Array {
  const n = (8 + bytes.length + 1) & ~1, b = new Uint8Array(n), v = new DataView(b.buffer); v.setUint32(0, w, true); v.setUint32(4, h, true); b.set(bytes, 8); return b;
}

// ---- 方程度量（2300 富文本）----
type Eq = { kind: 'line'; vertical: boolean; m: number; b: number; x: number } | { kind: 'circle'; cx: number; cy: number; r: number };
const runT = (t: string) => `<T${enc.encode(t).length.toString(16).toUpperCase()}x${t}>`;
const EMPTY_RUN = "<T''>";
const fix2 = (v: number) => Math.max(0, Math.abs(v) - 1e-9).toFixed(2);   // 恰在 .xx5 的值原版（样本 4.445 → 4.44）按舍去处理
const dashNum = (v: number) => (v < 0 ? '–' : '') + fix2(v);
const dashTerm = (v: number) => ` ${v < 0 ? '–' : '+'} ${fix2(v)}`;
/** 富文本 2300 记录：0x8fc 头（总长、4、x、y、文本长度）+ 标记文本。 */
function rich2300(text: string, at?: { x: number; y: number }): Uint8Array {
  const tb = enc.encode(text), field = (18 + tb.length + 1 + 1) & ~1, recLen = (18 + tb.length + 1 + 3) & ~3;
  const t = new Buf(recLen); t.u32(0x8fc).u32(field).u32(4).u16(at ? fpx(at.x) : 10).u16(at ? fpx(at.y) : 5).u16(tb.length); t.b.set(tb, 18); return t.b;
}
/** 方程度量的标记文本。原版样本：直线 3 种形式（斜截式、x = 常数、y = 常数），圆 5 种形式；当前适用的形式序号写在最外层 <?N，不适用的形式里数值位置是 <T''>。圆只有一般形式有样本，其余四种按样本的结构推出。 */
function equationMarkup(name: string, eq: Eq): string {
  const pre = eq.kind === 'line' ? `<?1<H<SO4<SS2${runT(name)}>>${runT(': ')}>>` : `<?1<H<H<!100><SS2${runT(name)}>>${runT(': ')}>>`;
  const X = '<SS2<T1xx>>', Y = '<SS2<T1xy>>';
  if (eq.kind === 'line') {
    const horizontal = !eq.vertical && Math.abs(eq.m) < 0.005;
    const f1 = eq.vertical || horizontal ? `${Y}${runT(' = ')}${EMPTY_RUN}${X}${EMPTY_RUN}` : `${Y}${runT(' = ')}${runT(dashNum(eq.m))}${X}${runT(dashTerm(eq.b))}`;
    const f2 = `${X}${runT(' = ')}${eq.vertical ? runT(dashNum(eq.x)) : EMPTY_RUN}`;
    const f3 = `${Y}${runT(' = ')}${horizontal ? runT(dashNum(eq.b)) : EMPTY_RUN}`;
    return `<?${eq.vertical ? 2 : horizontal ? 3 : 1}<H${pre}${f1}><H${pre}${f2}><H${pre}${f3}>>`;
  }
  const sq = (inner: string) => `<+${inner}<T1x2>>`;
  const par = (v: string, n: number) => `<H${runT('(')}${v}${runT(dashTerm(n))}${runT(')')}>`;
  const blankPar = (v: string) => `<H${runT('(')}${v}${EMPTY_RUN}${runT(')')}>`;
  const f1 = `${sq(par(X, -eq.cx))}${runT(' + ')}${sq(par(Y, -eq.cy))}${runT(' = ')}${sq(runT(fix2(eq.r)))}`;
  const f2 = `${sq(X)}${runT(' + ')}${sq(blankPar(Y))}${runT(' = ')}${sq(EMPTY_RUN)}`;
  const f3 = `${sq(blankPar(X))}${runT(' + ')}${sq(Y)}${runT(' = ')}${sq(EMPTY_RUN)}`;
  const f4 = `${sq(X)}${runT(' + ')}${sq(Y)}${runT(' = ')}${sq(EMPTY_RUN)}`;
  const frac = (a: string) => `</${sq(blankPar(a))}${sq(EMPTY_RUN)}>`;
  const f5 = `${frac(X)}${runT(' + ')}${frac(Y)}${runT(' = 1')}`;
  return `<?1<H${pre}${f1}><H${pre}${f2}><H${pre}${f3}><H${pre}${f4}><H${pre}${f5}>>`;
}


/** 构造 2311：22 字节文本头 + 令牌载荷。布局来自原版样本：参数与计算/函数在 +30 起的 40 字节里不同。 */
const FUNC_FORMS: FuncForm[] = ['y=f(x)', 'x=f(y)', 'r=f(t)', 't=f(r)'];
function record2311(kind: 'param' | 'calc' | 'func', tokens: number[], opts: { decimals?: number; unit?: 'none' | 'angle' | 'distance'; refs?: boolean; at?: { x: number; y: number }; form?: FuncForm } = {}): Uint8Array {
  const tokBytes = tokens.length * 2;
  const b = new Buf(22 + 30 + 40 + tokBytes);
  b.u32(0x8fc).u32(22).u32(4).i16(Math.round(opts.at?.x ?? 10)).i16(Math.round(opts.at?.y ?? 5)).u16(3); b.b.set(enc.encode('<0>'), 18);
  b.o = 22;
  b.u16(0);
  b.u16(6).u16(kind === 'param' ? 3 : 0).u16(kind === 'param' ? (opts.decimals ?? 0) : (opts.decimals ?? 2)).u16(0);
  b.u32(2311).u32(60 + tokBytes).u32(48).u16(tokens.length).u16(kind === 'func' ? Math.max(0, FUNC_FORMS.indexOf(opts.form ?? 'y=f(x)')) : 4).u32(0);
  if (kind === 'param') {
    const unit = opts.unit ?? 'none', dec = opts.decimals ?? 0;
    if (unit === 'angle') b.f64(Math.PI / 36).f64(0).f64(Math.PI * 2).f64(Math.PI / 4).f64(1);
    else if (unit === 'distance') b.f64(CM).f64(0).f64(3862.3).f64(CM).f64(1);
    else b.f64(Math.pow(10, -dec)).f64(-100).f64(100).f64(1).f64(1);
  } else if (opts.refs) {
    // 带引用的计算：原版样本里这一段为指针残值和 -2 哨兵，写入同样形状的数据
    b.u32(0).u32(0x0012fa56).u32(0).u32(0).u32(0).u32(0x0012fa56).u32(0xfffffffe).u32(0).u32(0xfffffffe).u32(0);
  } else { b.u32(8).skip(36); }
  for (const t of tokens) b.u16(t);
  return b.b;
}
function rect2211(at: { x: number; y: number }, w = 100, h = 25): Uint8Array { const b = new Buf(8); b.u16(fpx(at.x)).u16(fpx(at.y)).u16(fpx(at.x + w)).u16(fpx(at.y + h)); return b.b; }
const decimalsOf = (v: number) => { const s = String(Number(Math.abs(v).toPrecision(12))); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(9, s.length - i - 1); };

/** 变换（平移/旋转/缩放/反射）链上最初的那个原象的定义。 */
function underlyingDef(cx: Ctx, def: Def): Def {
  for (let i = 0; i < 50 && (def.k === 'translate' || def.k === 'rotate' || def.k === 'dilate' || def.k === 'reflect'); i++) {
    const src = cx.page.objects.find(x => x.id === (def as { src: Id }).src);
    if (!src) break;
    def = src.def;
  }
  return def;
}

/** 变换得到的对象在文件里的类别/类型/样式种类：与原象相同（样本：线段→线段 2/14，圆→圆 3/28，三角形内部→4/52 …）；认不出的原象拒绝写出。 */
function transformClass(cx: Ctx, srcId: Id): { cat: number; kind: number; mode: 'point' | 'line' | 'region' } {
  const src = cx.page.objects.find(x => x.id === srcId);
  const d = src ? underlyingDef(cx, src.def) : undefined;
  if (!d) throw new Unsupported('变换的原象不存在');
  if (isPointDef(d)) return { cat: 1, kind: 4, mode: 'point' };
  switch (d.k) {
    case 'seg': return { cat: 2, kind: 14, mode: 'line' };
    case 'ray': return { cat: 2, kind: 13, mode: 'line' };
    case 'line': return { cat: 2, kind: 12, mode: 'line' };
    case 'parallel': return { cat: 2, kind: 46, mode: 'line' };
    case 'perp': return { cat: 2, kind: 47, mode: 'line' };
    case 'circle': case 'circle-seg': return { cat: 3, kind: 28, mode: 'line' };
    case 'arc-circle': case 'arc3': return { cat: 12, kind: 67, mode: 'line' };
    case 'poly': return { cat: 4, kind: d.pts.length === 3 ? 52 : d.pts.length === 4 ? 53 : d.pts.length === 5 ? 54 : 55, mode: 'region' };
    case 'circle-int': return { cat: 5, kind: 16, mode: 'region' };
    default: throw new Unsupported(`${d.k} 的变换`);
  }
}

function need<T>(v: T | undefined, what: string): T { if (v === undefined) throw new Unsupported(what); return v; }

function encodeObject(out: Out, o: Obj, cx: Ctx) {
  const d = o.def;
  if (o.colorBy) throw new Unsupported('按参数着色');
  if (o.unselectable) throw new Unsupported('不可选中的对象');
  const ix = (id: Id) => need(cx.index.get(id), `对象引用 #${id}`);
  const sys = cx.sysRole.get(o.id), role = sys?.role;
  let hdr: Uint8Array; let parents: number[] | undefined; let rec3: Uint8Array | undefined; let tail: [number, Uint8Array][] = [];
  let label = true;
  switch (d.k) {
    case 'free':
      hdr = header(0, 1, role === 'origin' ? 41 : 4, o, 'point');
      { const p = new Buf(16); p.f64(d.x).f64(d.y); tail = [[2201, p.b]]; }
      break;
    case 'onpath': {
      const path = need(cx.page.objects.find(x => x.id === d.path), '路径点的路径');
      const pd = underlyingDef(cx, path.def);   // 变换得到的线/圆等，路径类型取决于最初的原象
      hdr = header(15, 1, 10, o, 'point'); parents = [ix(d.path)];
      let b: Buf;
      const axisRole = cx.sysRole.get(path.id)?.role;
      if (axisRole === 'axisX' || axisRole === 'axisY') {   // 坐标轴上的点：t 换算成以 200 像素为单位、0.5 在原点
        const shp = cx.results.get(path.id)?.shape;
        if (shp?.k !== 'line') throw new Unsupported('坐标轴上的点（坐标轴无定义）');
        const len = Math.hypot(shp.s.b.x - shp.s.a.x, shp.s.b.y - shp.s.a.y), px = d.abs ? d.t : d.t * len;
        b = new Buf(12); b.u16(15).u16(38).f64(0.5 + (px * (axisRole === 'axisY' ? -1 : 1)) / AXIS_PX);
      }
      else if (pd.k === 'seg' || pd.k === 'ray' || pd.k === 'line') { b = new Buf(12); b.u16(15).u16(PATH_TYPE[pd.k]).f64(d.t); }
      else if (pd.k === 'perp' || pd.k === 'parallel') { if (path.def.k !== pd.k) throw new Unsupported('变换得到的垂线/平行线上的点（参数单位未验证）'); b = new Buf(12); b.u16(15).u16(pd.k === 'perp' ? 47 : 46).f64(d.t + 0.5); }   // 垂线/平行线：文件里 t=0.5 在所过的点，单位是参照线两个定义点的向量（原版采集 pl2/pl3）
      else if (pd.k === 'circle' || pd.k === 'circle-seg') { b = new Buf(20); b.u16(15).u16(28).f64(Math.cos(d.t)).f64(Math.sin(d.t)); }
      else if (pd.k === 'arc-circle' || pd.k === 'arc3' || pd.k === 'arc-center') { b = new Buf(12); b.u16(15).u16(67).f64(d.t); }
      else if (pd.k === 'locus' || pd.k === 'plot') { b = new Buf(12); b.u16(15).u16(pd.k === 'locus' ? 42 : 58).f64(d.t); }
      else if (pd.k === 'circle-int') { b = new Buf(20); b.u16(15).u16(16).f64(Math.cos(d.t)).f64(-Math.sin(d.t)); }
      else if (pd.k === 'poly') {
        // 多边形上的点：边序号 + 该边上的比例（样本：t=0.2569、序号 1，点落在第二条边的 25% 处）
        const pts = (cx.results.get(path.id)?.shape as { pts?: { x: number; y: number }[] } | undefined)?.pts;
        if (!pts) throw new Unsupported('多边形上的点（多边形无定义）');
        const total = pts.reduce((sum, q, i) => sum + Math.hypot(pts[(i + 1) % pts.length].x - q.x, pts[(i + 1) % pts.length].y - q.y), 0);
        let want = (((d.t % 1) + 1) % 1) * total, side = 0, u = 0;
        for (let i = 0; i < pts.length; i++) { const l = Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].y - pts[i].y); if (want <= l || i === pts.length - 1) { side = i; u = l > 0 ? Math.min(1, want / l) : 0; break; } want -= l; }
        b = new Buf(20); b.u16(15).u16(pd.pts.length === 3 ? 52 : pd.pts.length === 4 ? 53 : pd.pts.length === 5 ? 54 : 55).f64(u).u32(side);
      } else throw new Unsupported(`依附于${pd.k}的点`);
      rec3 = b.b; break;
    }
    case 'mid': hdr = header(1, 1, 11, o, 'point'); parents = [ix(d.seg)]; break;
    case 'inter': {
      const A = cx.page.objects.find(x => x.id === d.a)!, B = cx.page.objects.find(x => x.id === d.b)!;
      const pathKind = (x: Obj) => underlyingDef(cx, x.def).k;
      const isC = (x: Obj) => ['circle', 'circle-seg', 'arc-circle', 'arc3', 'arc-center'].includes(pathKind(x));
      const nC = Number(isC(A)) + Number(isC(B));
      const isStraight = (x: Obj) => ['seg', 'ray', 'line', 'parallel', 'perp', 'bisect'].includes(pathKind(x)), isPaths = (x: Obj) => ['locus', 'plot'].includes(pathKind(x));
      if ((isStraight(A) && isPaths(B)) || (isStraight(B) && isPaths(A))) {   // 直线型与轨迹/函数图像的交点：方法 98，父对象 [直线型, 曲线]，2003 = [u16 98][u16 0][u32 序号]
        hdr = header(98, 1, 45, o, 'point'); parents = isPaths(A) ? [ix(d.b), ix(d.a)] : [ix(d.a), ix(d.b)];
        const b = new Buf(8); b.u16(98).u16(0).u32(d.branch); rec3 = b.b; break;
      }
      if ([A, B].some(x => !isStraight(x) && !isC(x)) || d.branch < 0 || d.branch > (nC ? 1 : 0)) throw new Unsupported('弧或其它路径的交点');
      const method = nC === 0 ? 9 : nC === 1 ? 11 + d.branch : 13 + d.branch;
      hdr = header(method, 1, 45, o, 'point');
      parents = nC === 1 && isC(A) ? [ix(d.b), ix(d.a)] : [ix(d.a), ix(d.b)]; break;
    }
    case 'translate': {
      const by = d.by;
      if (role === 'unitX' || role === 'unitY') {
        const unitX = role === 'unitX';
        hdr = header(unitX ? 52 : sys?.two ? 55 : 54, 1, 40, o, 'point', sys?.two && !unitX ? undefined : { b2: role === 'unitY' ? 4 : 0 });   // 矩形/三角网格：纵轴单位点是独立的（方法 55，可见，原版采集 probe_grid2）
        parents = [role === 'unitX' ? ix(d.src) : ix(sys!.unitX)];
        const b = new Buf(12); b.u16(unitX ? 52 : sys?.two ? 55 : 54).u16(0).f64((unitX ? by.mode === 'rect' ? by.dx : 1 : by.mode === 'rect' ? by.dy : 1) * CM); rec3 = b.b; break;
      }
      if (by.mode === 'vector') { hdr = header(16, 1, 4, o, 'point'); parents = [ix(d.src), ix(by.from), ix(by.to)]; }
      else if (by.mode === 'rect') {
        if (by.dxBy !== undefined || by.dyBy !== undefined) throw new Unsupported('直角坐标平移取自标记距离');
        hdr = header(17, 1, 4, o, 'point'); parents = [ix(d.src)];
        const b = new Buf(52); b.u16(17).u16(0).f64(by.dx * CM).f64(by.dx).u32(1).f64(by.dy * CM).f64(by.dy).u32(1); rec3 = b.b;
      } else {
        const dm = 'm' in by.dist, am = 'pts' in by.angle;
        if (('m' in by.angle) || (!dm && !('fixed' in by.dist))) throw new Unsupported('以度量值给出角度的平移');
        if (!dm && !am) {
          const th = (((by.angle as { fixed: number }).fixed) * Math.PI) / 180;
          hdr = header(21, 1, 4, o, 'point'); parents = [ix(d.src)];
          const b = new Buf(60); b.u16(21).u16(0).f64(-Math.sin(th)).f64(Math.cos(th)).f64((by.angle as { fixed: number }).fixed).u32(1).f64((by.dist as { fixed: number }).fixed * CM).f64((by.dist as { fixed: number }).fixed).u32(1); rec3 = b.b;
        } else if (dm && !am) {          // 标记距离 + 固定角度：方法 24
          const deg = (by.angle as { fixed: number }).fixed, th = (deg * Math.PI) / 180;
          hdr = header(24, 1, 4, o, 'point'); parents = [ix(d.src), ix((by.dist as { m: Id }).m)];
          const b = new Buf(36); b.u16(24).u16(0).f64(-Math.sin(th)).f64(Math.cos(th)).f64(deg).u32(1).u32(0); rec3 = b.b;
        } else if (!dm && am) {          // 固定距离 + 标记角度：方法 22
          const cmv = (by.dist as { fixed: number }).fixed;
          hdr = header(22, 1, 4, o, 'point'); parents = [ix(d.src), ...(by.angle as { pts: [Id, Id, Id] }).pts.map(ix)];
          const b = new Buf(28); b.u16(22).u16(0).f64(cmv * CM).f64(cmv).u32(1).u32(0); rec3 = b.b;
        } else {                         // 都标记：方法 25
          hdr = header(25, 1, 4, o, 'point'); parents = [ix(d.src), ...(by.angle as { pts: [Id, Id, Id] }).pts.map(ix), ix((by.dist as { m: Id }).m)];
        }
      }
      break;
    }
    case 'rotate': {
      if (d.angle.mode === 'fixed') {
        const th = (d.angle.deg * Math.PI) / 180;
        hdr = header(27, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center)];
        const b = new Buf(36); b.u16(27).u16(0).f64(-Math.sin(th)).f64(Math.cos(th)).f64(d.angle.deg).u32(1).u32(0); rec3 = b.b;
      } else if (d.angle.mode === 'marked') { hdr = header(28, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center), ix(d.angle.a), ix(d.angle.v), ix(d.angle.b)]; }
      else { hdr = header(29, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center), ix(d.angle.m)]; }   // 角度取自参数/度量值（原版采集 s01/s02）
      break;
    }
    case 'dilate': {
      if (d.ratio.mode === 'fixed') { hdr = header(30, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center)]; const b = new Buf(12); b.u16(30).u16(0).f64(d.ratio.num / d.ratio.den); rec3 = b.b; }
      else if (d.ratio.mode === 'marked' && d.ratio.c !== undefined) { hdr = header(32, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center), ix(d.ratio.a), ix(d.ratio.b), ix(d.ratio.c)]; }   // 三点标记比（原版采集 r3）
      else if (d.ratio.mode === 'marked') { hdr = header(31, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center), ix(d.ratio.a), ix(d.ratio.b)]; }
      else { hdr = header(33, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.center), ix(d.ratio.m)]; }
      break;
    }
    case 'plotxy': hdr = header(d.polar ? 70 : 69, 1, 56, o, 'point'); parents = [ix(d.x), ix(d.y), ix(d.sys)]; break;
    case 'pointval':   // 在路径上绘制点（值）：取自数值对象时方法 95，父对象 [数值, 路径]（样例）；固定值时方法 123，父对象 [路径]，2003 = [u16 123][u16 0][f64 值]（原版采集 pv01）
      if (d.value !== undefined) { hdr = header(95, 1, 56, o, 'point'); parents = [ix(d.value), ix(d.path)]; }
      else { hdr = header(123, 1, 56, o, 'point'); parents = [ix(d.path)]; const b = new Buf(12); b.u16(123).u16(0).f64(d.fixed ?? 0); rec3 = b.b; }
      break;
    case 'axispt': { hdr = header(d.axis === 'x' ? 109 : 110, 1, 56, o, 'point'); parents = [ix(d.value), ix(d.sys)]; const b = new Buf(12); b.u16(d.axis === 'x' ? 109 : 110).u16(0).f64(0); rec3 = b.b; break; }   // 在轴上按数值画点：父对象 [数值, 坐标系]（样例）
    case 'plotfix': { hdr = header(67, 1, 56, o, 'point'); parents = [ix(d.sys)]; const b = new Buf(20); b.u16(67).u16(0).f64(d.x).f64(d.y); rec3 = b.b; break; }   // 固定坐标的点（原版采集 px01）
    case 'reflect': hdr = header(34, 1, 4, o, 'point'); parents = [ix(d.src), ix(d.mirror)]; break;
    case 'seg': case 'ray': case 'line': {
      if (role === 'axisX' || role === 'axisY') {
        hdr = header(58, 9, 38, o, 'plain'); parents = [ix(d.a), ix(d.b)];
        const t = new Buf(4); t.u32(role === 'axisX' ? (sys?.tri ? 0x10001 : 1) : 0);   // 三角坐标轴：x 轴记录第二个 u16 为 1
        tail = [[2309, t.b]];
        if (o.label !== undefined) { const [l5, l8] = labelRec(o.label, o.labelShown, true, !!o.toolLabel); tail.push([2005, l5], [2008, l8]); }
        label = false; break;
      }
      const m = d.k === 'seg' ? [2, 14] : d.k === 'ray' ? [64, 13] : [63, 12];
      hdr = header(m[0], 2, m[1], o, 'line'); parents = [ix(d.a), ix(d.b)]; break;
    }
    case 'axis-unit': {
      if (d.direction !== 'y' || d.origin !== undefined) throw new Unsupported('轴单位点的方向或原点');
      const method = d.distance === undefined ? 54 : 55;
      hdr = header(method, 1, 40, o, 'point', method === 54 ? { b2: 4 } : undefined);
      parents = [ix(d.axis)];
      rec3 = new Buf(12).u16(method).u16(0).f64(d.distance ?? CM).b;
      break;
    }
    case 'axis-line': {
      if (d.mode === 'distance' && d.origin === undefined) throw new Unsupported('距离轴缺少原点');
      if (d.mode === 'circle' && d.origin !== undefined) throw new Unsupported('圆轴带有额外原点');
      hdr = header(d.mode === 'distance' ? 59 : 60, 9, 38, o, 'plain');
      parents = d.mode === 'distance' ? [ix(d.origin!), ix(d.unit)] : [ix(d.unit)];
      tail = [[2309, new Buf(4).u32(d.axis === 'x' ? 1 : 0).b]];
      if (o.label !== undefined) { const [l5, l8] = labelRec(o.label, o.labelShown, true, !!o.toolLabel); tail.push([2005, l5], [2008, l8]); }
      label = false; break;
    }
    case 'parallel': hdr = header(6, 2, 46, o, 'line'); parents = [ix(d.pt), ix(d.line)]; break;
    case 'perp': hdr = header(5, 2, 47, o, 'line'); parents = [ix(d.pt), ix(d.line)]; break;
    case 'bisect': hdr = header(7, 2, 44, o, 'line'); parents = [ix(d.a), ix(d.v), ix(d.b)]; break;
    case 'circle': hdr = header(3, 3, 28, o, 'line'); parents = [ix(d.c), ix(d.p)]; break;
    case 'circle-seg': hdr = header(4, 3, 28, o, 'line'); parents = [ix(d.c), ix(d.seg)]; break;
    case 'arc-circle': hdr = header(79, 12, 67, o, 'line'); parents = [ix(d.circle), ix(d.a), ix(d.b)]; break;
    case 'arc3': hdr = header(81, 12, 67, o, 'line'); parents = [ix(d.a), ix(d.b), ix(d.c)]; break;
    case 'arc-center': hdr = header(80, 12, 67, o, 'line'); parents = [ix(d.c), ix(d.a), ix(d.b)]; break;
    case 'poly': hdr = header(8, 4, d.pts.length === 3 ? 52 : d.pts.length === 4 ? 53 : d.pts.length === 5 ? 54 : 55, o, 'region'); parents = d.pts.map(ix); break;
    case 'circle-int': hdr = header(10, 5, 16, o, 'region'); parents = [ix(d.circle)]; break;
    case 'arc-int': hdr = header(d.mode === 'sector' ? 82 : 83, 13, d.mode === 'sector' ? 68 : 69, o, 'region'); parents = [ix(d.arc)]; break;
    case 'colorize': {
      const cls = transformClass(cx, d.src);
      hdr = header(75, cls.cat, cls.kind, o, cls.mode); parents = [ix(d.src), ...d.params.map(ix)];
      const b = new Buf(24); b.u16(75).u16(0).u32(({ color: 0x10, gray: 0x20, rgb: 0x30, hsv: 0x40 }[d.mode]) | ['none', 'one', 'two'].indexOf(d.cycle)).f64(d.from).f64(d.to); rec3 = b.b; break;
    }
    case 'measure': {
      if (d.m === 'coords') {
        const pt = cx.page.objects.find(x => x.id === d.refs[0]), sh = cx.results.get(o.id)?.shape as { x?: number; y?: number } | undefined;
        if (!pt || sh?.x === undefined || sh?.y === undefined) throw new Unsupported('坐标度量（无数值）');
        const run = (t: string) => `<T${enc.encode(t).length.toString(16).toUpperCase()}x${t}>`;
        const text = `<?1<H<?1<H<SS2${run(pt.label ?? 'A')}>${run(': ')}>>${run('(')}${run(sh.x.toFixed(2))}${run(', ')}${run(sh.y.toFixed(2))}${run(')')}>>`;
        const tb = enc.encode(text), field = (18 + tb.length + 1 + 1) & ~1, recLen = (18 + tb.length + 1 + 3) & ~3;
        const t = new Buf(recLen); t.u32(0x8fc).u32(field).u32(4).u16(o.at ? fpx(o.at.x) : 10).u16(o.at ? fpx(o.at.y) : 5).u16(tb.length); t.b.set(tb, 18);
        hdr = header(49, 0, 34, o, 'plain'); parents = d.refs.map(ix);
        tail = [[2300, t.b], [2008, new Buf(2).u16(++cx.measureCount).b]]; label = false; break;
      }
      if (d.m === 'equation') {
        const sp = cx.page.objects.find(x => x.id === d.refs[0]), eq = (cx.results.get(o.id)?.shape as { eq?: Eq } | undefined)?.eq;
        if (!sp || !eq) throw new Unsupported('方程度量（无数值）');
        const nm = measureTitle(cx.page, cx.results, o);
        hdr = header(eq.kind === 'line' ? 50 : 51, 0, eq.kind === 'line' ? 36 : 37, o, 'plain'); parents = d.refs.map(ix);
        tail = [[2300, rich2300(equationMarkup(nm, eq), o.at)], [2008, new Buf(2).u16(++cx.measureCount).b]]; label = false; break;
      }
      const m = MEASURE[d.m];
      if (!m) throw new Unsupported(`度量“${d.m}”`);
      hdr = header(d.m === 'distance' && cx.results.get(d.refs[1])?.shape?.k === 'line' ? 38 : m[0], m[1], m[2], o, 'plain'); parents = d.refs.map(ix); tail = [[2307, textRec2307(o.at)], [2008, new Buf(2).u16(++cx.measureCount).b]]; label = false; break;
    }
    case 'param': {
      const kind = d.unit === 'angle' ? 81 : d.unit === 'distance' ? 80 : 79;
      hdr = header(0, 11, kind, o, 'plain');
      const [l5, l8] = labelRec(d.name, false, true); const lb = new Uint8Array(l5); new DataView(lb.buffer).setUint16(0, 7, true);
      tail = [[2311, record2311('param', numTokens(d.value, d.unit), { decimals: o.decimals ?? decimalsOf(d.value), unit: d.unit })], [2005, lb], [2008, l8], [2211, rect2211(o.at ?? { x: 10, y: 5 }, 54, 31)]];
      label = false; break;
    }
    case 'calc': case 'func': {
      if (d.k === 'func' && d.derivativeOf !== undefined) throw new Unsupported('保留来源关系的导函数');
      if (d.k === 'func' && d.symbol) throw new Unsupported('用“y=”记号显示的函数');
      const refs = parentsOf(d), isFn = d.k === 'func';
      const u = (cx.results.get(o.id)?.shape as { q?: { u?: string } } | undefined)?.q?.u;
      const calcKind = u === 'distance' ? 48 : u === 'angle' ? 49 : 51;     // 计算结果的单位决定类型号
      hdr = header(refs.length ? 48 : 0, 11, isFn ? 57 : calcKind, o, 'plain'); parents = refs.length ? refs.map(ix) : undefined;
      const toks = exprTokens(d.expr, id => need(refs.indexOf(id) < 0 ? undefined : refs.indexOf(id), '表达式引用'));
      tail = [[2311, record2311(isFn ? 'func' : 'calc', toks, { refs: refs.length > 0, decimals: isFn ? undefined : o.decimals, at: o.at, form: d.k === 'func' ? d.form : undefined })]];
      if (!isFn) tail.push([2008, new Buf(2).u16(cx.measureCount++).b]);
      if (isFn) { const [l5, l8] = labelRec(d.name, false, true); const lb = new Uint8Array(l5); new DataView(lb.buffer).setUint16(0, 6, true); tail.push([2005, lb], [2008, l8]); }
      if (refs.length === 0) tail.push([2211, rect2211(o.at ?? { x: 10, y: 5 })]);   // 带引用的计算不写位置记录（原版会因此拒绝文件）
      label = false; break;
    }
    case 'button': {
      const a = d.action;
      let A = 0, B = 0, tparents: Id[] = [], rec3b: Uint8Array | undefined, aux = 0;
      if (a.type === 'hideshow') {
        // 第一个数 A 是（将要执行的）动作：0 隐藏、1 显示；第二个数 B 是位标志：1 显示后选定、2 淡入淡出、4 切换（原版采集 hb01，12 种组合）
        const first = a.mode === 'toggle' ? (a.first ?? 'hide') : a.mode;
        A = first === 'hide' ? 0 : 1; B = (a.select === false ? 0 : 1) | (a.fade === false ? 0 : 2) | (a.mode === 'toggle' ? 4 : 0); tparents = a.targets;
      }
      else if (a.type === 'animate') {
        // 2003（36 字节）：偏移 6 的高半字节是方向（0 向前 1 向后 2 双向 3 随机），偏移 8 的 f32 是速度（慢 4、中 24、快 80）。真实鼠标采集
        // 偏移 6 的 u16：位 12–13 是方向，0x8000 位是“只播放一次”（原版采集 v-anim、on01）
        const dir = { forward: 0, backward: 1, bounce: 2, random: 3 }[a.direction], sp = typeof a.speed === 'number' ? a.speed : { slow: 4, medium: 24, fast: 80 }[a.speed];
        A = 2; tparents = a.targets;
        const ab = new Buf(36); ab.u16(62).u16(0).u16(0).u16((dir << 12) | (a.once ? 0x8000 : 0)); ab.v.setFloat32(8, sp, true); ab.v.setFloat32(20, 25600, true);
        rec3b = ab.b;
      }
      else if (a.type === 'move') { A = 3; B = { slow: 0, medium: 1, fast: 2, high: 3 }[a.speed]; tparents = [a.from, a.to, ...(a.pairs ?? []).flat()]; aux = a.toInitial ? 1 : 0; }
      else if (a.type === 'series') {
        // A=7，B 位标志：1 依序、2 取消选定、4 停止动画、8 清除追踪、16 首动作停止、32 持续时间；+16 的 u32：依序时是动作间暂停、持续时间时是时长（0.1 秒），其余为 600；父对象是被执行的按钮（原版采集 se01）
        A = 7; B = (a.mode === 'seq' ? 1 : 0) | (a.deselect ? 2 : 0) | (a.stopAnim ? 4 : 0) | (a.clearTraces ? 8 : 0) | (a.after === 'first' ? 16 : a.after === 'duration' ? 32 : 0); tparents = a.buttons;
        aux = a.mode === 'seq' ? Math.round((a.seconds ?? 0) * 10) : a.after === 'duration' ? Math.round((a.seconds ?? 0) * 10) : 600;
      }
      else if (a.type === 'link' && a.url) {
        const ub = enc.encode(a.url), total = (26 + ub.length + 1 + 3) & ~3;
        const lb = new Buf(total); lb.u32(2310).u32(total).u32(12).u16(6).u16(0).u32(0).u16(fpx(o.at?.x ?? d.at.x)).u16(fpx(o.at?.y ?? d.at.y)).u16(ub.length); lb.b.set(ub, 26);
        hdr = header(0, 10, 23, o, 'plain'); hdr[12] = 0xff; hdr[13] = 0x80; hdr[14] = 0x00; parents = undefined;
        const [l5] = labelRec(d.text, false, true); const lab = new Uint8Array(l5); new DataView(lab.buffer).setUint16(0, 6, true);
        const rc = new Buf(8); rc.u16(fpx(d.at.x)).u16(fpx(d.at.y)).u16(fpx(d.at.x + d.w)).u16(fpx(d.at.y + d.h));
        tail = [[2310, lb.b], [2005, lab], [2008, new Buf(2).u16(1).b], [2210, rc.b]]; label = false; break;
      }
      else if (a.type === 'link' && !a.url && a.page >= 1) {
        // 链接到页面：方法 0、无父对象；A=5，+16 的 u32 是页序号（从 0 开始）（原版采集 lb01）
        const lb = new Buf(24); lb.u32(2310).u32(24).u32(12).u16(5).u16(0).u32(a.page - 1).u16(fpx(o.at?.x ?? d.at.x)).u16(fpx(o.at?.y ?? d.at.y));
        hdr = header(0, 10, 23, o, 'plain'); hdr[12] = 0xff; hdr[13] = 0x80; hdr[14] = 0x00; parents = undefined;
        const [l5] = labelRec(d.text, false, true); const lab = new Uint8Array(l5); new DataView(lab.buffer).setUint16(0, 6, true);
        const rc = new Buf(8); rc.u16(fpx(d.at.x)).u16(fpx(d.at.y)).u16(fpx(d.at.x + d.w)).u16(fpx(d.at.y + d.h));
        tail = [[2310, lb.b], [2005, lab], [2008, new Buf(2).u16(1).b], [2210, rc.b]]; label = false; break;
      }
      else if (a.type === 'sound') { A = 8; tparents = a.funcs; }
      else if (a.type === 'scroll') { A = 4; B = a.where === 'center' ? 1 : 0; tparents = [a.point]; }
      else throw new Unsupported(`${a.type} 按钮`);
      hdr = header(62, 10, 23, o, 'plain'); hdr[12] = 0xff; hdr[13] = 0x80; hdr[14] = 0x00;
      parents = tparents.map(ix); rec3 = rec3b;
      const b = new Buf(24); b.u32(2310).u32(24).u32(12).u16(A).u16(B).u32(aux).u16(fpx(o.at?.x ?? d.at.x)).u16(fpx(o.at?.y ?? d.at.y));
      const [l5] = labelRec(d.text, false, true); const lb = new Uint8Array(l5); new DataView(lb.buffer).setUint16(0, 4, true);
      tail = [[2310, b.b], [2005, lb], [2008, new Buf(2).u16(1).b]]; label = false; break;
    }
    case 'text': {
      if (d.runs?.length) throw new Unsupported('带分段样式的文本');
      if (/[<>]/.test(d.text)) throw new Unsupported('含 < > 的文本');
      if (d.anchor !== undefined && !d.off) throw new Unsupported('附着在点上的文本（没有偏移）');
      if (d.anchor !== undefined || d.refs?.length) {   // 方法 90 的首个父对象为锚点；方法 73 的父对象全为插入对象。
        const box = cx.results.get(o.id)?.shape as { at?: { x: number; y: number } } | undefined;
        const at = d.anchor === undefined ? d.at : box?.at;
        if (!at) throw new Unsupported('附着在点上的文本（无位置）');
        const f = d.font, X = (v: number) => v.toString(16).toUpperCase(), fi = cx.fonts.indexOf(f.name), [cr, cg, cb] = hex(f.color);
        const attrs = `#${X(Math.max(1, Math.round((f.size * 72) / 96)))}P${fi > 0 ? X(fi) : ''}${f.bold ? 'W2' : ''}${f.italic ? 'S2' : ''}${f.underline ? 'U2' : ''}${cr + cg + cb > 0 ? `R${X(cr + 1)}G${X(cg + 1)}L${X(cb + 1)}` : ''}`;
        const lead = d.anchor === undefined ? 1 : 2;
        const runs = d.text.split('\n').map(line => `<H${line.split(/(\d+)/).map((seg, i) => (i % 2 ? `<?x${Number(seg) + lead}>` : seg ? `<T${enc.encode(seg).length.toString(16).toUpperCase()}x${seg}>` : '')).join('')}>`).join('');
        const markup = `<S${attrs}<VL${runs}>>`, mb = enc.encode(markup);
        hdr = header(d.anchor === undefined ? 73 : 90, 0, 59, o, 'plain'); parents = [...(d.anchor === undefined ? [] : [ix(d.anchor)]), ...(d.refs ?? []).map(ix)];
        const field = (18 + mb.length + 1 + 1) & ~1, recLen = (18 + mb.length + 1 + 3) & ~3;
        const t = new Buf(recLen); t.u32(0x8fc).u32(field).u32(4).u16(fpx(at.x)).u16(fpx(at.y)).u16(mb.length); t.b.set(mb, 18);
        tail = [[2300, t.b], [2008, new Uint8Array(2)]]; label = false; break;
      }
      hdr = header(0, 0, 19, o, 'plain');
      // <T 后面的十六进制数是该段文字的 UTF-8 字节数（abc→3，“你好 123”→A，line1→5），不是字体号
      // 整个文本的样式写在最外层 <S…<VL…>>：#十六进制字号（磅）、P 字体序号、W2 粗体、S2 斜体、U2 下划线、R/G/L 颜色（各通道值+1 的十六进制）（原版采集 ts01、tc01）
      const f = d.font, X = (v: number) => v.toString(16).toUpperCase(), fi = cx.fonts.indexOf(f.name), [cr, cg, cb] = hex(f.color);
      const attrs = `#${X(Math.max(1, Math.round((f.size * 72) / 96)))}P${fi > 0 ? X(fi) : ''}${f.bold ? 'W2' : ''}${f.italic ? 'S2' : ''}${f.underline ? 'U2' : ''}${cr + cg + cb > 0 ? `R${X(cr + 1)}G${X(cg + 1)}L${X(cb + 1)}` : ''}`;
      const markup = `<S${attrs}<VL${d.text.split(String.fromCharCode(10)).map(l => `<T${enc.encode(l).length.toString(16).toUpperCase()}x${l}>`).join('')}>>`, mb = enc.encode(markup);
      const field = (18 + mb.length + 1 + 1) & ~1, recLen = (18 + mb.length + 1 + 3) & ~3;
      const t = new Buf(recLen); t.u32(0x8fc).u32(field).u32(4).u16(fpx(d.at.x)).u16(fpx(d.at.y)).u16(mb.length); t.b.set(mb, 18);
      const r = new Buf(8); r.u16(fpx(d.at.x)).u16(fpx(d.at.y)).u16(fpx(d.at.x + d.w)).u16(fpx(d.at.y + d.h));
      tail = [[2300, t.b], [2008, new Uint8Array(2)], [2200, r.b]]; label = false; break;
    }
    case 'image': {
      if (d.clip !== undefined) throw new Unsupported('剪裁到多边形的图片');
      const { w, h } = imageResource(d);
      const ri = need(cx.images.get(o), '图片资源');
      hdr = header(0, 16, 78, o, 'plain'); new DataView(hdr.buffer).setUint32(20, ri, true);   // 资源序号同时写在对象头 +20 和 8004 记录里（多图样本）
      const [aa, ab, tx, ac, ad, ty] = d.affine ?? [d.w, 0, d.at.x, 0, d.h, d.at.y];
      const a = new Buf(48); a.f64(aa / w).f64(ab / h).f64(tx).f64(ac / w).f64(ad / h).f64(ty);
      const sz = new Buf(16); sz.u32(w).u32(h).u32(w).u32(h);
      tail = [[2316, sz.b], [2216, a.b], [8004, new Buf(2).u16(ri).b]]; label = false; break;
    }
    case 'table': {
      if (d.cols.length < 1) throw new Unsupported('空表格');
      const cols = d.cols.map(id => cx.page.objects.find(x => x.id === id));
      for (const col of cols) {
        const unit = col && (cx.results.get(col.id)?.shape as { q?: { u?: string } } | undefined)?.q?.u;
        if (!col || col.def.k !== 'measure' || unit !== 'distance') throw new Unsupported('表格的列不是距离度量');
      }
      const run = (t: string) => `<T${enc.encode(t).length.toString(16).toUpperCase()}x${t}>`;
      // 原版样本：(列数+2) 个 '0'，各列表头，然后每行 '0' + 各列的值；一列、两列样本均如此
      const heads = cols.map(col => `<H<SS2${run(' ')}><SO2<SS2${run(measureTitle(cx.page, cx.results, col!))}>>>`).join('');
      const text = '0'.repeat(cols.length + 2) + heads + d.rows.map(r => '0' + cols.map((_, ci) => `<H<H${run(r[ci].toFixed(2))}>${run('厘米')}>`).join('')).join('');
      const tb = enc.encode(text), total = (28 + tb.length + 3) & ~3;
      const t = new Buf(total); t.u32(0x90d).u32(total).u32(0x10).u16(fpx(o.at?.x ?? 10)).u16(fpx(o.at?.y ?? 34)).u16(d.rows.length + 2).u16(cols.length + 1).u16(1); t.b.set(tb, 28);
      hdr = header(91, 17, 83, o, 'plain'); parents = d.cols.map(ix);
      tail = [[2317, t.b], [2008, new Buf(2).u16(++cx.measureCount).b]]; label = false; break;
    }
    case 'locus': {
      // 轨迹（真实鼠标采集）：父对象 = [被驱动点, 路径, 驱动点, …驱动点到被驱动点之间依赖链上的对象（含被驱动点）]
      const drv = cx.page.objects.find(x => x.id === d.driver);
      if (d.path !== undefined || !drv || drv.def.k !== 'onpath') throw new Unsupported('沿独立路径采样的轨迹');
      if (!isPointDef(underlyingDef(cx, cx.page.objects.find(x => x.id === d.out)!.def))) throw new Unsupported('非点对象的轨迹');
      const ids = new Set<Id>([d.driver]), order = cx.page.objects.map(x => x.id);
      const chain = order.filter(id => { if (id === d.driver) return false; const ob = cx.page.objects.find(x => x.id === id)!; return parentsOf(ob.def).some(pp => ids.has(pp)) && (ids.add(id), true); });
      const need = new Set<Id>([d.out]); for (let i = chain.length - 1; i >= 0; i--) { if (need.has(chain[i])) for (const pp of parentsOf(cx.page.objects.find(x => x.id === chain[i])!.def)) need.add(pp); }
      const used = chain.filter(id => need.has(id));
      if (!used.includes(d.out)) throw new Unsupported('轨迹的被驱动点不依赖驱动点');
      const pathShape = cx.results.get(drv.def.path)?.shape;
      const range: [number, number] = pathShape?.k === 'circle' ? [0, Math.PI * 2] : [0, 1];
      hdr = header(35, 6, 42, o, 'line');
      parents = [ix(d.out), ix(drv.def.path), ix(d.driver), ...used.map(ix)];
      const b = new Buf(40); b.f64(range[0]).f64(range[1]).u32(Math.max(2, Math.round(d.samples))).u32(used.length).u32(0).u32(0).u32(1).u32(0);
      rec3 = undefined; tail = [[2306, b.b]]; label = false; break;
    }
    case 'picfunc': throw new Unsupported('绘图函数（手绘笔迹在原版里是位图，新版的笔迹是折线）');
    case 'itertable': {   // 迭代数据表（原版采集 probe_itertable）：方法 92，大类 17，类型 84，父对象 [迭代, 数值初象…]，2317 只记位置（表内容由迭代现算）
      hdr = header(92, 17, 84, o, 'plain'); parents = [ix(d.iter), ...d.cols.map(ix)];
      const t = new Buf(28); t.u32(0x90d).u32(28).u32(0x10).u16(fpx(o.at?.x ?? 10)).u16(fpx(o.at?.y ?? 64));
      tail = [[2317, t.b], [2008, new Buf(2).u16(1).b]]; label = false; break;
    }
    case 'pcurve': {
      hdr = header(d.polar ? 127 : 126, 6, 99, o, 'line'); parents = [ix(d.fx), ix(d.fy), ix(d.sys)];
      const b = new Buf(40); b.f64(d.lo).f64(d.hi).u32(Math.max(2, Math.round(d.samples)));   // 原版采集：默认 750 个样本；偏移 20 处 0=直角、2=极坐标，其后与函数图像记录相同
      b.o = 20; b.u16(d.polar ? 2 : 0).u16(3).u16(0).u16(0x20).u16(0x55).u16(0x49).u16(1);
      tail = [[2306, b.b]]; label = false; break;
    }
    case 'plot': {
      hdr = header(72, 6, 58, o, 'line'); parents = [ix(d.func), ix(d.sys)];
      const b = new Buf(40); b.f64(d.lo ?? -15.74).f64(d.hi ?? 15.74).u32(Math.max(2, Math.round(d.samples)));   // 采样数按模型保存，不用默认值猜测来源。
      const fn = cx.page.objects.find(x => x.id === d.func)?.def;
      b.o = 20; b.u16(Math.max(0, FUNC_FORMS.indexOf(fn?.k === 'func' ? fn.form ?? 'y=f(x)' : 'y=f(x)')));
      b.o = 22; b.u16(3).u16(0).u16(0x20).u16(0x55).u16(0x49).u16(1);
      tail = [[2306, b.b]]; label = false; break;
    }
    case 'sys': {
      hdr = header(61, 8, 39, o, 'plain'); hdr[10] = 0x20; hdr[12] = 0xc0; hdr[13] = 0xc0; hdr[14] = 0xc0;
      hdr[2] = d.showGrid ? 0 : 1;   // 坐标系对象的“隐藏”位就是网格的显示与否（原版采集 g0/g1：隐藏网格只改这一位）
      // 2308：网格样式（1 方形、0 极坐标、2 矩形）、格点显示（g7）
      parents = [ix(d.axisX), ix(d.axisY)]; tail = [[2308, new Uint8Array([{ square: 1, polar: 0, rect: 2, tri: 2 }[d.grid], 0, d.snap ? 1 : 0, 0, 0, 0, 0, 0])]]; label = false; break;
    }
    case 'iterate': {
      if (!d.maps.length || d.maps.some(m => m.length !== d.pre.length)) throw new Unsupported('迭代的映射不完整');
      const param = 'param' in d.depth ? d.depth.param : undefined;
      const body = [...d.body].map(ix).sort((a, b) => a - b);
      const dv = param !== undefined ? (cx.results.get(param)?.shape as { q?: { v: number } } | undefined)?.q?.v : 'fixed' in d.depth ? d.depth.fixed : undefined;
      hdr = header(param !== undefined ? 89 : 76, 14, 64, o, 'point');
      parents = [...(param !== undefined ? [ix(param)] : []), ...d.pre.map(ix), ...d.maps.flat().map(ix), ...body];
      const b = new Buf(24); b.u16(0).u16(0).u16(d.finalOnly ? 1 : 0).u16(d.pre.length).u16(d.maps.length).u16(0).u32(d.salt ?? 0x2f5f5538).u32(Math.max(0, Math.round(dv ?? 3))).u32(0);
      b.b[0] = 0; tail = [[2314, b.b]]; label = false; break;
    }
    case 'iterpt': hdr = header(88, 1, 4, o, 'point'); parents = [ix(d.img)]; break;
    case 'iterimg': {
      const src = need(cx.page.objects.find(x => x.id === d.src), '迭代象的原象');
      const mode = isPointDef(src.def) ? 'point' : ['poly', 'circle-int', 'arc-int'].includes(src.def.k) ? 'region' : 'line';
      hdr = header(77, 15, 65, o, mode); parents = [ix(d.src), ix(d.iter)]; label = false; break;
    }
    default: throw new Unsupported(`${d.k} 对象`);
  }
  // 变换得到的非点对象（线段、圆、多边形…）：类别和类型与原象相同，样式位也按原象的种类写
  if ((d.k === 'translate' || d.k === 'rotate' || d.k === 'dilate' || d.k === 'reflect') && !role) {
    const sc = transformClass(cx, d.src);
    if (sc.cat !== 1) hdr = header(hdr[0] | (hdr[1] << 8), sc.cat, sc.kind, o, sc.mode);
  }
  out.rec(2000, hdr);
  if (parents) out.rec(2002, parentsRec(parents));
  if (rec3) out.rec(2003, rec3);
  for (const [t, data] of tail) if (t !== 2201) out.rec(t, data);
  if (label && o.label !== undefined) { const [l5, l8] = labelRec(o.label, o.labelShown, d.k === 'free' || d.k === 'onpath' || d.k === 'mid' || d.k === 'inter', !!o.toolLabel); out.rec(2005, l5); out.rec(2008, l8); }
  for (const [t, data] of tail) if (t === 2201) out.rec(t, data);
  out.rec(2007);
}

/** 编码为原版 .gsp。遇到没有样本依据的对象抛 Unsupported，绝不丢弃后继续保存。 */
export function encodeGsp(doc: Doc, notes: Set<string> = new Set()): Uint8Array {
  if (doc.tools?.some(t => t.legacy)) throw new Unsupported('旧版式的内嵌工具请保存在 .ngsp 课件中');
  const out = new Out();
  out.chunks.push(enc.encode('GSP4'));
  const toolCount = doc.tools?.length ?? 0;
  if (doc.pages.length + toolCount + 1 > 0xffff) throw new Unsupported('页与工具的总数超过原格式上限');
  const sig = new Buf(28);
  sig.u16(5).u16(doc.pages.length).u16(toolCount);
  sig.o = 12; sig.u16(1).u16(4).u16(Math.min(doc.current ?? 0, doc.pages.length - 1));
  sig.o = 18; sig.u16(1194).u16(640).u16(9).u16(doc.pages.length + toolCount + 1);
  const images = new Map<Obj, number>(), resources: Uint8Array[] = [];
  for (const pg of doc.pages) for (const ob of pg.objects) if (ob.def.k === 'image') { const r = imageResource(ob.def); images.set(ob, resources.length); resources.push(rec1300(r.bytes, r.w, r.h)); }
  out.rec(900, sig.b); out.rec(902, compat('file')); out.rec(1006); for (const r of resources) out.rec(1300, r); out.rec(1007); out.rec(903);
  for (const page of doc.pages) {
    const cx = { notes, images, fonts: ['Times New Roman', ...new Set(page.objects.flatMap(o => (o.def.k === 'text' && o.def.font.name !== 'Times New Roman' ? [o.def.font.name] : [])))], results: evaluatePage(page), index: new Map<Id, number>(), page, sysRole: new Map<Id, SysRole>(), measureCount: 0, labelCounts: [] } as Ctx;
    page.objects.forEach((o, i) => cx.index.set(o.id, i + 1));
    for (const o of page.objects) if (o.def.k === 'sys') {
      const ctx = { two: o.def.grid === 'rect' || o.def.grid === 'tri', tri: o.def.grid === 'tri', unitX: o.def.unitX };
      for (const [id, role] of [[o.def.origin, 'origin'], [o.def.unitX, 'unitX'], [o.def.unitY, 'unitY'], [o.def.axisX, 'axisX'], [o.def.axisY, 'axisY']] as const) {
        const prior = cx.sysRole.get(id);
        if (prior && (prior.role !== role || (role === 'unitY' && (prior.unitX !== ctx.unitX || prior.two !== ctx.two)))) throw new Unsupported('多个坐标系共享对象的编码角色冲突');
        cx.sysRole.set(id, { ...ctx, role });
      }
    }
    for (const o of page.objects) if (o.def.k === 'onpath' && o.def.abs && !cx.sysRole.has(o.def.path)) cx.sysRole.set(o.def.path, { role: 'axisX', two: false, tri: false, unitX: 0 });
    out.rec(902, compat('page'));
    const ph = new Buf(36); ph.o = 4; ph.i16(Math.round(page.scroll?.x ?? 0)).i16(Math.round(page.scroll?.y ?? 0)); ph.o = 8; ph.u16(0xea1b); ph.o = 16; ph.u16(1).u16(1); ph.o = 24; ph.u32(page.objects.length); out.rec(1000, ph.b);
    if (page.name && !/^\d+$/.test(page.name)) { const nb = enc.encode(page.name); const r = new Uint8Array((nb.length + 2) & ~1); r.set(nb); out.rec(1100, r); }   // 页名：UTF-8，0 结尾，补齐到偶数长度（原版样本）
    // 文档级标签计数：2401 记点标签个数，其余默认
    for (let t = 2400; t <= 2419; t++) { const b = new Buf(6); if (t === 2401) b.u16(page.labelCounter); else if (t !== 2402 && t !== 2409 && t !== 2411) { b.o = 2; b.u16(1); } out.rec(t, b.b); }
    if (page.objects.some(o => o.def.k === 'text')) {       // 文本需要的文档级字体/样式记录（原版样本：1201 字体名，1203 样式表）
      cx.fonts.forEach((nm, i) => { const nb = enc.encode(nm), r = new Uint8Array((nb.length + 3) & ~1); r[0] = i === 0 ? 1 : 0; r.set(nb, 2); out.rec(1201, r); });   // 字体表：[u16 标志][UTF-8 名字][NUL]，补齐到偶数；文本的 P 序号是它在表里的位置
      out.rec(1203, new Uint8Array([0, 0, 0x10, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]));
    }
    for (const o of page.objects) encodeObject(out, o, cx);
    for (const t of page.transforms ?? []) {   // 自定义变换：[u32 原象序号][u32 象序号][u32 0][u32 名称长度][名称 UTF-8][4 字节补零]（原版采集 probe_custom2）
      const nb = enc.encode(t.name), b = new Buf(16 + nb.length + 4);
      b.u32(cx.index.get(t.src) ?? 0).u32(cx.index.get(t.img) ?? 0).u32(0).u32(nb.length); b.b.set(nb, 16);
      out.rec(9009, b.b);
    }
    out.rec(1001); out.rec(903);
  }
  for (const t of doc.tools ?? []) { out.rec(902, compat('tool')); out.chunks.push(b64ToBytes(t.data)); out.rec(903); }
  out.rec(901);
  return out.bytes();
}

// ======================= 解码 =======================
interface RawObj { labelCustom?: boolean; bitmap?: Uint8Array; d2309?: Uint8Array; d2314?: Uint8Array; fonts?: string[]; d2308?: Uint8Array; imgIndex?: number; d2316?: Uint8Array; d2216?: Uint8Array; rect2307?: [number, number]; rect2210?: [number, number, number, number]; d2317?: Uint8Array; d2300?: Uint8Array; rect2200?: [number, number, number, number]; d2310?: Uint8Array; d2311?: Uint8Array; d2306?: Uint8Array; rect?: [number, number, number, number]; method: number; cat: number; kind: number; hidden: boolean; trace: boolean; color: string; dash: 'solid' | 'dash' | 'dot'; width: number; pointSize: number; alpha: number; parents: number[]; p3?: DataView; pos?: [number, number]; label?: string; labelShown: boolean; has: Set<number> }

/** 把 1002…1003 的记录打包成内嵌工具：取名称（1100）、前提条件（1204）、注释（9007），其余原样保存。 */
function isLegacyContainer(recs: RecordEntry[]): boolean {
  const signature = recs.find(r => r.tag === 900)?.data;
  return signature?.[0] === 4 && signature[1] === 0;
}

function makeTool(recs: RecordEntry[], legacy = false): EmbeddedTool {
  const text = (d: Uint8Array) => { const z = d.indexOf(0); return legacyText(d.subarray(0, z < 0 ? d.length : z), legacy); };
  const n = recs.find(r => r.tag === 1100), q = recs.find(r => r.tag === 1204), c = recs.find(r => r.tag === 9007);
  const prereq: number[] = [];
  if (q && q.data.length >= 4) { const v = new DataView(q.data.buffer, q.data.byteOffset, q.data.byteLength); for (let i = 0, k = v.getUint32(0, true); i < k && 4 + 4 * i + 4 <= q.data.length; i++) prereq.push(v.getUint32(4 + 4 * i, true)); }
  const total = recs.reduce((s, r) => s + r.raw.length, 0), all = new Uint8Array(total); let o = 0;
  for (const r of recs) { all.set(r.raw, o); o += r.raw.length; }
  return { name: n ? text(n.data) : '', prereq, ...(c ? { comment: text(c.data) } : {}), data: bytesToB64(all), ...(legacy ? { legacy: true } : {}) };
}

function parseRaw(recs: RecordEntry[], _toolMode = false, legacyTool = false): { pages: RawObj[][]; counters: number[]; scrolls: { x: number; y: number }[]; textTable: { name: string; size: number; bold: boolean; italic: boolean; underline: boolean }[]; precisions: number[]; angleUnitCode?: number; names: (string | undefined)[]; resources: Uint8Array[]; fonts: string[]; transforms: { src: number; img: number; name: string }[][]; tools: EmbeddedTool[] } {
  const scrolls: { x: number; y: number }[] = [];
  const textTable: { name: string; size: number; bold: boolean; italic: boolean; underline: boolean }[] = [];
  const precisions: number[] = []; let angleUnitCode: number | undefined;
  const pages: RawObj[][] = [], counters: number[] = [], names: (string | undefined)[] = [], resources: Uint8Array[] = [], fonts: string[] = [], transforms: { src: number; img: number; name: string }[][] = [];
  const tools: EmbeddedTool[] = [];
  const legacy = isLegacyContainer(recs);
  let page: RawObj[] | undefined, cur: RawObj | undefined, toolRecs: RecordEntry[] | undefined;
  for (const r of recs) {
    const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    // 自定义工具段：1002 … 1003，内部的对象序号是工具自己的，不能混进页面
    if (r.tag === 1002) { toolRecs = [r]; page = undefined; cur = undefined; continue; }
    if (toolRecs) { toolRecs.push(r); if (r.tag === 1003) { tools.push(makeTool(toolRecs, legacy)); toolRecs = undefined; } continue; }
    if (r.tag === 1300) resources.push(r.data);
    else if (r.tag === 1201 && !pages.some(pg => pg.length > 0) && r.data.length > 2) { const z = r.data.indexOf(0, 2); fonts.push(legacyText(r.data.subarray(2, z < 0 ? r.data.length : z), legacyTool)); }
    else if (r.tag === 1000) { page = []; pages.push(page); counters.push(0); scrolls.push(r.data.length >= 8 ? { x: v.getInt16(4, true), y: v.getInt16(6, true) } : { x: 0, y: 0 }); names.push(undefined); transforms.push([]); cur = undefined; }
    else if (r.tag === 9009 && page && r.data.length >= 16) { const n = v.getUint32(12, true); transforms[transforms.length - 1].push({ src: v.getUint32(0, true), img: v.getUint32(4, true), name: dec.decode(r.data.subarray(16, 16 + n)) }); }
    else if (r.tag === 1100 && page) { const z = r.data.indexOf(0); names[names.length - 1] = dec.decode(r.data.subarray(0, z < 0 ? r.data.length : z)); }
    // 页面设置：10040 = [精度][序号 0 角度/1 距离/2 其它]；10042 角度单位 0 弧度、1 度、2 有向度。序号含义按参数选项的顺序（截图核对过角度）。
    else if (r.tag === 10040 && pages.length === 1 && r.data.length >= 2) precisions[r.data[1]] = r.data[0];
    else if (r.tag === 10042 && pages.length === 1 && r.data.length >= 2) angleUnitCode = v.getUint16(0, true);
    else if (r.tag === 10044 && pages.length === 1 && r.data.length > 26) {
      // 六类文本的文档样式（标签、标题、数值、按钮、表格、坐标轴）：[序号][?][?][字号][粗 1/2][斜 1/2][下划线 1/2]…偏移 26 字体名
      const z = r.data.indexOf(0, 26);
      textTable[v.getUint16(0, true)] = { name: dec.decode(r.data.subarray(26, z < 0 ? r.data.length : z)), size: v.getUint16(6, true), bold: v.getUint16(8, true) === 2, italic: v.getUint16(10, true) === 2, underline: v.getUint16(12, true) === 2 };
    }
    else if (r.tag === 2401 && page && r.data.length >= 2) counters[counters.length - 1] = v.getUint16(0, true);
    else if (r.tag === 2000 && page && r.data.length >= 12) {
      const dashCode = r.data[10] >> 4;
      cur = { method: v.getUint16(0, true), hidden: v.getUint16(2, true) !== 0, trace: v.getUint16(4, true) !== 0, cat: v.getUint16(6, true), kind: v.getUint16(8, true), color: r.data.length >= 15 ? rgb(r.data[12], r.data[13], r.data[14]) : '#000000', dash: dashCode === 1 ? 'dash' : dashCode === 0 ? 'dot' : 'solid', width: Math.min(3, r.data[10] & 0xf), pointSize: Math.min(3, r.data[11]), alpha: r.data.length >= 18 ? r.data[17] / 255 : 1, parents: [], labelShown: false, has: new Set([2000]), imgIndex: r.data.length >= 24 ? v.getUint32(20, true) : undefined };
      // 旧版式工具的对象头：第 10 字节 0 虚线、1 细实线、2 粗实线；没有点大小和透明度（原版应用后点大小 1、不透明度 191/255，逐工具实测）。
      if (legacyTool) { const line = r.data[10]; cur.dash = line === 0 ? 'dash' : 'solid'; cur.width = line === 0 ? 1 : Math.min(3, line); cur.pointSize = 1; cur.alpha = 191 / 255; }
      page.push(cur);
    } else if (r.tag === 2007) cur = undefined;
    else if (cur) {
      cur.has.add(r.tag);
      if (r.tag === 2002 && r.data.length >= 4) { const n = v.getUint32(0, true); for (let i = 0; i < n && 8 + i * 4 <= r.data.length; i++) cur.parents.push(v.getUint32(4 + i * 4, true)); }
      else if (r.tag === 2003) cur.p3 = v;
      else if (r.tag === 2314) cur.d2314 = r.data;
      else if (r.tag === 2309) cur.d2309 = r.data;
      else if (r.tag === 2311) cur.d2311 = r.data;
      else if (r.tag === 2310) cur.d2310 = r.data;
      else if (r.tag === 2300) { cur.d2300 = r.data; if (r.data.length >= 16) cur.rect2307 = [upx(v.getInt16(12, true)), upx(v.getInt16(14, true))]; }
      else if (r.tag === 2307 && r.data.length >= 16) cur.rect2307 = [upx(v.getInt16(12, true)), upx(v.getInt16(14, true))];
      else if (r.tag === 2317) cur.d2317 = r.data;
      else if (r.tag === 2210 && r.data.length >= 8) cur.rect2210 = [upx(v.getUint16(0, true)), upx(v.getUint16(2, true)), upx(v.getUint16(4, true)), upx(v.getUint16(6, true))];
      else if (r.tag === 2200 && r.data.length >= 8) cur.rect2200 = [upx(v.getUint16(0, true)), upx(v.getUint16(2, true)), upx(v.getUint16(4, true)), upx(v.getUint16(6, true))];
      else if (r.tag === 2308) cur.d2308 = r.data;
      else if (r.tag === 2306) cur.d2306 = r.data;
      else if (r.tag === 2316) cur.d2316 = r.data;
      else if (r.tag === 8002) cur.bitmap = r.data;
      else if (r.tag === 2216) cur.d2216 = r.data;
      else if (r.tag === 2211 && r.data.length >= 8) cur.rect = [upx(v.getInt16(0, true)), upx(v.getInt16(2, true)), upx(v.getInt16(4, true)), upx(v.getInt16(6, true))];
      else if (r.tag === 2201 && r.data.length >= 16) cur.pos = [v.getFloat64(0, true), v.getFloat64(8, true)];
      else if (r.tag === 2005 && r.data.length >= 24) { const n = v.getUint16(22, true); if (24 + n <= r.data.length) { cur.label = legacyText(r.data.subarray(24, 24 + n), legacyTool); cur.labelShown = v.getUint16(2, true) !== 0; cur.labelCustom = v.getUint16(4, true) !== 0; } }
    }
  }
  return { pages, counters, scrolls, textTable, precisions, angleUnitCode, names, resources, fonts, transforms, tools };
}

type Mk = (r: RawObj, p: (i: number) => Id) => Def | undefined;
/** 解析文本最外层的 <S…<VL 样式属性；没有样式标签时用新版默认字体。 */
/** 文本没有自己的 <S…> 样式时用文档“标题”类样式，出厂是 Times New Roman 16。 */
const DEFAULT_TEXT_FONT = 'Times New Roman';
const DEFAULT_FONT_SPECS = new WeakSet<object>();
function textFont(markup: string, fonts: string[], parent?: import('../core/model').FontSpec): import('../core/model').FontSpec {
  const f = { ...(parent ?? { name: DEFAULT_TEXT_FONT, size: 16, bold: false, italic: false, underline: false, color: '#000000' }) };
  const m = /^<S([^<]*)<VL/.exec(markup); if (!m) { if (!parent) DEFAULT_FONT_SPECS.add(f); return f; }
  let rgb: [number, number, number] | undefined;
  for (const a of m[1].matchAll(/([#PWSURGL])([0-9A-F]*)/g)) {
    const v = a[2] === '' ? 0 : parseInt(a[2], 16);
    if (a[1] === '#') f.size = Math.round((v * 96) / 72);
    else if (a[1] === 'P') f.name = fonts[v] ?? f.name;
    else if (a[1] === 'W') f.bold = v === 2;
    else if (a[1] === 'S') f.italic = v === 2;
    else if (a[1] === 'U') f.underline = v === 2;
    else { rgb ??= [0, 0, 0]; rgb[a[1] === 'R' ? 0 : a[1] === 'G' ? 1 : 2] = Math.max(0, Math.min(255, v - 1)); }
  }
  if (rgb) f.color = `#${rgb.map(x => x.toString(16).padStart(2, '0')).join('')}`;
  return f;
}
const gridOf = (d?: Uint8Array): 'square' | 'polar' | 'rect' => (d && d.length >= 2 ? ({ 0: 'polar', 1: 'square', 2: 'rect' } as const)[d[0] as 0 | 1 | 2] ?? 'square' : 'square');
const MEASURE_BY_METHOD: Partial<Record<number, import('../core/model').MeasureKind>> = { 36: 'length', 37: 'distance', 38: 'distance', 44: 'arclength', 39: 'perimeter', 40: 'circumference', 46: 'radius', 41: 'angle', 43: 'arcangle', 42: 'area', 47: 'ratio', 65: 'abscissa', 66: 'ordinate', 86: 'coorddist', 87: 'slope', 94: 'pointvalue', 124: 'coordradius', 125: 'coordangle' };

/** 多边形上的点读出时还不知道各边长度，先记下（边序号，边上比例）。 */
const TEXT_PENDING = new WeakSet<object>();
const POLY_PENDING = new WeakMap<object, { side: number; u: number }>();
/** 坐标轴上的点：文件里 t=0.5 在原点，单位是 200 个页面像素（与单位长度无关，原版采集 pl5/pl6）；x 轴朝单位点方向增大，y 轴朝单位点的反方向（屏幕向下）增大。读完整页后换算成沿“原点→单位点”的比例。 */
const AXIS_PX = 200;
/** 旋转/极坐标平移的记录里同时有 −sinθ、cosθ 和角度字段：较老的课件把角度字段写成弧度，所以以 sin/cos 为准校验，不符时取 sin/cos 的角度（度）。 */
function angleDeg(v: DataView): number {
  const field = v.getFloat64(20, true), sc = (Math.atan2(-v.getFloat64(4, true), v.getFloat64(12, true)) * 180) / Math.PI;
  const diff = ((field - sc) % 360 + 540) % 360 - 180;
  return Math.abs(diff) < 1e-6 ? field : sc;
}

/** 迭代（方法 76：次数存在记录里；89：次数取自第一个父对象）。2314：[u32 0][u16 只显示最终迭代][u16 前像数 P][u16 映射数 M][u16 0][u32 盐][u32 次数][u32 0]；
 *  父对象 = [次数对象] + 前像×P + 初象×(P×M，按映射排) + 目标和初象依赖的那部分后代。 */
const decodeIterate: Mk = (r, p) => {
  if (r.cat !== 14 || r.kind !== 64 || !r.d2314 || r.d2314.byteLength < 20) return undefined;
  const dv = new DataView(r.d2314.buffer, r.d2314.byteOffset, r.d2314.byteLength);
  const fin = dv.getUint16(4, true), P = dv.getUint16(6, true), M = dv.getUint16(8, true), lead = r.method === 89 ? 1 : 0;
  if (fin > 1 || P < 1 || M < 1 || r.parents.length < lead + P + P * M) return undefined;
  const at = (a: number, n: number) => Array.from({ length: n }, (_, i) => p(a + i));
  const maps = Array.from({ length: M }, (_, j) => at(lead + P + j * P, P));
  return { k: 'iterate', pre: at(lead, P), maps, body: at(lead + P + P * M, r.parents.length - lead - P - P * M), depth: lead ? { param: p(0) } : { fixed: dv.getUint32(16, true) }, ...(fin ? { finalOnly: true } : {}), salt: dv.getUint32(12, true) };
};
const DECODERS: Record<number, Mk> = {
  0: r => (r.pos ? { k: 'free', x: r.pos[0], y: r.pos[1] } : undefined),
  1: (r, p) => (r.parents.length === 1 ? { k: 'mid', seg: p(0) } : undefined),
  2: (r, p) => (r.cat === 2 && r.parents.length === 2 ? { k: 'seg', a: p(0), b: p(1) } : undefined),
  63: (r, p) => (r.parents.length === 2 ? { k: 'line', a: p(0), b: p(1) } : undefined),
  64: (r, p) => (r.parents.length === 2 ? { k: 'ray', a: p(0), b: p(1) } : undefined),
  3: (r, p) => (r.parents.length === 2 ? { k: 'circle', c: p(0), p: p(1) } : undefined),
  4: (r, p) => (r.parents.length === 2 && r.cat === 3 ? { k: 'circle-seg', c: p(0), seg: p(1) } : undefined),
  5: (r, p) => (r.parents.length === 2 ? { k: 'perp', pt: p(0), line: p(1) } : undefined),
  6: (r, p) => (r.parents.length === 2 ? { k: 'parallel', pt: p(0), line: p(1) } : undefined),
  7: (r, p) => (r.parents.length === 3 ? { k: 'bisect', a: p(0), v: p(1), b: p(2) } : undefined),
  8: (r, p) => (r.cat === 4 && r.parents.length >= 3 ? { k: 'poly', pts: r.parents.map((_, i) => p(i)) } : undefined),
  98: (r, p) => (r.parents.length === 2 && r.p3 && r.p3.byteLength >= 8 ? { k: 'inter', a: p(0), b: p(1), branch: r.p3.getUint32(4, true) } : undefined),
  9: (r, p) => (r.parents.length === 2 ? { k: 'inter', a: p(0), b: p(1), branch: 0 } : undefined),
  93: (r, p) => (r.cat === 1 && r.kind === 45 && r.parents.length === 2 ? { k: 'inter', a: p(0), b: p(1), branch: 0 } : undefined),
  10: (r, p) => (r.cat === 5 && r.parents.length === 1 ? { k: 'circle-int', circle: p(0) } : undefined),
  11: (r, p) => (r.parents.length === 2 ? { k: 'inter', a: p(0), b: p(1), branch: 0 } : undefined),
  12: (r, p) => (r.parents.length === 2 ? { k: 'inter', a: p(0), b: p(1), branch: 1 } : undefined),
  13: (r, p) => (r.parents.length === 2 ? { k: 'inter', a: p(0), b: p(1), branch: 0 } : undefined),
  14: (r, p) => (r.parents.length === 2 ? { k: 'inter', a: p(0), b: p(1), branch: 1 } : undefined),
  69: (r, p) => (r.parents.length === 3 && r.cat === 1 && r.kind === 56 ? { k: 'plotxy', x: p(0), y: p(1), sys: p(2) } : undefined),
  70: (r, p) => (r.parents.length === 3 && r.cat === 1 && r.kind === 56 ? { k: 'plotxy', x: p(0), y: p(1), sys: p(2), polar: true } : undefined),
  68: (r, p) => (r.parents.length === 1 && r.cat === 1 && r.kind === 56 && r.p3 && r.p3.byteLength >= 20 ? { k: 'plotfix', sys: p(0), x: r.p3.getFloat64(4, true) * Math.cos(r.p3.getFloat64(12, true)), y: r.p3.getFloat64(4, true) * Math.sin(r.p3.getFloat64(12, true)) } : undefined),
  123: (r, p) => (r.parents.length === 1 && r.cat === 1 && r.kind === 56 && r.p3 && r.p3.byteLength >= 12 ? { k: 'pointval', path: p(0), fixed: r.p3.getFloat64(4, true) } : undefined),
  109: (r, p) => (r.parents.length === 2 && r.cat === 1 && r.kind === 56 ? { k: 'axispt', axis: 'x', value: p(0), sys: p(1) } : undefined),
  110: (r, p) => (r.parents.length === 2 && r.cat === 1 && r.kind === 56 ? { k: 'axispt', axis: 'y', value: p(0), sys: p(1) } : undefined),
  95: (r, p) => (r.parents.length === 2 && r.cat === 1 && r.kind === 56 ? { k: 'pointval', path: p(1), value: p(0) } : undefined),
  67: (r, p) => (r.parents.length === 1 && r.cat === 1 && r.kind === 56 && r.p3 && r.p3.byteLength >= 20 ? { k: 'plotfix', sys: p(0), x: r.p3.getFloat64(4, true), y: r.p3.getFloat64(12, true) } : undefined),
  15: (r, p) => {
    if (r.parents.length !== 1 || !r.p3) return undefined;
    const pt = r.p3.getUint16(2, true);
    if (pt === 28 && r.p3.byteLength >= 20) return { k: 'onpath', path: p(0), t: Math.atan2(r.p3.getFloat64(12, true), r.p3.getFloat64(4, true)) };   // (cosθ, sinθ)，θ 为数学方向：实测点在圆心正上方时第二分量 +1
    if ([12, 13, 14].includes(pt) && r.p3.byteLength >= 12) return { k: 'onpath', path: p(0), t: r.p3.getFloat64(4, true) };
    if ((pt === 46 || pt === 47) && r.p3.byteLength >= 12) return { k: 'onpath', path: p(0), t: r.p3.getFloat64(4, true) - 0.5 };   // 垂线/平行线：模型里 t=0 在所过的点，沿参照线向量（垂线转 90°）走 t 倍
    if (pt === 67 && r.p3.byteLength >= 12) return { k: 'onpath', path: p(0), t: r.p3.getFloat64(4, true) };
    if (pt === 16 && r.p3.byteLength >= 20) return { k: 'onpath', path: p(0), t: Math.atan2(-r.p3.getFloat64(12, true), r.p3.getFloat64(4, true)) };
    if ((pt === 42 || pt === 58) && r.p3.byteLength === 12) return { k: 'onpath', path: p(0), t: r.p3.getFloat64(4, true) };   // 轨迹（42）、函数图像（58）上的点：t 是沿采样的比例（原版采集 pp01）
    if (pt >= 52 && pt <= 60 && r.p3.byteLength >= 16) { const def: Def = { k: 'onpath', path: p(0), t: 0 }; POLY_PENDING.set(def, { side: r.p3.getUint32(12, true), u: r.p3.getFloat64(4, true) }); return def; }   // 暂存：边序号 + 比例，读完整页后换算成周长比例
    return undefined;
  },
  16: (r, p) => (r.parents.length === 3 ? { k: 'translate', src: p(0), by: { mode: 'vector', from: p(1), to: p(2) } } : undefined),
  17: (r, p) => (r.parents.length === 1 && r.p3 && r.p3.byteLength >= 52 ? { k: 'translate', src: p(0), by: { mode: 'rect', dx: r.p3.getFloat64(4, true) / CM, dy: r.p3.getFloat64(24, true) / CM } } : undefined),   // 记录同时有像素值和显示值；显示值的单位可能是厘米、英寸或像素，只有像素值可靠
  18: (r, p) => (r.parents.length === 2 && r.p3 && r.p3.byteLength >= 20 ? { k: 'translate', src: p(0), by: { mode: 'rect', dx: r.p3.getFloat64(4, true) / CM, dy: 0, dyBy: p(1) } } : undefined),
  19: (r, p) => (r.parents.length === 2 && r.p3 && r.p3.byteLength >= 20 ? { k: 'translate', src: p(0), by: { mode: 'rect', dx: 0, dy: r.p3.getFloat64(4, true) / CM, dxBy: p(1) } } : undefined),
  20: (r, p) => (r.parents.length === 3 ? { k: 'translate', src: p(0), by: { mode: 'rect', dx: 0, dy: 0, dxBy: p(1), dyBy: p(2) } } : undefined),
  21: (r, p) => (r.parents.length === 1 && r.p3 && r.p3.byteLength >= 60 ? { k: 'translate', src: p(0), by: { mode: 'polar', angle: { fixed: angleDeg(r.p3) }, dist: { fixed: r.p3.getFloat64(32, true) / CM } } } : undefined),
  27: (r, p) => (r.parents.length === 2 && r.p3 && r.p3.byteLength >= 28 ? { k: 'rotate', src: p(0), center: p(1), angle: { mode: 'fixed', deg: angleDeg(r.p3) } } : undefined),
  29: (r, p) => (r.parents.length === 3 ? { k: 'rotate', src: p(0), center: p(1), angle: { mode: 'value', m: p(2) } } : undefined),
  28: (r, p) => (r.parents.length === 5 ? { k: 'rotate', src: p(0), center: p(1), angle: { mode: 'marked', a: p(2), v: p(3), b: p(4) } } : undefined),
  22: (r, p) => (r.parents.length === 4 && r.p3 && r.p3.byteLength >= 20 ? { k: 'translate', src: p(0), by: { mode: 'polar', dist: { fixed: r.p3.getFloat64(4, true) / CM }, angle: { pts: [p(1), p(2), p(3)] } } } : undefined),
  24: (r, p) => (r.parents.length === 2 && r.p3 && r.p3.byteLength >= 28 ? { k: 'translate', src: p(0), by: { mode: 'polar', dist: { m: p(1) }, angle: { fixed: angleDeg(r.p3) } } } : undefined),
  25: (r, p) => (r.parents.length === 5 ? { k: 'translate', src: p(0), by: { mode: 'polar', dist: { m: p(4) }, angle: { pts: [p(1), p(2), p(3)] } } } : undefined),
  33: (r, p) => (r.parents.length === 3 ? { k: 'dilate', src: p(0), center: p(1), ratio: { mode: 'value', m: p(2) } } : undefined),
  30: (r, p) => (r.parents.length === 2 && r.p3 && r.p3.byteLength >= 12 ? { k: 'dilate', src: p(0), center: p(1), ratio: { mode: 'fixed', num: r.p3.getFloat64(4, true), den: 1 } } : undefined),
  32: (r, p) => (r.parents.length === 5 ? { k: 'dilate', src: p(0), center: p(1), ratio: { mode: 'marked', a: p(2), b: p(3), c: p(4) } } : undefined),
  31: (r, p) => (r.parents.length === 4 ? { k: 'dilate', src: p(0), center: p(1), ratio: { mode: 'marked', a: p(2), b: p(3) } } : undefined),
  34: (r, p) => (r.parents.length === 2 ? { k: 'reflect', src: p(0), mirror: p(1) } : undefined),
  79: (r, p) => (r.parents.length === 3 ? { k: 'arc-circle', circle: p(0), a: p(1), b: p(2) } : undefined),
  80: (r, p) => (r.cat === 12 && r.kind === 67 && r.parents.length === 3 ? { k: 'arc-center', c: p(0), a: p(1), b: p(2) } : undefined),
  75: (r, p) => {
    if (!r.p3 || r.p3.byteLength < 24) return undefined;
    const flags = r.p3.getUint32(4, true), mode = ({ 0x10: 'color', 0x20: 'gray', 0x30: 'rgb', 0x40: 'hsv' } as const)[(flags & 0xf0) as 0x10 | 0x20 | 0x30 | 0x40];
    if (!mode || (flags & 15) > 2 || r.parents.length !== (mode === 'rgb' || mode === 'hsv' ? 4 : 2)) return undefined;
    return { k: 'colorize', src: p(0), params: r.parents.slice(1).map((_, i) => p(i + 1)), mode, cycle: (['none', 'one', 'two'] as const)[flags & 15], from: r.p3.getFloat64(8, true), to: r.p3.getFloat64(16, true) };
  },
  81: (r, p) => (r.parents.length === 3 ? { k: 'arc3', a: p(0), b: p(1), c: p(2) } : undefined),
  82: (r, p) => (r.cat === 13 && r.kind === 68 && r.parents.length === 1 ? { k: 'arc-int', arc: p(0), mode: 'sector' } : undefined),
  83: (r, p) => (r.cat === 13 && r.kind === 69 && r.parents.length === 1 ? { k: 'arc-int', arc: p(0), mode: 'segment' } : undefined),
  101: (r, p) => (r.cat === 1 && r.kind === 89 && r.parents.length >= 4 ? { k: 'custom-point', img: p(0), src: p(1), pre: p(2), body: r.parents.slice(3).map((_, i) => p(i + 3)) } : undefined),
  102: (r, p) => (r.cat === 6 && r.kind === 90 && r.parents.length >= 3 ? { k: 'locus', out: p(0), driver: p(2), samples: r.d2306 && r.d2306.length >= 20 ? new DataView(r.d2306.buffer, r.d2306.byteOffset, r.d2306.length).getUint32(16, true) : 500 } : undefined),
  113: (r, p) => (r.cat === 18 && r.kind === 95 && r.parents.length === 3 ? { k: 'angle-mark', a: p(0), v: p(1), b: p(2), count: 1 } : undefined),
  92: (r, p) => {   // 迭代数据表：[迭代, 数值初象…]；位置在 2317
    if (r.cat !== 17 || r.kind !== 84 || r.parents.length < 2 || !r.d2317 || r.d2317.byteLength < 16) return undefined;
    const dv = new DataView(r.d2317.buffer, r.d2317.byteOffset, r.d2317.byteLength);
    r.rect = [upx(dv.getInt16(12, true)), upx(dv.getInt16(14, true)), 0, 0];
    return { k: 'itertable', iter: p(0), cols: r.parents.slice(1).map((_, i) => p(i + 1)) };
  },
  76: decodeIterate,
  89: decodeIterate,
  77: (r, p) => (r.cat === 15 && r.kind === 65 && r.parents.length === 2 ? { k: 'iterimg', src: p(0), iter: p(1) } : undefined),
};

export function decodeGsp(bytes: Uint8Array, opts: { tool?: boolean; legacyTool?: boolean } = {}): DecodeResult {
  const rd = readRecords(bytes);
  if (!rd.complete) throw new Error(`文件结构不完整：${rd.warnings.join('；')}`);
  const { pages: rawPages, counters, scrolls, textTable, precisions, angleUnitCode, names, resources, fonts: fontTable, transforms: rawTransforms, tools: rawTools } = parseRaw(rd.records, opts.tool, opts.legacyTool);
  const doc = newDoc('未命名');
  doc.pages = [];
  let unknown = 0;
  const notes: string[] = [];
  rawPages.forEach((raw, pi) => {
    const page = emptyPage(names[pi] || String(pi + 1));
    page.labelCounter = counters[pi] ?? 0;
    page.scroll = scrolls[pi] ?? { x: 0, y: 0 };   // 页记录偏移 4、6 是视图滚动位置：屏幕坐标 = 文件坐标 - 滚动
    const ids = (i: number): Id => i; // 对象 ID 直接取文件中的 1 起始序号
    const sysCandidates = new Map<number, RawObj>();
    raw.forEach((r, i) => sysCandidates.set(i + 1, r));
    raw.forEach((r, i) => {
      const id = i + 1;
      const base: Style = { color: r.color, pointSize: r.pointSize, width: r.width, dash: r.dash, ...(r.cat === 4 || r.cat === 5 ? { fillAlpha: r.alpha } : {}) };
      let def: Def | undefined;
      const mm = MEASURE_BY_METHOD[r.method];
      if (r.cat === 7 && mm) def = { k: 'measure', m: r.method === 38 && r.parents.length === 1 ? 'arclength' : mm, refs: r.parents.map(ids) }; // 旧新版曾将单父弧长写成38；原版弧长实测为44，38为点线距离。
      else if (r.cat === 11 && [79, 80, 81, 33, 48, 49, 50, 51, 57, 75, 76].includes(r.kind) && r.d2311 && r.d2311.length >= 74) {
        const dv = new DataView(r.d2311.buffer, r.d2311.byteOffset, r.d2311.byteLength);
        const n = dv.getUint16(22 + 22, true);
        const toks = Array.from({ length: n }, (_, k) => dv.getUint16(r.d2311!.length - 2 * n + 2 * k, true));
        try {
          if (r.kind === 79 || r.kind === 80 || r.kind === 81) {
            const e = tokensToExpr(toks, () => 0);
            const v = e.t === 'num' ? e.v : e.t === 'neg' && e.a.t === 'num' ? -e.a.v : NaN;
            if (Number.isFinite(v)) def = { k: 'param', name: r.label ?? 't', value: v, unit: r.kind === 81 ? 'angle' : r.kind === 80 ? 'distance' : 'none', showEdit: true };
          } else {
            const e = tokensToExpr(toks, i => r.parents[i]);
            def = r.kind === 51 || r.kind === 48 || r.kind === 49 || r.kind === 50 || r.kind === 33 ? { k: 'calc', expr: e, unit: r.kind === 48 ? 'distance' : r.kind === 49 ? 'angle' : 'none' } : { k: 'func', name: r.label ?? 'f', expr: e, param: 'x' };
          }
        } catch { /* 令牌不认识：保持 unknown */ }
      }
      else if (r.cat === 10 && r.kind === 23 && r.method === 62 && r.d2310 && r.d2310.length === 24 && r.parents.length > 0) {
        const dv = new DataView(r.d2310.buffer, r.d2310.byteOffset, r.d2310.byteLength);
        const A = dv.getUint16(12, true), B = dv.getUint16(14, true), at = { x: upx(dv.getUint16(20, true)), y: upx(dv.getUint16(22, true)) };
        const mk = (action: import('../core/model').ButtonAction, dflt: string) => { const text = r.label ?? dflt; return { k: 'button' as const, action, text, at, w: Math.max(70, text.length * 16 + 24), h: 28 }; };
        const ps = r.parents.map(ids);
        if ((A === 0 || A === 1) && B < 8) def = mk({ type: 'hideshow', targets: ps, mode: B & 4 ? 'toggle' : A === 0 ? 'hide' : 'show', first: A === 0 ? 'hide' : 'show', fade: !!(B & 2), select: !!(B & 1) }, A === 0 ? '隐藏' : '显示');
        else if (A === 2 && B === 0 && r.p3 && r.p3.byteLength >= 24) {
          const sp = r.p3.getFloat32(8, true), dir = (r.p3.getUint16(6, true) >> 12) & 3, speed = sp === 4 ? 'slow' : sp === 24 ? 'medium' : sp === 80 ? 'fast' : Number.isFinite(sp) && sp > 0 ? sp : undefined;
          if (speed) def = mk({ type: 'animate', targets: ps, speed, direction: (['forward', 'backward', 'bounce', 'random'] as const)[dir], ...(r.p3.getUint16(6, true) & 0x8000 ? { once: true } : {}) }, '动画');
        }
        else if (A === 3 && B <= 3 && ps.length >= 2 && ps.length % 2 === 0 && dv.getUint32(16, true) <= 1) def = mk({ type: 'move', from: ps[0], to: ps[1], ...(ps.length > 2 ? { pairs: Array.from({ length: ps.length / 2 - 1 }, (_, i) => [ps[2 * i + 2], ps[2 * i + 3]] as [Id, Id]) } : {}), speed: (['slow', 'medium', 'fast', 'high'] as const)[B], ...(dv.getUint32(16, true) === 1 ? { toInitial: true } : {}) }, '移动');
        else if (A === 7 && B < 64 && ps.length >= 1) { const u = dv.getUint32(16, true) / 10; def = mk({ type: 'series', buttons: ps, mode: B & 1 ? 'seq' : 'together', ...(B & 2 ? { deselect: true } : {}), ...(B & 4 ? { stopAnim: true } : {}), ...(B & 8 ? { clearTraces: true } : {}), ...(B & 16 ? { after: 'first' as const } : B & 32 ? { after: 'duration' as const } : {}), ...((B & 1 || B & 32) && u > 0 ? { seconds: u } : {}) }, '系列'); }
        else if (A === 8 && B === 0 && ps.length >= 1 && ps.length <= 2) def = mk({ type: 'sound', funcs: ps }, '听到函数');
        else if (A === 4 && B <= 1 && ps.length === 1) def = mk({ type: 'scroll', point: ps[0], where: B === 1 ? 'center' : 'topleft' }, '滚动');
      }
      else if (r.cat === 10 && r.kind === 23 && r.method === 0 && r.d2310 && r.d2310.length >= 24 && r.parents.length === 0) {
        const dv = new DataView(r.d2310.buffer, r.d2310.byteOffset, r.d2310.byteLength);
        if (dv.getUint16(12, true) === 5 && r.d2310.length === 24) {
          const text = r.label ?? '链接', rc = r.rect2210 ?? [upx(dv.getUint16(20, true)), upx(dv.getUint16(22, true)), 0, 0];
          def = { k: 'button', action: { type: 'link', page: dv.getUint32(16, true) + 1 }, text, at: { x: rc[0], y: rc[1] }, w: Math.max(70, rc[2] - rc[0] || text.length * 16 + 24), h: Math.max(24, rc[3] - rc[1] || 28) };
        } else if (dv.getUint16(12, true) === 6) {
          const n = dv.getUint16(24, true), url = dec.decode(r.d2310.subarray(26, 26 + n)), text = r.label ?? url, rc = r.rect2210 ?? [upx(dv.getUint16(20, true)), upx(dv.getUint16(22, true)), 0, 0];
          if (/^https?:\/\/[^\s"<>]+$/i.test(url)) def = { k: 'button', action: { type: 'link', page: 0, url }, text, at: { x: rc[0], y: rc[1] }, w: Math.max(70, rc[2] - rc[0] || text.length * 16 + 24), h: Math.max(24, rc[3] - rc[1] || 28) };
        }
      }
      else if (r.cat === 0 && r.kind === 59 && (r.method === 73 || r.method === 90) && r.d2300 && r.rect2307 && (r.method !== 90 || r.parents.length >= 1)) {
        const dv = new DataView(r.d2300.buffer, r.d2300.byteOffset, r.d2300.byteLength);
        const n = dv.getUint16(16, true), payload = r.d2300.subarray(18, 18 + n), markup = legacyText(payload, opts.legacyTool), lead = r.method === 90 ? 1 : 0, refs = r.parents.slice(lead).map(ids);
        const text = readRichText(payload, refs.length, lead + 1, opts.legacyTool);
        if (text !== undefined) {
          const w = Math.max(40, Math.max(...text.split('\n').map(s => s.length)) * 8 + 10), h = Math.max(24, text.split('\n').length * 24);
          def = { k: 'text', text, at: { x: r.rect2307[0], y: r.rect2307[1] }, w, h, ...(lead ? { anchor: ids(r.parents[0]), off: { x: -w / 2, y: -h / 2 } } : {}), refs, font: textFont(markup, fontTable) };
          if (lead && !opts.tool) TEXT_PENDING.add(def);
        }
      }
      else if (r.cat === 0 && r.kind === 19 && r.method === 0 && r.d2300 && r.rect2200) {
        const dv = new DataView(r.d2300.buffer, r.d2300.byteOffset, r.d2300.byteLength);
        const n = dv.getUint16(16, true), markup = legacyText(r.d2300.subarray(18, 18 + n), opts.legacyTool);
        const lines = [...markup.matchAll(/<T[0-9A-Fa-f]+x([^<>]*)>/g)].map(m => m[1]);
        const [l, t, rr, bb] = r.rect2200;
        if (lines.length) def = { k: 'text', text: lines.join('\n'), at: { x: l, y: t }, w: Math.max(20, rr - l), h: Math.max(20, bb - t), font: textFont(markup, fontTable) };
      }
      else if (r.cat === 0 && (r.kind === 36 || r.kind === 37) && (r.method === 50 || r.method === 51) && r.parents.length === 2) def = { k: 'measure', m: 'equation', refs: r.parents.map(ids) };
      else if (r.cat === 0 && r.kind === 34 && r.method === 49 && r.parents.length === 2) def = { k: 'measure', m: 'coords', refs: r.parents.map(ids) };
      else if (r.cat === 17 && r.kind === 83 && r.method === 91 && r.d2317 && r.parents.length >= 1) {
        const dv = new DataView(r.d2317.buffer, r.d2317.byteOffset, r.d2317.byteLength);
        const text = dec.decode(r.d2317.subarray(28)).replace(/\0+$/, '');
        const vals = [...text.matchAll(/<H<H<T[0-9A-Fa-f]+x([-0-9.]+)>/g)].map(m => Number(m[1])), nc = r.parents.length, rows: number[][] = [];
        for (let i = 0; i + nc <= vals.length; i += nc) rows.push(vals.slice(i, i + nc));
        def = { k: 'table', cols: r.parents.map(x => ids(x)), rows };
        r.rect = [upx(dv.getInt16(12, true)), upx(dv.getInt16(14, true)), 0, 0];
      }
      else if (r.cat === 16 && r.method === 0 && r.parents.length === 0 && r.bitmap && r.d2216?.length === 8) {
        const bitmap = legacyBitmap(r.bitmap), rect = new DataView(r.d2216.buffer, r.d2216.byteOffset, r.d2216.byteLength);
        const x = rect.getInt16(0, true), y = rect.getInt16(2, true), w = rect.getInt16(4, true) - x, h = rect.getInt16(6, true) - y;
        if (bitmap && w > 0 && h > 0) def = { k: 'image', data: bytesToB64(bitmap.bytes), mime: 'image/bmp', at: { x, y }, w, h };
      }
      else if (r.cat === 16 && (r.kind === 78 || r.kind === 98) && r.method === 0 && r.d2316 && r.d2216 && r.d2216.length >= 48 && r.parents.length === 0 && r.imgIndex !== undefined && resources[r.imgIndex] && resources[r.imgIndex].length > 8) {
        const res = resources[r.imgIndex], rv = new DataView(res.buffer, res.byteOffset, res.byteLength), av = new DataView(r.d2216.buffer, r.d2216.byteOffset, r.d2216.byteLength);
        const png = trimPng(res.subarray(8)), nw = rv.getUint32(0, true), nh = rv.getUint32(4, true);
        if (pngSize(png) && nw && nh) {
          const affine: Affine = [nw * av.getFloat64(0, true), nh * av.getFloat64(8, true), av.getFloat64(16, true), nw * av.getFloat64(24, true), nh * av.getFloat64(32, true), av.getFloat64(40, true)];
          const box = imageBox(imageCorners({ at: { x: 0, y: 0 }, w: 0, h: 0, affine }));
          const normal = affine[1] === 0 && affine[3] === 0 && affine[0] >= 0 && affine[4] >= 0;
          def = { k: 'image', data: bytesToB64(png), mime: 'image/png', ...box, ...(!normal ? { affine } : {}) };
        }
      }
      else if (r.cat === 6 && (r.kind === 42 || r.kind === 43) && r.method === 35 && r.parents.length >= 4 && r.d2306 && r.d2306.length >= 24) {
        const dv = new DataView(r.d2306.buffer, r.d2306.byteOffset, r.d2306.byteLength);
        def = { k: 'locus', driver: ids(r.parents[2]), out: ids(r.parents[0]), samples: Math.max(40, dv.getUint32(16, true)) };
      }
      else if (r.cat === 6 && r.kind === 99 && (r.method === 126 || r.method === 127) && r.parents.length === 3 && r.d2306 && r.d2306.length >= 20) {
        const dv = new DataView(r.d2306.buffer, r.d2306.byteOffset, r.d2306.byteLength);
        def = { k: 'pcurve', fx: ids(r.parents[0]), fy: ids(r.parents[1]), sys: ids(r.parents[2]), lo: dv.getFloat64(0, true), hi: dv.getFloat64(8, true), polar: r.method === 127, samples: dv.getUint32(16, true) };
      }
      else if (r.cat === 6 && r.kind === 58 && r.method === 72 && r.parents.length === 2 && r.d2306 && r.d2306.length >= 20) {
        const dv = new DataView(r.d2306.buffer, r.d2306.byteOffset, r.d2306.byteLength);
        def = { k: 'plot', func: ids(r.parents[0]), sys: ids(r.parents[1]), lo: dv.getFloat64(0, true), hi: dv.getFloat64(8, true), samples: dv.getUint32(16, true) };
      }
      else if (r.method === 88 && r.cat === 1 && r.kind === 4 && r.parents.length === 1 && sysCandidates.get(r.parents[0])?.kind === 65) def = { k: 'iterpt', img: ids(r.parents[0]) };
      else if (r.method === 0 && r.kind === 41 && r.pos) def = { k: 'free', x: r.pos[0], y: r.pos[1] };
      else if (r.method === 52 && r.parents.length === 1 && r.cat === 1) def = { k: 'translate', src: ids(r.parents[0]), by: { mode: 'rect', dx: (r.p3?.getFloat64(4, true) ?? CM) / CM, dy: 0 } };
      else if ((r.method === 54 || r.method === 55) && r.parents.length === 1 && r.cat === 1) {
        const ux = sysCandidates.get(r.parents[0]);
        if (ux?.parents[0] !== undefined) def = { k: 'translate', src: ids(ux.parents[0]), by: { mode: 'rect', dx: 0, dy: (r.p3?.getFloat64(4, true) ?? CM) / CM } };
        else def = { k: 'axis-unit', axis: ids(r.parents[0]), direction: 'y', ...(r.method === 55 ? { distance: r.p3?.getFloat64(4, true) ?? CM } : {}) };
      }
      else if (r.method === 56 && r.cat === 1 && r.kind === 40 && r.parents.length === 1 && r.p3 && r.p3.byteLength >= 12 && sysCandidates.get(r.parents[0])?.method === 59) {
        const ax = sysCandidates.get(r.parents[0])!;
        def = { k: 'translate', src: ids(ax.parents[0]), by: { mode: 'rect', dx: 0, dy: r.p3.getFloat64(4, true) / CM } };
      }
      else if (r.method === 15 && r.cat === 1 && r.kind === 10 && r.parents.length === 1 && r.p3 && r.p3.byteLength >= 12 && r.p3.getUint16(2, true) === 38 && sysCandidates.get(r.parents[0])?.method === 58) {
        const axIdx = r.parents[0], isY = raw.some(q => q.method === 61 && q.cat === 8 && q.parents[1] === axIdx);
        def = { k: 'onpath', path: ids(axIdx), t: ((r.p3.getFloat64(4, true) - 0.5) * AXIS_PX * (isY ? -1 : 1)), abs: true };
      }
      else if (r.method === 58 && r.cat === 9 && r.parents.length === 2) def = { k: 'line', a: ids(r.parents[0]), b: ids(r.parents[1]) };
      else if ((r.method === 59 || r.method === 60) && r.cat === 9 && r.kind === 38 && r.parents.length === (r.method === 59 ? 2 : 1)) def = { k: 'axis-line', axis: r.d2309?.[0] ? 'x' : 'y', ...(r.method === 59 ? { origin: ids(r.parents[0]) } : {}), unit: ids(r.parents[r.method === 59 ? 1 : 0]), mode: r.method === 59 ? 'distance' : 'circle' };
      else if (opts.tool && r.method === 15 && r.cat === 1 && r.kind === 10 && r.parents.length === 1 && !r.p3) def = { k: 'onpath', path: ids(r.parents[0]), t: 0 }; // 应用时按路径类型随机初始化；不是固定放在端点
      else if (r.method === 61 && r.cat === 8 && r.parents.length === 2) {
        const ax = sysCandidates.get(r.parents[0]), ay = sysCandidates.get(r.parents[1]);
        if (ax && ay) def = { k: 'sys', origin: ids(ax.parents[0] ?? r.parents[0]), unitX: ids(ax.parents[1] ?? r.parents[0]), unitY: ids(ay.parents[1] ?? r.parents[1]), axisX: ids(r.parents[0]), axisY: ids(r.parents[1]), grid: (() => { const g = gridOf(r.d2308); return g === 'rect' && ax.d2309 && ax.d2309.length >= 4 && ax.d2309[2] === 1 ? 'tri' : g; })(), showGrid: !r.hidden, snap: !!r.d2308 && r.d2308.length >= 4 && r.d2308[2] !== 0 };
        if (def) r.hidden = false;
      } else {
        const dc = DECODERS[r.method]?.(r, pos => r.parents[pos]);
        if (dc) def = dc;
      }
      if (def?.k === 'text' && r.d2300 && r.d2300.length >= 18) {
        const tv = new DataView(r.d2300.buffer, r.d2300.byteOffset, r.d2300.byteLength), n = tv.getUint16(16, true);
        const runs = readRichTextRuns(r.d2300.subarray(18, 18 + n), def.refs?.length ?? 0, def.anchor !== undefined ? 2 : 1, def.font, (head, parent) => textFont(`<S${head}<VL>`, fontTable, parent), opts.legacyTool);
        if (runs?.map(run => run.text).join('') === def.text && runs.some(run => JSON.stringify(run.font) !== JSON.stringify((def as Extract<Def, { k: 'text' }>).font))) def.runs = runs;
      }
      if (!def) { unknown++; def = { k: 'unknown', note: `方法 ${r.method} / 大类 ${r.cat} / 类型 ${r.kind}` }; }
      if (def.k === 'locus') {
        const driver = sysCandidates.get(r.parents[2]);
        if (driver?.method !== 15 || driver.parents[0] !== r.parents[1]) def.path = ids(r.parents[1]);
      }
      const style = def.k === 'unknown' ? base : { ...defaultStyle(def), ...base };
      // 方法 11–14 的交点在首选分支无定义时取另一支。实测：任意正多边形工具在原版画出结果，只有另一支有定义。
      if (def.k === 'inter' && r.method >= 11 && r.method <= 14) def.alternate = true;
      const o: Obj = { id, def, style, hidden: r.hidden, trace: r.trace || undefined, label: r.label, labelShown: r.labelShown && r.label !== undefined };
      if (r.labelCustom && r.label !== undefined) o.toolLabel = true;   // 2005 偏移 4：“在自定义工具中使用标签”
      if (opts.tool) o.src = { m: r.method, c: r.cat, k: r.kind, withParams: r.p3 !== undefined };   // 工具里要靠原始类型判断“前提条件要求点选什么”
      // 2311 与 2307 同头：偏移 12、14 是位置，偏移 28 是显示精度（实测：逐工具原版保存结果）
      const head2311 = r.d2311 && r.d2311.length >= 30 ? new DataView(r.d2311.buffer, r.d2311.byteOffset, r.d2311.byteLength) : undefined;
      if (head2311 && (def.k === 'param' || def.k === 'calc')) o.decimals = head2311.getUint16(28, true);
      // 函数形式：2311 偏移 46：0 y=f(x)、1 x=f(y)、2 r=f(θ)、3 θ=f(r)（函数图像 2306 偏移 20 同值；逐工具实测）
      if (head2311 && def.k === 'func' && r.d2311!.length >= 48) { const form = FUNC_FORMS[head2311.getUint16(46, true)]; if (form && form !== 'y=f(x)') def.form = form; }
      if (def.k === 'measure' || def.k === 'param' || def.k === 'calc' || def.k === 'func' || def.k === 'table' || def.k === 'itertable') o.at = r.rect ? { x: r.rect[0], y: r.rect[1] } : def.k === 'measure' && r.rect2307 ? { x: r.rect2307[0], y: r.rect2307[1] } : head2311 ? { x: head2311.getInt16(12, true), y: head2311.getInt16(14, true) } : { x: 24, y: 24 + 24 * page.objects.filter(x => x.at).length };
      if (def.k === 'param') { o.label = def.name; o.labelShown = false; }
      if (def.k === 'func') o.label = def.name;
      if (def.k === 'button') { o.label = undefined; o.at = def.at; }
      if (def.k === 'text') { o.label = undefined; o.at = undefined; }
      if (def.k === 'image') o.label = undefined;
      page.objects.push(o);
    });
    page.nextId = raw.length + 1;
    // 多边形上的点：把“边序号 + 比例”换算成周长比例
    const needText = page.objects.filter(o => TEXT_PENDING.has(o.def));
    if (needText.length) {   // 附着文本：文件里存的是当前位置，换算成相对点的偏移
      const res = evaluatePage(page);
      for (const o of needText) {
        if (o.def.k !== 'text' || o.def.anchor === undefined) continue;
        const ap = res.get(o.def.anchor)?.shape;
        if (ap?.k === 'pt') o.def = { ...o.def, off: { x: o.def.at.x - ap.p.x, y: o.def.at.y - ap.p.y } };
        // 父点当前无定义不改变文本的构造类型；它恢复后仍能显示。
      }
    }
    const needPoly = page.objects.filter(o => POLY_PENDING.has(o.def));
    if (needPoly.length) {
      const res = evaluatePage(page);
      for (const o of needPoly) {
        if (o.def.k !== 'onpath') continue;
        const { side, u } = POLY_PENDING.get(o.def)!, shp = res.get(o.def.path)?.shape;
        if (shp?.k === 'poly' && side < shp.pts.length) {
          const pts = shp.pts, len = (i: number) => Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].y - pts[i].y);
          const total = pts.reduce((sum, _q, i) => sum + len(i), 0); let acc = 0;
          for (let i = 0; i < side; i++) acc += len(i);
          o.def = { ...o.def, t: total > 0 ? (acc + u * len(side)) / total : 0 };
        } else { unknown++; o.def = { k: 'unknown', note: '多边形上的点（多边形未求值）' }; }
      }
    }
    const tfs = (rawTransforms[pi] ?? []).filter(t => t.src >= 1 && t.src <= raw.length && t.img >= 1 && t.img <= raw.length);
    if (tfs.length) page.transforms = tfs.map(t => ({ name: t.name, src: t.src, img: t.img }));   // 对象 ID 就是 1 起的序号
    for (const o of page.objects) if (o.def.k === 'sys') { const uy = page.objects.find(x => x.id === (o.def as { unitY: Id }).unitY); if (uy) uy.hidden = !(o.def.grid === 'rect' || o.def.grid === 'tri'); }   // 方形/极坐标网格只有一个尺度，纵轴单位点不显示
    doc.pages.push(page);
  });
  if (!doc.pages.length) doc.pages.push(emptyPage());
  if (rawTools.length) doc.tools = rawTools;
  if (textTable.length === 6) {
    // 只记录和出厂样式不同的项；未修改的文件显示时用它，写回由原样保存保留。
    const styles: NonNullable<DisplayPrefs['textStyles']> = {};
    TEXT_CATS.forEach(([cat], i) => {
      const t = textTable[i], d = TEXT_DEFAULTS[cat].style; if (!t) return;
      const diff: Partial<TextStyle> = {};
      for (const key of ['name', 'size', 'bold', 'italic', 'underline'] as const) if (t[key] !== d[key]) (diff as Record<string, unknown>)[key] = t[key];
      if (Object.keys(diff).length) styles[cat] = diff;
    });
    // 没有自己样式的文本跟随文档“标题”样式（逐工具截图：文字大小等于表里的第 1 项）
    const title = textTable[1];
    if (title) for (const pg of doc.pages) for (const o of pg.objects) if (o.def.k === 'text' && DEFAULT_FONT_SPECS.has(o.def.font)) {
      const font = { ...o.def.font, name: title.name, size: title.size, bold: title.bold, italic: title.italic, underline: title.underline };
      o.def = { ...o.def, font, ...(o.def.runs ? { runs: o.def.runs.map(run => JSON.stringify(run.font) === JSON.stringify((o.def as { font: unknown }).font) ? { ...run, font } : run) } : {}) };
    }
    doc.settings.display = { ...DEFAULT_DISPLAY, ...doc.settings.display, fromFile: true, mathItalic: !!textTable[0]?.italic, ...(Object.keys(styles).length ? { textStyles: styles } : {}) };
  }
  if (precisions.length || angleUnitCode !== undefined) {
    const unit = angleUnitCode === 0 ? 'rad' : angleUnitCode === 2 ? 'dir' : 'deg';
    doc.settings.display = { ...DEFAULT_DISPLAY, ...doc.settings.display, fromFile: true, angleUnit: unit, ...(precisions[0] !== undefined ? { anglePrec: precisions[0] } : {}), ...(precisions[1] !== undefined ? { distPrec: precisions[1] } : {}), ...(precisions[2] !== undefined ? { otherPrec: precisions[2] } : {}) };
  }
  doc.current = 0;
  const source: Source = { kind: 'gsp', bytes: bytes.slice(), unmodifiedJson: sourceSnapshot(doc) };
  if (unknown) { source.protectedReason = `含有 ${unknown} 个新版暂不支持的对象`; notes.push(`文件里有 ${unknown} 个对象新版还不能处理，课件已按只读打开：可以查看和演示，不能编辑；不修改时可以原样另存。`); }
  // 900 偏移 16：保存时显示的页（0 起）；原版打开文件时停在这一页。
  const sig900 = rd.records.find(r => r.tag === 900)?.data;
  if (sig900 && sig900.length >= 18) { const cur = new DataView(sig900.buffer, sig900.byteOffset, sig900.byteLength).getUint16(16, true); if (cur < doc.pages.length) doc.current = cur; }
  return { doc, source, notes };
}


// ======================= 自定义工具 =======================
const cat = (parts: Uint8Array[]) => { const r = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { r.set(p, o); o += p.length; } return r; };
const recBytes = (tag: number, data = new Uint8Array()) => { const b = new Uint8Array(8 + data.length), v = new DataView(b.buffer); v.setUint32(0, data.length, true); v.setUint32(4, tag, true); b.set(data, 8); return b; };

/** 只扫描文件里的工具段，取名称/前提条件/注释，不解析对象（载入 44 个工具文件时用，很快）。读不完整的文件返回空。 */
export function readTools(bytes: Uint8Array): EmbeddedTool[] {
  const rd = readRecords(bytes), out: EmbeddedTool[] = [];
  if (!rd.complete) return out;
  const legacy = isLegacyContainer(rd.records);
  let cur: RecordEntry[] | undefined;
  for (const r of rd.records) {
    if (r.tag === 1002) cur = [r];
    else if (cur) { cur.push(r); if (r.tag === 1003) { out.push(makeTool(cur, legacy)); cur = undefined; } }
  }
  return out;
}

/** 解析一个工具的对象：返回只有这个工具的“页”。对象 ID 就是工具内的 1 起序号；每个对象的 `src` 记着原始方法/大类/类型。 */
export function decodeToolBody(t: EmbeddedTool): { page: Page; unknown: string[] } {
  const rd = readRecords(cat([enc.encode('GSP4'), b64ToBytes(t.data)]));
  const body = rd.records.filter(r => r.tag !== 1002 && r.tag !== 1003 && r.tag !== 1100);
  const bytes = cat([enc.encode('GSP4'), recBytes(1000, new Uint8Array(36)), ...body.map(r => r.raw), recBytes(1001), recBytes(901)]);
  const page = decodeGsp(bytes, { tool: true, legacyTool: t.legacy }).doc.pages[0];
  return { page, unknown: page.objects.flatMap(o => (o.def.k === 'unknown' ? [o.def.note] : [])) };
}

/**
 * 把工具的对象编码成可内嵌的工具（1002…1003 记录，见 docs/gsp格式.md §3h）。
 * 借用页面编码器写对象，再取出对象记录；前提条件的自由点位置写成 0（和原版的工具文件一致）。
 * 遇到没有写入依据的对象抛 Unsupported。注意：原版是否接受这样的工具段还没有互读验证。
 */
export function encodeToolBody(objects: Obj[], name: string, prereq: number[], comment?: string): EmbeddedTool {
  const page: Page = { ...emptyPage(), objects: objects.map(o => JSON.parse(JSON.stringify(o)) as Obj), nextId: objects.length + 1 };
  const bytes = encodeGsp({ ...newDoc('工具'), pages: [page] });
  const recs = readRecords(bytes).records;
  const from = recs.findIndex(r => r.tag === 1000), to = recs.findIndex(r => r.tag === 1001);
  const body = recs.slice(from + 1, to).filter(r => r.tag === 1201 || r.tag === 1203 || (r.tag >= 2000 && r.tag < 2399));
  const head = new Uint8Array(36), hv = new DataView(head.buffer);
  hv.setUint16(16, 1, true); hv.setUint16(18, 1, true); hv.setUint32(24, objects.length, true);
  const nameBytes = enc.encode(name), nb = new Uint8Array((nameBytes.length + 2) & ~1); nb.set(nameBytes);
  const q = new Uint8Array(4 + 4 * prereq.length), qv = new DataView(q.buffer);
  qv.setUint32(0, prereq.length, true); prereq.forEach((p, i) => qv.setUint32(4 + 4 * i, p, true));
  const parts = [recBytes(1002, head), recBytes(1100, nb), ...body.map(r => r.raw), recBytes(1204, q)];
  if (comment) { const cb = enc.encode(comment), c2 = new Uint8Array((cb.length + 2) & ~1); c2.set(cb); parts.push(recBytes(9007, c2)); }
  parts.push(recBytes(1003));
  const all = readRecords(cat([enc.encode('GSP4'), ...parts]));
  return makeTool(all.records);
}

// ======================= 统一入口 =======================
export function decodeFile(bytes: Uint8Array, name: string): DecodeResult {
  const head = dec.decode(bytes.subarray(0, NGSP_MAGIC.length));
  if (head === NGSP_MAGIC) {
    const doc = JSON.parse(dec.decode(bytes.subarray(NGSP_MAGIC.length))) as Doc;
    if (!Array.isArray(doc.pages)) throw new Error('不是有效的新版课件');
    return { doc, source: { kind: 'ngsp' }, notes: [] };
  }
  void name;
  return decodeGsp(bytes);
}

/** 保留来源全部记录，只改已有依据的定长字段；结构/文本/设置等其它变化返回 undefined。
 * 依据：2201 两个 f64 自由点位置、2000 头的隐藏/追踪/颜色/点型/线型字段。
 * 候选模型先限制变化范围，再由正式入口重读校验，未解码字节不参与重建。
 */
function patchSource(doc: Doc, src: Source): Uint8Array | undefined {
  if (!src.bytes || !src.unmodifiedJson) return;
  const before = JSON.parse(src.unmodifiedJson) as Doc;
  if (before.pages.length !== doc.pages.length) return;
  const patches = new Map<RecordEntry, Uint8Array>();
  let pi = -1, oi = -1, tool = false, active = false;
  let pair: { a: Obj; b: Obj } | undefined;
  const rd = readRecords(src.bytes);
  for (const r of rd.records) {
    if (r.tag === 1002) { tool = true; pair = undefined; }
    if (tool) { if (r.tag === 1003) tool = false; continue; }
    if (r.tag === 1000) { pi++; oi = -1; active = true; pair = undefined; }
    if (r.tag === 1001) { active = false; pair = undefined; }
    if (!active) continue;
    if (r.tag === 2000) {
      oi++;
      const a = before.pages[pi]?.objects[oi], b = doc.pages[pi]?.objects[oi];
      if (!a || !b || a.id !== b.id || r.data.length < 18) return;
      pair = { a, b };
      const bytes = r.raw.slice(), v = new DataView(bytes.buffer), off = 8;
      const category = v.getUint16(off + 6, true);
      if (a.hidden !== b.hidden) {
        // 单位点等特殊隐藏标志未核验，不覆盖其余位。
        if (v.getUint16(off + 2, true) > 1) return;
        v.setUint16(off + 2, b.hidden ? 1 : 0, true); a.hidden = b.hidden;
      }
      if (!!a.trace !== !!b.trace) v.setUint16(off + 4, b.trace ? 1 : 0, true);
      a.trace = b.trace;
      if (a.style.color !== b.style.color) {
        if (!/^#[0-9a-f]{6}$/i.test(b.style.color)) return;
        bytes.set(hex(b.style.color), off + 12); a.style.color = b.style.color;
      }
      if (category === 1 && a.style.pointSize !== b.style.pointSize) {
        bytes[off + 11] = b.style.pointSize; a.style.pointSize = b.style.pointSize;
      }
      if ([2, 3, 6, 9, 12].includes(category)) {
        if (a.style.width !== b.style.width) { bytes[off + 10] = (bytes[off + 10] & 0xf0) | b.style.width; a.style.width = b.style.width; }
        if (a.style.dash !== b.style.dash) { bytes[off + 10] = (bytes[off + 10] & 0x0f) | ({ solid: 2, dash: 1, dot: 0 }[b.style.dash] << 4); a.style.dash = b.style.dash; }
      }
      patches.set(r, bytes);
    } else if (r.tag === 2201 && pair && pair.a.def.k === 'free' && pair.b.def.k === 'free' && r.data.length >= 16) {
      const bytes = r.raw.slice(), v = new DataView(bytes.buffer);
      v.setFloat64(8, pair.b.def.x, true); v.setFloat64(16, pair.b.def.y, true);
      pair.a.def.x = pair.b.def.x; pair.a.def.y = pair.b.def.y;
      patches.set(r, bytes);
    } else if (r.tag === 2007) pair = undefined;
  }
  // 对象数、依赖、标签、设置、工具等任何其它变化都不能走定长补丁路径。
  if (sourceSnapshot(before) !== sourceSnapshot(doc)) return;
  return cat([src.bytes.subarray(0, 4), ...rd.records.map(r => patches.get(r) ?? r.raw)]);
}

export function encodeFile(doc: Doc, source: unknown): EncodeResult {
  const src = source as Source | undefined;
  const snapshot = sourceSnapshot(doc);
  if (src?.kind === 'gsp' && src.bytes && src.unmodifiedJson === snapshot) return { ok: true, bytes: src.bytes, source: src, ext: 'gsp', notes: [] };
  if (src?.kind === 'gsp' && src.protectedReason) return { ok: false, reason: '只读课件的内容发生变化，不能用原文件覆盖修改', unsupported: [src.protectedReason] };
  try {
    const patched = src?.kind === 'gsp' ? patchSource(doc, src) : undefined;
    const notes = new Set<string>();
    // 模型审计看不到尚未解码的记录/字段。只有源文件可被当前写入器逐字节重建，
    // 才允许以重建方式改写它；否则保留原文件，改存当前模型为 .ngsp。
    if (!patched && src?.kind === 'gsp' && src.bytes) {
      if (!src.unmodifiedJson) throw new Unsupported('来源课件缺少完整性快照，请重新打开后保存');
      const baseline = encodeGsp(JSON.parse(src.unmodifiedJson) as Doc);
      if (baseline.length !== src.bytes.length || baseline.some((v, i) => v !== src.bytes![i])) throw new Unsupported('来源课件含有尚不能确认完整保留的格式信息');
    }
    const bytes = patched ?? encodeGsp(doc, notes);
    const check = decodeGsp(bytes);
    const differences = compareContent(doc, check.doc);
    if (differences.length) {
      const fields = differences.slice(0, 8).map(d => d.path);
      const descriptions = [...new Set(fields.map(describeDifference))];
      return { ok: false, reason: `原版格式暂不能完整保存这些内容：${descriptions.join('、')}`, unsupported: fields };
    }
    return { ok: true, bytes, source: { kind: 'gsp', bytes, unmodifiedJson: snapshot }, ext: 'gsp', notes: [...notes] };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: `课件里有暂时不能写成原版格式的内容：${e.message}`, unsupported: [e.message] };
    throw e;
  }
}

/** 新版课件 .ngsp：完整保存全部内容。 */
export function encodeNgsp(doc: Doc): Uint8Array { return enc.encode(NGSP_MAGIC + JSON.stringify(doc)); }
export { parentsOf };
