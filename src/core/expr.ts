/** 参数、计算、函数共用的表达式：解析为 AST 后求值，绝不执行文本或脚本。 */
export type Unit = 'none' | 'angle' | 'distance';
/** 带单位的数值：角度以"度"存放，距离以"厘米"存放。 */
export interface Q { v: number; u: Unit }
export const q = (v: number, u: Unit = 'none'): Q => ({ v, u });

export type Expr =
  | { t: 'num'; v: number; u?: Unit; ang?: true; c?: 'pi' | 'e' }   // c：原版的常量记号 π、e（令牌 0x0d、0x0e）   // ang：导函数里度与弧度的换算系数，弧度制文档里取 1
  | { t: 'ref'; id: number }
  | { t: 'x' }
  | { t: 'neg'; a: Expr }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr }
  | { t: 'fn'; name: string; a: Expr }
  | { t: 'call'; func: number; a: Expr };

export const FUNCS = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sqrt', 'abs', 'ln', 'log', 'exp', 'sgn', 'round', 'trunc'] as const;
const FUNC_SET = new Set<string>(FUNCS);
export const CM = 96 / 2.54; // 一厘米对应的像素数

export function exprRefs(e: Expr, out: number[] = []): number[] {
  switch (e.t) {
    case 'ref': if (!out.includes(e.id)) out.push(e.id); break;
    case 'neg': case 'fn': exprRefs(e.a, out); break;
    case 'bin': exprRefs(e.a, out); exprRefs(e.b, out); break;
    case 'call': if (!out.includes(e.func)) out.push(e.func); exprRefs(e.a, out); break;
  }
  return out;
}

export interface EvalEnv {
  ref(id: number): Q | undefined;
  x?: Q;
  call?(func: number, arg: Q): Q | undefined;
}

/** 计算按文档的角度单位进行（原版样例 example-10.gsp：弧度制文档里 5·sin(0.5(x−y)+2·r(s))/√(x²+y²+1)，
 * r(s) 为 −130.29° 的度量，原版显示 0.78，正是把它当 −2.274 弧度、无单位数也按弧度时的结果）。
 * 度制（含有向度）下无单位的数按度计算（sin(0.5) = 0.01）。角度值在模型里一律存为度，进出表达式时换算。 */
let radianMode = false;
export function setRadianMode(on: boolean): boolean { const old = radianMode; radianMode = on; return old; }
export const isRadianMode = () => radianMode;
const toRad = (a: Q) => (radianMode ? a.v : (a.v * Math.PI) / 180);
const inMode = (a: Q | undefined): Q | undefined => (a && radianMode && a.u === 'angle' ? { v: (a.v * Math.PI) / 180, u: 'angle' } : a);
// 表达式按 IEEE 规则允许 ±∞（原版：ln 0 = −∞、e^(−∞) = 0、非零数除以零 = ∞，见 1119、0324）；只有 NaN（0/0、∞−∞、负数开方…）才是“未定义”。
// 几何、计数等其他用途在 engine.qOf 里仍只接受有限数。
const ok = (n: number): Q | undefined => (Number.isNaN(n) ? undefined : q(n));
/** 乘方。底数为负、指数不是整数时，指数能写成奇分母分数（如 1/5、−3/5）就取实数根，偶分母无定义。
 * 依据：分形图27.gsp 的 (−1.93)^(5^−1)、1300 的 (−0.267)^(−0.6) 在原版里都有值。 */
export function realPow(a: number, b: number): number {
  if (a >= 0 || (b | 0) === b || !Number.isFinite(b) || Number.isInteger(b)) return Math.pow(a, b);
  for (let den = 1; den <= 999; den += 2) {   // 只试奇分母
    const num = Math.round(b * den);
    if (Math.abs(b * den - num) < 1e-9 * den) return (Math.abs(num) % 2 === 1 ? -1 : 1) * Math.pow(-a, b);
  }
  return NaN;
}
const angleOut = (rad: number): Q => q(radianMode ? rad : (rad * 180) / Math.PI, 'angle');

