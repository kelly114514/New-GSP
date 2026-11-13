/** 计算和函数的公式排版：分数上下叠放、乘方作上标、根号、绝对值竖线，乘号显示为“·”。
 * 原版在画板上以这种排版显示没有自定义标签的计算和函数定义（截图 example-36.gsp 的 e 的 −x²/2 次方，
 * example-10.gsp 的 5·sin(…)/√(x²+y²+1)）。尺寸比例按截图估计。 */
import type { Expr } from '../core/expr';
import { fmtNum } from '../core/expr';

export interface MathBox { w: number; asc: number; desc: number; draw(ctx: CanvasRenderingContext2D, x: number, base: number): void }
export interface MathOpts { font: string; size: number; nameOf(id: number): string; varName: string; italicVars: boolean }

const withSize = (font: string, size: number) => font.replace(/[\d.]+px/, `${size}px`);
const unitless = (font: string) => font.replace(/\bitalic\s+/g, '');

function text(ctx: CanvasRenderingContext2D, s: string, font: string, size: number, italic = false): MathBox {
  const f = italic && !/\bitalic\b/.test(font) ? `italic ${font}` : font;
  ctx.save(); ctx.font = withSize(f, size); const w = ctx.measureText(s).width; ctx.restore();
  return { w, asc: size * 0.78, desc: size * 0.22, draw(c, x, base) { c.save(); c.font = withSize(f, size); c.textBaseline = 'alphabetic'; c.fillText(s, x, base); c.restore(); } };
}

const LATIN_NAME = /([A-Za-zΑ-Ωα-ω′'″]+)/;
/** 名字：italic 时只有拉丁、希腊字母和撇号斜体，数字、汉字、符号保持正体（原版“数学标签用斜体”，0669、0454 对照）。 */
function nameText(ctx: CanvasRenderingContext2D, s: string, font: string, size: number, italic: boolean): MathBox {
  if (!italic || /\bitalic\b/.test(font)) return text(ctx, s, font, size);
  const pieces = s.split(LATIN_NAME).filter(Boolean);
  if (pieces.length === 1) return text(ctx, s, font, size, LATIN_NAME.test(s) && s.replace(LATIN_NAME, '') === '');
  return row(pieces.map(p => text(ctx, p, font, size, LATIN_NAME.test(p) && p.replace(LATIN_NAME, '') === '')));
}
/** 名字里的 [..] 是下标。 */
function name(ctx: CanvasRenderingContext2D, s: string, font: string, size: number, italic = false): MathBox {
  const parts = s.split(/(\[[^\]]*\])/).filter(Boolean);
  if (parts.length === 1 && !parts[0].startsWith('[')) return nameText(ctx, s, font, size, italic);
  return row(parts.map(p => (p.startsWith('[') ? shift(nameText(ctx, p.slice(1, -1), font, size * 0.72, italic), size * 0.3) : nameText(ctx, p, font, size, italic))));
}

function row(items: MathBox[]): MathBox {
  return {
    w: items.reduce((a, b) => a + b.w, 0), asc: Math.max(0, ...items.map(b => b.asc)), desc: Math.max(0, ...items.map(b => b.desc)),
    draw(c, x, base) { for (const b of items) { b.draw(c, x, base); x += b.w; } },
  };
}
/** 下移（dy > 0）或上移的盒子。 */
function shift(b: MathBox, dy: number): MathBox {
  return { w: b.w, asc: Math.max(0, b.asc - dy), desc: b.desc + dy, draw(c, x, base) { b.draw(c, x, base + dy); } };
}
function frac(a: MathBox, b: MathBox, size: number): MathBox {
  const axis = size * 0.3, gap = Math.max(1.5, size * 0.12), w = Math.max(a.w, b.w) + size * 0.3;
  return {
    w, asc: axis + gap + a.desc + a.asc, desc: gap + b.asc + b.desc - axis,
    draw(c, x, base) {
      const bar = base - axis;
      a.draw(c, x + (w - a.w) / 2, bar - gap - a.desc);
      b.draw(c, x + (w - b.w) / 2, bar + gap + b.asc);
      c.fillRect(x + size * 0.05, Math.round(bar) - 0.5, w - size * 0.1, Math.max(1, size / 16));
    },
  };
}
function sup(base: MathBox, exp: MathBox, size: number): MathBox {
  const raise = Math.max(base.asc * 0.55, size * 0.4) + exp.desc;
  return { w: base.w + exp.w + 1, asc: Math.max(base.asc, raise + exp.asc), desc: base.desc, draw(c, x, b) { base.draw(c, x, b); exp.draw(c, x + base.w + 1, b - raise); } };
}
function radical(inner: MathBox, size: number): MathBox {
  const pad = size * 0.12, head = size * 0.55, asc = inner.asc + pad + 1, desc = inner.desc;
  return {
    w: head + inner.w + size * 0.1, asc: asc + 1, desc,
    draw(c, x, base) {
      inner.draw(c, x + head, base);
      c.save(); c.lineWidth = Math.max(1, size / 16); c.beginPath();
      c.moveTo(x + size * 0.05, base - (inner.asc - desc) * 0.35); c.lineTo(x + head * 0.35, base - (inner.asc - desc) * 0.45);
      c.lineTo(x + head * 0.6, base + desc); c.lineTo(x + head * 0.9, base - asc); c.lineTo(x + head + inner.w + size * 0.1, base - asc);
      c.strokeStyle = c.fillStyle as string; c.stroke(); c.restore();
    },
  };
}
/** 括号或竖线随内容高度伸长。 */
function fence(inner: MathBox, open: string, close: string, size: number, font: string): MathBox {
  const h = inner.asc + inner.desc, tall = h > size * 1.15;
  if (!tall) return row([textFence(open, size, font), inner, textFence(close, size, font)]);
  const fw = size * 0.35;
  const stroke = (c: CanvasRenderingContext2D, x: number, top: number, bottom: number, ch: string, left: boolean) => {
    c.save(); c.lineWidth = Math.max(1, size / 16); c.strokeStyle = c.fillStyle as string; c.beginPath();
    if (ch === '|') { c.moveTo(x + fw / 2, top); c.lineTo(x + fw / 2, bottom); }
    else { const mid = (top + bottom) / 2, x0 = left ? x + fw * 0.8 : x + fw * 0.2, x1 = left ? x + fw * 0.25 : x + fw * 0.75; c.moveTo(x0, top); c.quadraticCurveTo(x1, mid, x0, bottom); }
    c.stroke(); c.restore();
  };
  return {
    w: inner.w + fw * 2, asc: inner.asc + 1, desc: inner.desc + 1,
    draw(c, x, base) { stroke(c, x, base - inner.asc - 1, base + inner.desc + 1, open, true); inner.draw(c, x + fw, base); stroke(c, x + fw + inner.w, base - inner.asc - 1, base + inner.desc + 1, close, false); },
  };
}
let fenceCtx: CanvasRenderingContext2D | undefined;
const textFence = (s: string, size: number, font: string): MathBox => text(fenceCtx!, s, unitless(font), size);

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

export function layoutExpr(ctx: CanvasRenderingContext2D, e: Expr, o: MathOpts, size = o.size, parent = 0): MathBox {
  fenceCtx = ctx;
  const plain = unitless(o.font);
  const L = (x: Expr, p = 0, s = size) => layoutExpr(ctx, x, o, s, p);
  switch (e.t) {
    case 'num': {
      if (e.c) return text(ctx, e.c === 'pi' ? 'π' : 'e', o.font, size, o.italicVars && e.c === 'e');
      const s = (e.v < 0 ? '−' : '') + fmtNum(Math.abs(e.v)) + (e.u === 'angle' ? '°' : e.u === 'distance' ? '厘米' : '');
      return text(ctx, s, plain, size);
    }
    case 'ref': return name(ctx, o.nameOf(e.id), o.font, size, o.italicVars);
    case 'x': return text(ctx, o.varName, o.font, size, o.italicVars);
    case 'neg': {
      const inner = L(e.a, 3);
      const wrap = e.a.t === 'bin' && PREC[e.a.op] <= 1;
      return row([text(ctx, '−', plain, size), wrap ? fence(inner, '(', ')', size, plain) : inner]);
    }
    case 'fn': {
      if (e.name === 'sqrt') return radical(L(e.a), size);
      if (e.name === 'abs') return fence(L(e.a), '|', '|', size, plain);
      return row([text(ctx, e.name, plain, size), fence(L(e.a), '(', ')', size, plain)]);
    }
    case 'call': return row([name(ctx, o.nameOf(e.func), o.font, size, o.italicVars), fence(L(e.a), '(', ')', size, plain)]);
    case 'bin': {
      const p = PREC[e.op];
      let box: MathBox;
      if (e.op === '/') box = frac(L(e.a), L(e.b), size);
      else if (e.op === '^') {
        // 底数是加减乘或乘方时 L(e.a, 5) 已经加了括号，这里不再重复（0669 原版是 (x_F − x_C′)²，不是 ((x_F − x_C′))²）；分数、负号、负数仍要补括号。
        const baseWrap = (e.a.t === 'bin' && e.a.op === '/') || e.a.t === 'neg' || (e.a.t === 'num' && e.a.v < 0);
        const b = L(e.a, 5);
        box = sup(baseWrap ? fence(b, '(', ')', size, plain) : b, L(e.b, 0, size * 0.72), size);
      } else {
        const sym = e.op === '*' ? '·' : e.op === '-' ? ' − ' : ' + ';
        box = row([L(e.a, p), text(ctx, sym, plain, size), L(e.b, p + 1)]);
      }
      return p < parent && e.op !== '/' ? fence(box, '(', ')', size, plain) : box;
    }
  }
}

/** 排一行：[前缀文字][公式][后缀文字]，返回宽度。base 是基线。 */
export function drawMathLine(ctx: CanvasRenderingContext2D, parts: (string | MathBox)[], font: string, size: number, x: number, top: number): { w: number; h: number } {
  const boxes = parts.map(p => (typeof p === 'string' ? name(ctx, p, font, size) : p));
  const r = row(boxes), base = top + r.asc;
  r.draw(ctx, x, base);
  return { w: r.w, h: r.asc + r.desc };
}

// ---------- 富文本结构树（文本对象里的分数、上下标、根号） ----------
import type { RichNode } from '../gsp/richtext';
import type { FontSpec } from '../core/model';
/** 原版课件常用的 GB2312 字体名在新系统里没有同名字体：回退到同款的 Windows 字体（楷体→KaiTi、仿宋→FangSong、黑体→SimHei）。 */
const FONT_ALIAS: Record<string, string[]> = { '楷体_GB2312': ['KaiTi', '楷体'], '楷体': ['KaiTi'], '仿宋_GB2312': ['FangSong', '仿宋'], '仿宋': ['FangSong'], '黑体': ['SimHei'], '宋体': ['SimSun'], '隶书': ['LiSu'], '幼圆': ['YouYuan'] };
export const fontStack = (name: string) => [name, ...(FONT_ALIAS[name] ?? []), 'SimSun', 'Microsoft YaHei'].map(n => `'${n}'`).join(',') + ',sans-serif';
const css = (f: FontSpec, size: number) => `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${size}px ${fontStack(f.name)}`;
function colored(b: MathBox, color: string): MathBox { return { ...b, draw(c, x, base) { c.save(); c.fillStyle = color; c.strokeStyle = color; b.draw(c, x, base); c.restore(); } }; }
const firstFont = (n: RichNode): FontSpec | undefined => n.t === 'run' || n.t === 'ref' || n.t === 'paren' ? n.font : n.t === 'row' || n.t === 'col' ? n.items.map(firstFont).find(Boolean) : n.t === 'frac' ? firstFont(n.num) : n.t === 'root' ? firstFont(n.body) : firstFont(n.base);

/** 排出结构树；scale 是相对字号（上下标缩小）。refText 给出插入对象的显示文字。 */
export function layoutRich(ctx: CanvasRenderingContext2D, n: RichNode, refText: (index: number, mode?: 'A' | 'D') => string, fallback: FontSpec, scale = 1): MathBox {
  fenceCtx = ctx;
  const L = (x: RichNode, s = scale) => layoutRich(ctx, x, refText, fallback, s);
  const f = firstFont(n) ?? fallback, size = f.size * scale;
  switch (n.t) {
    case 'run': return colored(name(ctx, n.text, css(n.font, n.font.size * scale), n.font.size * scale), n.font.color);
    case 'ref': return colored(name(ctx, refText(n.index, n.mode), css(n.font, n.font.size * scale), n.font.size * scale), n.font.color);
    case 'row': return row(n.items.map(x => L(x)));
    case 'col': {
      const lines = n.items.map(x => L(x)), gap = size * 0.3;
      if (!lines.length) return row([]);
      const total = lines.reduce((a, b, i) => a + b.asc + b.desc + (i ? gap : 0), 0);
      return {
        w: Math.max(...lines.map(b => b.w)), asc: lines[0].asc, desc: total - lines[0].asc,
        draw(c, x, base) { let y = base - lines[0].asc; for (const b of lines) { b.draw(c, x, y + b.asc); y += b.asc + b.desc + gap; } },
      };
    }
    case 'frac': return colored(frac(L(n.num), L(n.den), size), f.color);
    case 'sup': return sup(L(n.base), L(n.exp, scale * 0.72), size);
    case 'sub': return row([L(n.base), shift(L(n.sub, scale * 0.72), size * 0.28)]);
    case 'root': return colored(radical(L(n.body), size), f.color);
    case 'paren': return colored(fence(L(n.body), '(', ')', size, css(n.font, size)), n.font.color);
  }
}