/** 求整个表达式：结果的角度值换回度存放。 */
export function evalExpr(e: Expr, env: EvalEnv): Q | undefined {
  const r = evalIn(e, env);
  return r && radianMode && r.u === 'angle' ? { v: (r.v * 180) / Math.PI, u: 'angle' } : r;
}

function evalIn(e: Expr, env: EvalEnv): Q | undefined {
  const evalExpr = evalIn;
  switch (e.t) {
    case 'num': return e.ang && radianMode ? q(1) : inMode(q(e.v, e.u ?? 'none'));
    case 'ref': return inMode(env.ref(e.id));
    case 'x': return env.x;
    case 'neg': { const a = evalExpr(e.a, env); return a && q(-a.v, a.u); }
    case 'bin': {
      const a = evalExpr(e.a, env), b = evalExpr(e.b, env);
      if (!a || !b) return undefined;
      const u = a.u !== 'none' ? a.u : b.u;
      switch (e.op) {
        case '+': return finiteQ(a.v + b.v, u);
        case '-': return finiteQ(a.v - b.v, u);
        case '*': return finiteQ(a.v * b.v, a.u !== 'none' && b.u !== 'none' ? 'none' : u);
        case '/':   // 非零数除以零得到 ∞（原版计算和表格显示“∞”，实测 0324、0325）；0/0 仍无定义。∞ 参与后续运算时结果无定义。
          if (b.v === 0) return a.v === 0 || Number.isNaN(a.v) ? undefined : q(a.v > 0 ? Infinity : -Infinity, a.u !== 'none' && b.u !== 'none' ? 'none' : a.u);
          return finiteQ(a.v / b.v, a.u !== 'none' && b.u !== 'none' ? 'none' : a.u);
        case '^': return finiteQ(realPow(a.v, b.v), 'none');
      }
      return undefined;
    }
    case 'call': { const a = evalExpr(e.a, env); return a && inMode(env.call?.(e.func, a && radianMode && a.u === 'angle' ? { v: (a.v * 180) / Math.PI, u: 'angle' } : a)); }
    case 'fn': {
      const a = evalExpr(e.a, env);
      if (!a) return undefined;
      const r = toRad(a);
      switch (e.name) {
        case 'sin': return ok(Math.sin(r));
        case 'cos': return ok(Math.cos(r));
        case 'tan': return Math.abs(Math.cos(r)) < 1e-12 ? undefined : ok(Math.tan(r));
        case 'sec': return Math.abs(Math.cos(r)) < 1e-12 ? undefined : ok(1 / Math.cos(r));
        case 'csc': return Math.abs(Math.sin(r)) < 1e-12 ? undefined : ok(1 / Math.sin(r));
        case 'cot': return Math.abs(Math.sin(r)) < 1e-12 ? undefined : ok(Math.cos(r) / Math.sin(r));
        case 'arcsin': return Math.abs(a.v) > 1 ? undefined : angleOut(Math.asin(a.v));
        case 'arccos': return Math.abs(a.v) > 1 ? undefined : angleOut(Math.acos(a.v));
        case 'arctan': return angleOut(Math.atan(a.v));
        case 'sqrt': return a.v < 0 ? undefined : finiteQ(Math.sqrt(a.v), a.u);
        case 'abs': return q(Math.abs(a.v), a.u);
        case 'ln': return a.v < 0 ? undefined : ok(Math.log(a.v));
        case 'log': return a.v < 0 ? undefined : ok(Math.log10(a.v));
        case 'exp': return ok(Math.exp(a.v));
        case 'sgn': return q(Math.sign(a.v));
        case 'round': return q(Math.round(a.v), a.u);
        case 'trunc': return q(Math.trunc(a.v), a.u);
      }
      return undefined;
    }
  }
}
const finiteQ = (v: number, u: Unit): Q | undefined => (Number.isNaN(v) ? undefined : q(v, u));

// ---------------- 文本 <-> AST ----------------
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

export function exprToText(e: Expr, nameOf: (id: number) => string, parentPrec = 0, varName = 'x'): string {
  switch (e.t) {
    case 'num': return e.c ? (e.c === 'pi' ? 'π' : 'e') : fmtNum(e.v) + (e.u === 'angle' ? '°' : e.u === 'distance' ? ' cm' : '');
    case 'ref': return nameOf(e.id);
    case 'x': return varName;
    case 'neg': return '-' + exprToText(e.a, nameOf, 3, varName);
    case 'fn': return `${e.name}(${exprToText(e.a, nameOf, 0, varName)})`;
    case 'call': return `${nameOf(e.func)}(${exprToText(e.a, nameOf, 0, varName)})`;
    case 'bin': {
      const p = PREC[e.op];
      const s = `${exprToText(e.a, nameOf, p, varName)}${e.op === '^' ? '^' : ` ${e.op} `}${exprToText(e.b, nameOf, p + (e.op === '^' ? 0 : 1), varName)}`;
      return p < parentPrec ? `(${s})` : s;
    }
  }
}
export const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12))));

export interface ParseOpts {
  /** 把名字解析成对象 ID（参数、度量、计算）。 */
  resolve(name: string): number | undefined;
  /** 已知名字，用于贪心匹配含空格或符号的名字。 */
  names?: string[];
  /** 把函数名解析成用户函数 ID。 */
  funcs?(name: string): number | undefined;
  variable?: string;
}
export class ParseError extends Error {}

export function parseExpr(text: string, o: ParseOpts): Expr {
  const names = [...(o.names ?? [])].sort((a, b) => b.length - a.length);
  const src = text.replace(/\s+/g, ' ').trim();
  let i = 0;
  const peek = () => src[i] ?? '';
  const skip = () => { while (src[i] === ' ') i++; };
  function primary(): Expr {
    skip();
    const c = peek();
    if (c === '(') { i++; const e = sum(); skip(); if (peek() !== ')') throw new ParseError('缺少右括号'); i++; return e; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new ParseError('数字格式不对');
      i += m[0].length;
      let u: Unit | undefined;
      if (src[i] === '°') { i++; u = 'angle'; }
      else if (/^\s?cm\b/.test(src.slice(i))) { i += src.slice(i).indexOf('m') + 1; u = 'distance'; }
      return { t: 'num', v: Number(m[0]), u };
    }
    for (const n of names) if (n && src.startsWith(n, i) && !/[A-Za-z0-9_]/.test(src[i + n.length] ?? '') ) {
      const id = o.resolve(n);
      if (id !== undefined) {
        i += n.length; skip();
        if (peek() === '(' && o.funcs?.(n) !== undefined) { i++; const a = sum(); skip(); if (peek() !== ')') throw new ParseError('缺少右括号'); i++; return { t: 'call', func: id, a }; }
        return { t: 'ref', id };
      }
    }
    const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (m) {
      const w = m[0];
      i += w.length; skip();
      if (FUNC_SET.has(w.toLowerCase())) {
        if (peek() !== '(') throw new ParseError(`${w} 后需要括号`);
        i++; const a = sum(); skip(); if (peek() !== ')') throw new ParseError('缺少右括号'); i++;
        return { t: 'fn', name: w.toLowerCase(), a };
      }
      if (w === 'pi' || w === 'π') return { t: 'num', v: Math.PI, c: 'pi' };
      if (w === 'e' && peek() !== '(') return { t: 'num', v: Math.E, c: 'e' };
      if (w === (o.variable ?? 'x') && peek() !== '(') return { t: 'x' };
      const fid = o.funcs?.(w);
      if (fid !== undefined && peek() === '(') { i++; const a = sum(); skip(); if (peek() !== ')') throw new ParseError('缺少右括号'); i++; return { t: 'call', func: fid, a }; }
      const id = o.resolve(w);
      if (id !== undefined) return { t: 'ref', id };
      throw new ParseError(`不认识 ${w}`);
    }
    if (c === 'π') { i++; return { t: 'num', v: Math.PI, c: 'pi' }; }
    throw new ParseError(c ? `意外的字符 ${c}` : '表达式不完整');
  }
  function unary(): Expr {
    skip();
    if (peek() === '-') { i++; return { t: 'neg', a: powr() }; }
    if (peek() === '+') { i++; return powr(); }
    return powr();
  }
  function powr(): Expr {
    const base = primary(); skip();
    if (peek() === '^') { i++; skip(); const ex = peek() === '-' ? (i++, { t: 'neg', a: powr() } as Expr) : powr(); return { t: 'bin', op: '^', a: base, b: ex }; }
    return base;
  }
  function prod(): Expr {
    let a = unary();
    for (;;) {
      skip();
      const c = peek();
      if (c === '*' || c === '/' || c === '×' || c === '÷') { i++; a = { t: 'bin', op: c === '×' ? '*' : c === '÷' ? '/' : c, a, b: unary() }; }
      else if (c && (c === '(' || /[\p{L}0-9.π]/u.test(c))) a = { t: 'bin', op: '*', a, b: powr() }; // 隐含乘法，如 2x
      else return a;
    }
  }
  function sum(): Expr {
    let a = prod();
    for (;;) {
      skip();
      const c = peek();
      if (c === '+' || c === '-' || c === '−') { i++; a = { t: 'bin', op: c === '+' ? '+' : '-', a, b: prod() }; }
      else return a;
    }
  }
  if (!src) throw new ParseError('表达式为空');
  const e = sum(); skip();
  if (i < src.length) throw new ParseError(`多余的内容：${src.slice(i)}`);
  return e;
}

/** 表达式里用到的变量是否包含 x（决定是函数还是计算）。 */
export function usesX(e: Expr): boolean {
  switch (e.t) { case 'x': return true; case 'neg': case 'fn': return usesX(e.a); case 'bin': return usesX(e.a) || usesX(e.b); case 'call': return usesX(e.a); default: return false; }
}

/** 显示单位与精度（参数选项 → 单位）。内部始终按度、厘米存放，这里只影响显示。 */
export const display = { angleUnit: 'deg' as 'deg' | 'rad' | 'dir', anglePrec: 2, distUnit: 'cm' as 'cm' | 'in' | 'px', distPrec: 2, otherPrec: 2 };
const fixed = (v: number, digits: number) => { const t = v.toFixed(digits); return /^-0(\.0+)?$/.test(t) ? t.slice(1) : t; };
/** 无单位数值按当前精度显示。 */
export const formatPlain = (v: number) => fixed(v, display.otherPrec);
/** 数值显示：默认精度到百分位（与原版默认相同）。 */
/** 显示用的数值字符串：长度单位紧跟数字不留空格（原版 0454 的 0.60厘米、1346 的 20.00厘米）。 */
export function formatQ(v: Q, digits?: number): string {
  if (!Number.isFinite(v.v)) return v.v > 0 ? '∞' : '−∞';
  if (v.u === 'angle') {
    const d = digits ?? display.anglePrec;
    if (display.angleUnit === 'rad') return `${fixed((v.v * Math.PI) / 180, d)} 弧度`;
    if (display.angleUnit === 'dir') { const a = ((v.v % 360) + 540) % 360 - 180; return `${fixed(a === -180 ? 180 : a, d)}°`; }
    return `${fixed(v.v, d)}°`;
  }
  if (v.u === 'distance') {
    const d = digits ?? display.distPrec;
    if (display.distUnit === 'in') return `${fixed(v.v / 2.54, d)}英寸`;
    if (display.distUnit === 'px') return `${fixed(v.v * CM, d)}像素`;
    return `${fixed(v.v, d)}厘米`;
  }
  return fixed(v.v, digits ?? display.otherPrec);
}

/** 对自变量求导（定义导函数）。调用其它函数时返回 undefined。三角函数按“度”计算，所以多一个 π/180。 */
export function derive(e: Expr): Expr | undefined {
  const num = (v: number): Expr => ({ t: 'num', v }), bin = (op: '+' | '-' | '*' | '/' | '^', a: Expr, b: Expr): Expr => ({ t: 'bin', op, a, b });
  const rad: Expr = { t: 'num', v: Math.PI / 180, ang: true }, deg: Expr = { t: 'num', v: 180 / Math.PI, ang: true };
  switch (e.t) {
    case 'num': case 'ref': return num(0);
    case 'x': return num(1);
    case 'neg': { const a = derive(e.a); return a && simplify({ t: 'neg', a }); }
    case 'call': return undefined;
    case 'bin': {
      const a = derive(e.a), b = derive(e.b);
      if (!a || !b) return undefined;
      switch (e.op) {
        case '+': case '-': return simplify(bin(e.op, a, b));
        case '*': return simplify(bin('+', bin('*', a, e.b), bin('*', e.a, b)));
        case '/': return simplify(bin('/', bin('-', bin('*', a, e.b), bin('*', e.a, b)), bin('^', e.b, num(2))));
        case '^':
          if (e.b.t === 'num') return simplify(bin('*', bin('*', e.b, bin('^', e.a, num(e.b.v - 1))), a));
          return simplify(bin('*', e, bin('+', bin('*', b, { t: 'fn', name: 'ln', a: e.a }), bin('/', bin('*', e.b, a), e.a))));
      }
      return undefined;
    }
    case 'fn': {
      const a = derive(e.a); if (!a) return undefined;
      const u = e.a, fn = (name: string, x: Expr): Expr => ({ t: 'fn', name, a: x }), one = num(1);
      const out = ((): Expr | undefined => {
        switch (e.name) {
          case 'sin': return bin('*', rad, fn('cos', u));
          case 'cos': return { t: 'neg', a: bin('*', rad, fn('sin', u)) };
          case 'tan': return bin('*', rad, bin('^', fn('sec', u), num(2)));
          case 'sec': return bin('*', rad, bin('*', fn('sec', u), fn('tan', u)));
          case 'csc': return { t: 'neg', a: bin('*', rad, bin('*', fn('csc', u), fn('cot', u))) };
          case 'cot': return { t: 'neg', a: bin('*', rad, bin('^', fn('csc', u), num(2))) };
          case 'arcsin': return bin('/', deg, fn('sqrt', bin('-', one, bin('^', u, num(2)))));
          case 'arccos': return { t: 'neg', a: bin('/', deg, fn('sqrt', bin('-', one, bin('^', u, num(2))))) };
          case 'arctan': return bin('/', deg, bin('+', one, bin('^', u, num(2))));
          case 'sqrt': return bin('/', one, bin('*', num(2), fn('sqrt', u)));
          case 'abs': return fn('sgn', u);
          case 'ln': return bin('/', one, u);
          case 'log': return bin('/', one, bin('*', u, num(Math.LN10)));
          case 'exp': return fn('exp', u);
          default: return undefined;   // sgn、round、trunc 没有可用的导函数式
        }
      })();
      return out && simplify(bin('*', out, a));
    }
  }
}
function simplify(e: Expr): Expr {
  if (e.t === 'neg') { const a = simplify(e.a); return a.t === 'num' && !a.ang ? { t: 'num', v: a.v === 0 ? 0 : -a.v } : { t: 'neg', a }; }
  if (e.t !== 'bin') return e;
  const isN = (x: Expr, v: number) => x.t === 'num' && x.v === v;
  const a = simplify(e.a), b = simplify(e.b);
  if (a.t === 'num' && b.t === 'num' && !a.ang && !b.ang && e.op !== '^' && !(e.op === '/' && b.v === 0)) return { t: 'num', v: e.op === '+' ? a.v + b.v : e.op === '-' ? a.v - b.v : e.op === '*' ? a.v * b.v : a.v / b.v };
  if (e.op === '+') { if (isN(a, 0)) return b; if (isN(b, 0)) return a; }
  if (e.op === '-' && isN(b, 0)) return a;
  if (e.op === '*') { if (isN(a, 0) || isN(b, 0)) return { t: 'num', v: 0 }; if (isN(a, 1)) return b; if (isN(b, 1)) return a; }
  if (e.op === '/' && isN(b, 1)) return a;
  if (e.op === '^') { if (isN(b, 1)) return a; if (isN(b, 0)) return { t: 'num', v: 1 }; }
  return { ...e, a, b };
}
