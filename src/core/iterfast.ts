/** 单映射迭代的数值快路径：把迭代体里“计算 / 横纵坐标度量 / 按坐标画点”编译成对数组的直接运算。
 *
 * 目的只有性能（Mira 分形这类每个轨迹样本迭代近万层的课件）。要求结果与通用求值器逐位相同：
 * - 算术的运算顺序、舍入与 expr.ts / engine.ts 完全一致，只是不再为每个中间值分配 Q 和 Result；
 * - 只覆盖最常见、语义简单的情形（无单位的数、角度制文档、没有位置覆盖）；任何超出范围的对象、单位、
 *   无定义、非有限值，都直接放弃快路径，由调用方的通用求值器从当前层继续，所以不会改变边界行为。
 * 本文件不依赖 engine.ts 的运行时（只引入类型），避免循环引用。 */
import type { Result } from './engine';
import { byId, parentsOf, type Def, type Id, type Page } from './model';
import { CM, isRadianMode, realPow, type Expr } from './expr';
import { EPS } from './geom';
import * as G from './geom';

type Kind = 'pt' | 'num' | 'sys' | 'func' | 'line' | 'circle';
type Ev = (v: Float64Array, x: number) => number;   // 失败（无定义）返回 NaN
type Op = (v: Float64Array) => boolean;

type FastUnit = 'none' | 'angle';
interface Ext { id: Id; kind: Kind; slot: number; unit?: FastUnit }
export interface FastProgram {
  /** 编译时看到的各对象定义；任何一个被替换就重新编译。 */
  defs: [Id, Def][];
  ext: Ext[];
  /** 迭代体里需要检查状态的外部父对象（只要求有定义）。 */
  statusIds: Id[];
  size: number;
  ops: Op[];
  /** 第 i 个前像的类型与槽位，以及映射输出 i 的槽位。 */
  pre: { kind: 'pt' | 'num'; slot: number; out: number }[];
  /** 迭代体里用到的坐标系槽位：origin.x origin.y ux.x ux.y uy.x uy.y det。 */
  sysSlots: Map<Id, number>;
  /** 编译时文档是否为弧度制：三角函数的角度换算不同，换了就要重编。 */
  radian: boolean;
  /** 多映射迭代按映射分别编译；运行时复用各映射的数组工作区。 */
  multi?: FastProgram[];
}

class Bail extends Error {}
const fail = (): never => { throw new Bail(); };

/** enabled：测试用开关，关掉后一律走通用求值器；used：快路径实际推进过层数的次数。 */
export const iterFast = { enabled: true, used: 0 };

// 与 expr.ts 一致：±∞ 可以参与运算（ln 0 = −∞、1/0 = ∞），只有 NaN 表示无定义；画点、度量等需要有限数的地方再检查。
const finite = (n: number) => (n === n ? n : NaN);

type Leaf = { k: 's'; n: number } | { k: 'c'; n: number };
/** 槽位引用或普通常数（不含角度换算系数）可以直接读取，不必生成闭包。 */
function leafOf(e: Expr, slotOf: (id: Id) => number): Leaf | undefined {
  if (e.t === 'ref') return { k: 's', n: slotOf(e.id) };
  if (e.t === 'num' && !e.ang && (e.u ?? 'none') === 'none' && Number.isFinite(e.v)) return { k: 'c', n: e.v };
  return undefined;
}

/** 表达式 → 数值闭包。语义逐项对照 expr.ts 的 evalIn（无单位、角度制）。 */
function compileExpr(e: Expr, slotOf: (id: Id) => number, funcOf: (id: Id) => Ev, allowX: boolean, radian: boolean, unitOf?: (id: Id) => FastUnit): Ev {
  const sub = (node: Expr) => compileExpr(node, slotOf, funcOf, allowX, radian, unitOf);
  // 角度槽存度，进表达式时按文档角度制换算。弧度制下带角度的引用不能走直接取槽优化。
  const leaf = (node: Expr) => node.t === 'ref' && radian && unitOf?.(node.id) === 'angle' ? undefined : leafOf(node, slotOf);
  switch (e.t) {
    case 'num': {
      if (e.ang && radian) return () => 1;   // 导函数里度与弧度的换算系数，弧度制取 1
      if ((e.u ?? 'none') !== 'none' && !(unitOf && e.u === 'angle') || !Number.isFinite(e.v)) return fail();
      const c = radian && e.u === 'angle' ? (e.v * Math.PI) / 180 : e.v;
      return () => c;
    }
    case 'ref': { const s = slotOf(e.id); return radian && unitOf?.(e.id) === 'angle' ? v => (v[s] * Math.PI) / 180 : v => v[s]; }
    case 'x': return allowX ? (_v, x) => x : fail();
    case 'neg': { const a = sub(e.a); return (v, x) => { const r = a(v, x); return r !== r ? NaN : -r; }; }
    case 'bin': {
      // 加减乘的 NaN 沿 IEEE 运算自然传播（含 ∞−∞、0·∞），与 expr.ts 逐位一致，不必再逐个检查；
      // 操作数是槽位或常数时直接读取，少一层闭包调用（迭代体里绝大部分算式是这种形状）。
      if (e.op === '^') {
        const a = sub(e.a), b = sub(e.b);
        return (v, x) => { const p = a(v, x), r = b(v, x); if (p !== p || r !== r) return NaN; const y = p >= 0 || (r | 0) === r ? Math.pow(p, r) : realPow(p, r); return y === y ? y : NaN; };
      }
      const op = e.op;
      const ka = leaf(e.a), kb = leaf(e.b);
      const a = ka ? undefined : sub(e.a), b = kb ? undefined : sub(e.b);
      const pa = ka ? ka.k : 'e', pb = kb ? kb.k : 'e';
      const sa = ka?.k === 's' ? ka.n : 0, sb = kb?.k === 's' ? kb.n : 0, ca = ka?.k === 'c' ? ka.n : 0, cb = kb?.k === 'c' ? kb.n : 0;
      const A = a as Ev, B = b as Ev;
      const div = (p: number, r: number) => (r === 0 ? (p > 0 ? Infinity : p < 0 ? -Infinity : NaN) : p / r);
      switch (op + pa + pb) {
        case '+ss': return v => v[sa] + v[sb];   case '+sc': return v => v[sa] + cb;   case '+cs': return v => ca + v[sb];
        case '+se': return (v, x) => v[sa] + B(v, x);  case '+es': return (v, x) => A(v, x) + v[sb];
        case '+ce': return (v, x) => ca + B(v, x);     case '+ec': return (v, x) => A(v, x) + cb;   case '+ee': return (v, x) => A(v, x) + B(v, x);
        case '-ss': return v => v[sa] - v[sb];   case '-sc': return v => v[sa] - cb;   case '-cs': return v => ca - v[sb];
        case '-se': return (v, x) => v[sa] - B(v, x);  case '-es': return (v, x) => A(v, x) - v[sb];
        case '-ce': return (v, x) => ca - B(v, x);     case '-ec': return (v, x) => A(v, x) - cb;   case '-ee': return (v, x) => A(v, x) - B(v, x);
        case '*ss': return v => v[sa] * v[sb];   case '*sc': return v => v[sa] * cb;   case '*cs': return v => ca * v[sb];
        case '*se': return (v, x) => v[sa] * B(v, x);  case '*es': return (v, x) => A(v, x) * v[sb];
        case '*ce': return (v, x) => ca * B(v, x);     case '*ec': return (v, x) => A(v, x) * cb;   case '*ee': return (v, x) => A(v, x) * B(v, x);
        case '/ss': return v => div(v[sa], v[sb]);   case '/sc': return v => div(v[sa], cb);   case '/cs': return v => div(ca, v[sb]);
        case '/se': return (v, x) => div(v[sa], B(v, x));  case '/es': return (v, x) => div(A(v, x), v[sb]);
        case '/ce': return (v, x) => div(ca, B(v, x));     case '/ec': return (v, x) => div(A(v, x), cb);   case '/ee': return (v, x) => div(A(v, x), B(v, x));
      }
      return fail();
    }
    case 'call': {
      const a = sub(e.a), f = funcOf(e.func);
      return (v, x) => { const arg = a(v, x); if (arg !== arg) return NaN; const r = f(v, arg); return r - r === 0 ? r : NaN; };   // 与 engine.callFunc 一致：函数值是 ±∞ 视为无定义
    }
    case 'fn': {
      const la = leaf(e.a), sl = la?.k === 's' ? la.n : -1;
      const a = sl >= 0 ? (undefined as unknown as Ev) : sub(e.a);
      const D = Math.PI;
      // 最常见的几个函数直接写成单个闭包（NaN 沿 Math.* 自然传播，∞ 的结果与 finite() 版本一致：sin/cos(∞) 本身就是 NaN）。
      switch (e.name) {
        case 'sin': return radian ? (sl >= 0 ? v => Math.sin(v[sl]) : (v, x) => Math.sin(a(v, x))) : (sl >= 0 ? v => Math.sin((v[sl] * D) / 180) : (v, x) => Math.sin((a(v, x) * D) / 180));
        case 'cos': return radian ? (sl >= 0 ? v => Math.cos(v[sl]) : (v, x) => Math.cos(a(v, x))) : (sl >= 0 ? v => Math.cos((v[sl] * D) / 180) : (v, x) => Math.cos((a(v, x) * D) / 180));
        case 'sqrt': return sl >= 0 ? v => { const n = v[sl]; return n < 0 ? NaN : Math.sqrt(n); } : (v, x) => { const n = a(v, x); return n < 0 ? NaN : Math.sqrt(n); };
        case 'abs': return sl >= 0 ? v => Math.abs(v[sl]) : (v, x) => Math.abs(a(v, x));
        case 'sgn': return sl >= 0 ? v => Math.sign(v[sl]) : (v, x) => Math.sign(a(v, x));
        case 'trunc': return sl >= 0 ? v => Math.trunc(v[sl]) : (v, x) => Math.trunc(a(v, x));
      }
      const arg: Ev = sl >= 0 ? v => v[sl] : a;
      const rad = radian ? (n: number) => n : (n: number) => (n * Math.PI) / 180;
      const wrap = (g: (n: number) => number): Ev => (v, x) => { const n = arg(v, x); return n !== n ? NaN : g(n); };
      switch (e.name) {
        case 'sin': return wrap(n => finite(Math.sin(rad(n))));
        case 'cos': return wrap(n => finite(Math.cos(rad(n))));
        case 'tan': return wrap(n => { const r = rad(n); return Math.abs(Math.cos(r)) < 1e-12 ? NaN : finite(Math.tan(r)); });
        case 'sec': return wrap(n => { const r = rad(n); return Math.abs(Math.cos(r)) < 1e-12 ? NaN : finite(1 / Math.cos(r)); });
        case 'csc': return wrap(n => { const r = rad(n); return Math.abs(Math.sin(r)) < 1e-12 ? NaN : finite(1 / Math.sin(r)); });
        case 'cot': return wrap(n => { const r = rad(n); return Math.abs(Math.sin(r)) < 1e-12 ? NaN : finite(Math.cos(r) / Math.sin(r)); });
        case 'sqrt': return wrap(n => (n < 0 ? NaN : finite(Math.sqrt(n))));
        case 'abs': return wrap(n => Math.abs(n));
        case 'ln': return wrap(n => (n < 0 ? NaN : Math.log(n)));
        case 'log': return wrap(n => (n < 0 ? NaN : Math.log10(n)));
        case 'exp': return wrap(n => finite(Math.exp(n)));
        case 'sgn': return wrap(n => Math.sign(n));
        case 'round': return wrap(n => Math.round(n));
        case 'trunc': return wrap(n => Math.trunc(n));
        case 'arcsin': case 'arccos': case 'arctan': {
          if (!unitOf) return fail();
          const f = e.name === 'arcsin' ? Math.asin : e.name === 'arccos' ? Math.acos : Math.atan;
          return wrap(n => radian ? f(n) : (f(n) * 180) / Math.PI);
        }
        default: return fail();
      }
    }
  }
}

/** 为单映射迭代编译快路径；不适用时返回 undefined。 */
export function compileIterBody(iter: Extract<Def, { k: 'iterate' }>, page: Page): FastProgram | undefined {
  try { return compile(iter, page); } catch (e) { if (e instanceof Bail) return undefined; throw e; }
}

function compile(iter: Extract<Def, { k: 'iterate' }>, page: Page): FastProgram {
  if (iter.maps.length > 1) {
    const programs = iter.maps.map(map => compile({ ...iter, maps: [map] }, page));
    return { defs: programs.flatMap(p => p.defs), ext: [], statusIds: [], size: 0, ops: [], pre: [], sysSlots: new Map(), radian: isRadianMode(), multi: programs };
  }
  const map = iter.maps[0];
  if (iter.random || !map || iter.pre.length !== map.length || new Set(iter.pre).size !== iter.pre.length) return fail();
  const bodySet = new Set(iter.body), preIndex = new Map(iter.pre.map((id, i) => [id, i]));
  const defs: [Id, Def][] = [], ext: Ext[] = [], statusIds: Id[] = [];
  const sysSlots = new Map<Id, number>();
  const radian = isRadianMode();
  let size = 0;
  const alloc = (n: number) => { const s = size; size += n; return s; };

  // 前像槽位与类型由映射输出的类型决定。
  const outKind = (id: Id): 'pt' | 'num' => {
    if (preIndex.has(id) || !bodySet.has(id)) return fail();
    const d = byId(page, id)?.def;
    if (d?.k === 'plotxy' || d?.k === 'plotfix' || d?.k === 'mid' || d?.k === 'inter' || d?.k === 'translate' || d?.k === 'rotate' || d?.k === 'dilate' || d?.k === 'reflect') return 'pt';
    if (d?.k === 'calc' || (d?.k === 'measure' && (d.m === 'abscissa' || d.m === 'ordinate'))) return 'num';
    return fail();
  };
  const pre = iter.pre.map((_, i) => { const kind = outKind(map[i]); return { kind, slot: alloc(kind === 'pt' ? 2 : 1), out: -1 }; });

  const entity = new Map<Id, { kind: Kind; slot: number; unit?: FastUnit }>();
  const compiled = new Set<Id>(), active = new Set<Id>();
  const ops: Op[] = [];
  const needStatus = (id: Id) => { if (!preIndex.has(id) && !bodySet.has(id) && !statusIds.includes(id)) statusIds.push(id); };
  const shapeKind = (id: Id, seen = new Set<Id>()): Kind | undefined => {
    if (preIndex.has(id)) return 'pt';
    if (seen.has(id)) return undefined;
    seen.add(id);
    const d = byId(page, id)?.def;
    if (!d) return undefined;
    switch (d.k) {
      case 'free': case 'onpath': case 'mid': case 'inter': case 'plotfix': case 'plotxy': case 'axispt': return 'pt';
      case 'seg': case 'ray': case 'line': case 'perp': case 'parallel': case 'bisect': return 'line';
      case 'circle': case 'circle-seg': return 'circle';
      case 'rotate': case 'translate': case 'dilate': case 'reflect': return shapeKind(d.src, seen);
      case 'sys': return 'sys';
      case 'param': case 'calc': case 'measure': return 'num';
      case 'func': return 'func';
      default: return undefined;
    }
  };

  /** 取（必要时编译）id 的槽位，并核对类型。 */
  const slotOf = (id: Id, kind: Kind, unit?: FastUnit): number => {
    const pi = preIndex.get(id);
    if (pi !== undefined) { if (pre[pi].kind !== kind || unit === 'angle') fail(); return pre[pi].slot; }
    if (bodySet.has(id)) {
      if (!compiled.has(id)) compileObject(id);
      const e = entity.get(id)!;
      if (e.kind !== kind || (unit !== undefined && (e.unit ?? 'none') !== unit)) fail();
      return e.slot;
    }
    const known = entity.get(id);
    if (known) {
      if (known.kind !== kind) fail();
      const external = ext.find(x => x.id === id)!;
      if (unit !== undefined) {
        if (external.unit !== undefined && external.unit !== unit) fail();
        external.unit = unit;
      }
      return known.slot;
    }
    const slot = alloc(kind === 'pt' ? 2 : kind === 'sys' ? 7 : kind === 'line' ? 5 : kind === 'circle' ? 3 : 1);
    entity.set(id, { kind, slot });
    ext.push({ id, kind, slot, unit });
    if (kind === 'sys') sysSlots.set(id, slot);
    return slot;
  };
  const numRef = (id: Id) => slotOf(id, 'num', 'none');
  const unitOf = (id: Id): FastUnit => {
    if (preIndex.has(id)) return 'none';
    if (bodySet.has(id)) {
      if (!compiled.has(id)) compileObject(id);
      return entity.get(id)?.unit ?? 'none';
    }
    const d = byId(page, id)?.def;
    return ((d?.k === 'param' || d?.k === 'calc') && d.unit === 'angle') || (d?.k === 'measure' && d.m === 'coordangle') ? 'angle' : 'none';
  };
  const exprUnit = (e: Expr): FastUnit => {
    switch (e.t) {
      case 'num': return e.ang && radian ? 'none' : e.u === 'distance' ? fail() : e.u ?? 'none';
      case 'ref': return unitOf(e.id);
      case 'x': return 'none';
      case 'neg': return exprUnit(e.a);
      case 'bin': {
        const a = exprUnit(e.a), b = exprUnit(e.b);
        if (e.op === '^' || ((e.op === '*' || e.op === '/') && a !== 'none' && b !== 'none')) return 'none';
        return a === 'none' ? b : a;
      }
      case 'call': return exprUnit(e.a) === 'none' ? 'none' : fail();
      case 'fn': {
        const a = exprUnit(e.a);
        if (e.name === 'arcsin' || e.name === 'arccos' || e.name === 'arctan') return 'angle';
        return ['sqrt', 'abs', 'sgn', 'round', 'trunc'].includes(e.name) ? a : 'none';
      }
    }
  };

  // 用户函数：只支持 y=f(x) 的普通函数，不跨越递归。
  const funcCache = new Map<Id, Ev>(), funcStack = new Set<Id>();
  const funcOf = (id: Id): Ev => {
    const cached = funcCache.get(id); if (cached) return cached;
    const f = byId(page, id);
    if (f?.def.k !== 'func' || f.def.derivativeOf !== undefined || funcStack.has(id)) return fail();
    defs.push([id, f.def]);
    funcStack.add(id);
    const ev = compileExpr(f.def.expr, numRef, funcOf, true, radian);
    funcStack.delete(id);
    funcCache.set(id, ev);
    return ev;
  };

  function compileObject(id: Id) {
    if (active.has(id)) return fail();   // 循环依赖：通用求值器会给出无定义
    const ob = byId(page, id); if (!ob) return fail();
    active.add(id);
    const d = ob.def;
    defs.push([id, d]);
    for (const p of parentsOf(d)) needStatus(p);
    if (d.k === 'calc') {
      if (d.unit !== 'none' && d.unit !== 'angle') return fail();
      const rawUnit = exprUnit(d.expr), unit = rawUnit === 'angle' ? 'angle' : d.unit;
      const ev = compileExpr(d.expr, id => slotOf(id, 'num', unitOf(id)), funcOf, false, radian, unitOf);
      const slot = alloc(1);
      entity.set(id, { kind: 'num', slot, unit });
      ops.push(v => { const r = ev(v, 0); if (r !== r) return false; v[slot] = radian && rawUnit === 'angle' ? (r * 180) / Math.PI : r; return true; });
    } else if (d.k === 'measure' && (d.m === 'abscissa' || d.m === 'ordinate') && d.refs.length === 2) {
      const p = slotOf(d.refs[0], 'pt'), s = slotOf(d.refs[1], 'sys'), slot = alloc(1), isX = d.m === 'abscissa';
      entity.set(id, { kind: 'num', slot });
      ops.push(v => {
        // 与 toSys 同样的运算：d = p - origin；x = cross(d, uy) / det；y = cross(ux, d) / det
        const dx = v[p] - v[s], dy = v[p + 1] - v[s + 1];
        const det = v[s + 6];
        const r = isX ? (dx * v[s + 5] - dy * v[s + 4]) / det : (v[s + 2] * dy - v[s + 3] * dx) / det;
        if (!Number.isFinite(r)) return false;
        v[slot] = r; return true;
      });
    } else if (d.k === 'measure' && (d.m === 'coordradius' || d.m === 'coordangle') && d.refs.length === 2) {
      const p = slotOf(d.refs[0], 'pt'), s = slotOf(d.refs[1], 'sys'), slot = alloc(1);
      const angle = d.m === 'coordangle';
      entity.set(id, { kind: 'num', slot, unit: angle ? 'angle' : 'none' });
      ops.push(v => {
        const dx = v[p] - v[s], dy = v[p + 1] - v[s + 1], det = v[s + 6];
        const x = (dx * v[s + 5] - dy * v[s + 4]) / det, y = (v[s + 2] * dy - v[s + 3] * dx) / det;
        const r = Math.hypot(x, y);
        if (!Number.isFinite(r)) return false;
        v[slot] = angle ? (r < EPS ? 0 : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360) : r;
        return true;
      });
    } else if (d.k === 'seg' || d.k === 'ray' || d.k === 'line') {
      const a = slotOf(d.a, 'pt'), b = slotOf(d.b, 'pt'), slot = alloc(5), extent = d.k === 'seg' ? 0 : d.k === 'ray' ? 1 : 2;
      entity.set(id, { kind: 'line', slot });
      ops.push(v => { v[slot] = v[a]; v[slot + 1] = v[a + 1]; v[slot + 2] = v[b]; v[slot + 3] = v[b + 1]; v[slot + 4] = extent; return Math.hypot(v[slot + 2] - v[slot], v[slot + 3] - v[slot + 1]) >= EPS; });
    } else if (d.k === 'perp' || d.k === 'parallel') {
      const p = slotOf(d.pt, 'pt'), l = slotOf(d.line, 'line'), slot = alloc(5), isPerp = d.k === 'perp';
      entity.set(id, { kind: 'line', slot });
      ops.push(v => {
        const dx = v[l + 2] - v[l], dy = v[l + 3] - v[l + 1];
        if (Math.hypot(dx, dy) < EPS) return false;
        v[slot] = v[p]; v[slot + 1] = v[p + 1]; v[slot + 2] = v[p] + (isPerp ? -dy : dx); v[slot + 3] = v[p + 1] + (isPerp ? dx : dy); v[slot + 4] = 2;
        return true;
      });
    } else if (d.k === 'circle') {
      const c = slotOf(d.c, 'pt'), p = slotOf(d.p, 'pt'), slot = alloc(3);
      entity.set(id, { kind: 'circle', slot });
      ops.push(v => { const dx = v[p] - v[c], dy = v[p + 1] - v[c + 1]; v[slot] = v[c]; v[slot + 1] = v[c + 1]; v[slot + 2] = Math.hypot(dx, dy); return Number.isFinite(v[slot + 2]); });
    } else if (d.k === 'inter') {
      const ka = shapeKind(d.a), kb = shapeKind(d.b);
      const circleA = ka === 'circle', circleB = kb === 'circle';
      if ((!circleA && ka !== 'line') || (!circleB && kb !== 'line')) return fail();
      // 坐标轴和派生线有额外的分支方向规则，留给通用求值器。
      if (circleA !== circleB) return fail();
      const a = slotOf(d.a, circleA ? 'circle' : 'line'), b = slotOf(d.b, circleB ? 'circle' : 'line');
      const slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => {
        const point = (i: number) => ({ x: v[i], y: v[i + 1] });
        const straight = (i: number): G.Straight => ({ a: point(i), b: point(i + 2), ext: v[i + 4] === 0 ? 'segment' : v[i + 4] === 1 ? 'ray' : 'line' });
        let hit: G.Pt | undefined;
        if (circleA) {
          const points = G.intersectCircles({ c: point(a), r: v[a + 2] }, { c: point(b), r: v[b + 2] });
          hit = points[d.branch] ?? (d.alternate ? points[1 - d.branch] : undefined);
        } else if (d.branch === 0 || (d.alternate && d.branch === 1)) {
          hit = G.intersectStraights(straight(a), straight(b));
        }
        if (!hit || !G.finite(hit)) return false;
        v[slot] = hit.x; v[slot + 1] = hit.y; return true;
      });
    } else if (d.k === 'mid') {
      const s = slotOf(d.seg, 'line'), slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => { v[slot] = (v[s] + v[s + 2]) / 2; v[slot + 1] = (v[s + 1] + v[s + 3]) / 2; return Number.isFinite(v[slot]) && Number.isFinite(v[slot + 1]); });
    } else if (d.k === 'translate' && d.by.mode === 'vector') {
      const src = slotOf(d.src, 'pt'), a = slotOf(d.by.from, 'pt'), b = slotOf(d.by.to, 'pt'), slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => { v[slot] = v[src] + (v[b] - v[a]); v[slot + 1] = v[src + 1] + (v[b + 1] - v[a + 1]); return Number.isFinite(v[slot]) && Number.isFinite(v[slot + 1]); });
    } else if (d.k === 'translate' && d.by.mode === 'rect' && d.by.dxBy === undefined && d.by.dyBy === undefined) {
      const src = slotOf(d.src, 'pt'), slot = alloc(2), dx = d.by.dx, dy = d.by.dy;
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => { v[slot] = v[src] + dx * CM; v[slot + 1] = v[src + 1] - dy * CM; return Number.isFinite(v[slot]) && Number.isFinite(v[slot + 1]); });
    } else if (d.k === 'rotate' && d.angle.mode !== 'mark') {
      const kind = shapeKind(d.src); if (kind !== 'pt' && kind !== 'line' && kind !== 'circle') return fail();
      const src = slotOf(d.src, kind), c = slotOf(d.center, 'pt'), a = d.angle.mode === 'marked' ? slotOf(d.angle.a, 'pt') : -1,
        vertex = d.angle.mode === 'marked' ? slotOf(d.angle.v, 'pt') : -1, b = d.angle.mode === 'marked' ? slotOf(d.angle.b, 'pt') : -1,
        deg = d.angle.mode === 'fixed' ? d.angle.deg : 0, value = d.angle.mode === 'value' ? slotOf(d.angle.m, 'num') : -1,
        slot = alloc(kind === 'pt' ? 2 : kind === 'line' ? 5 : 3);
      entity.set(id, { kind, slot });
      ops.push(v => {
        let rad = (value >= 0 ? v[value] : deg) * Math.PI / 180;
        if (a >= 0) {
          const ax = v[a] - v[vertex], ay = v[a + 1] - v[vertex + 1], bx = v[b] - v[vertex], by = v[b + 1] - v[vertex + 1];
          if (Math.hypot(ax, ay) < EPS || Math.hypot(bx, by) < EPS) return false;
          const a0 = G.angleOf({ x: v[vertex], y: v[vertex + 1] }, { x: v[a], y: v[a + 1] });
          const a1 = G.angleOf({ x: v[vertex], y: v[vertex + 1] }, { x: v[b], y: v[b + 1] });
          rad = (G.sweep(a0, a1) * 180 / Math.PI) * Math.PI / 180;
        }
        const cs = Math.cos(rad), sn = Math.sin(rad), turn = (x: number, y: number) => {
          const dx = x - v[c], dy = y - v[c + 1]; return { x: v[c] + dx * cs + dy * sn, y: v[c + 1] - dx * sn + dy * cs };
        };
        if (kind === 'pt') { const q = turn(v[src], v[src + 1]); v[slot] = q.x; v[slot + 1] = q.y; return Number.isFinite(q.x) && Number.isFinite(q.y); }
        if (kind === 'line') { const p = turn(v[src], v[src + 1]), q = turn(v[src + 2], v[src + 3]); v[slot] = p.x; v[slot + 1] = p.y; v[slot + 2] = q.x; v[slot + 3] = q.y; v[slot + 4] = v[src + 4]; return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(q.x) && Number.isFinite(q.y); }
        const q = turn(v[src], v[src + 1]); v[slot] = q.x; v[slot + 1] = q.y; v[slot + 2] = v[src + 2]; return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(v[slot + 2]);
      });
    } else if (d.k === 'dilate' && d.ratio.mode === 'fixed' && d.ratio.den !== 0) {
      const src = slotOf(d.src, 'pt'), c = slotOf(d.center, 'pt'), scale = d.ratio.num / d.ratio.den, slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => { v[slot] = v[c] + (v[src] - v[c]) * scale; v[slot + 1] = v[c + 1] + (v[src + 1] - v[c + 1]) * scale; return Number.isFinite(v[slot]) && Number.isFinite(v[slot + 1]); });
    } else if (d.k === 'reflect') {
      const src = slotOf(d.src, 'pt'), m = slotOf(d.mirror, 'line'), slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => { const dx = v[m + 2] - v[m], dy = v[m + 3] - v[m + 1], den = dx * dx + dy * dy; if (den < EPS) return false; const t = ((v[src] - v[m]) * dx + (v[src + 1] - v[m + 1]) * dy) / den; v[slot] = 2 * (v[m] + dx * t) - v[src]; v[slot + 1] = 2 * (v[m + 1] + dy * t) - v[src + 1]; return Number.isFinite(v[slot]) && Number.isFinite(v[slot + 1]); });
    } else if (d.k === 'plotfix') {
      const s = slotOf(d.sys, 'sys'), slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => { v[slot] = v[s] + v[s + 2] * d.x + v[s + 4] * d.y; v[slot + 1] = v[s + 1] + v[s + 3] * d.x + v[s + 5] * d.y; return Number.isFinite(v[slot]) && Number.isFinite(v[slot + 1]); });
    } else if (d.k === 'plotxy') {
      const ux = unitOf(d.x), uy = unitOf(d.y);
      const sx = slotOf(d.x, 'num', ux), sy = slotOf(d.y, 'num', uy), s = slotOf(d.sys, 'sys'), slot = alloc(2);
      entity.set(id, { kind: 'pt', slot });
      ops.push(v => {
        const px0 = radian && ux === 'angle' ? (v[sx] * Math.PI) / 180 : v[sx];
        const py0 = radian && uy === 'angle' ? (v[sy] * Math.PI) / 180 : v[sy];
        if (!Number.isFinite(px0) || !Number.isFinite(py0)) return false;
        const angle = uy === 'angle' ? v[sy] * Math.PI / 180 : v[sy];
        const x = d.polar ? px0 * Math.cos(angle) : px0, y = d.polar ? px0 * Math.sin(angle) : py0;
        const px = v[s] + v[s + 2] * x + v[s + 4] * y, py = v[s + 1] + v[s + 3] * x + v[s + 5] * y;
        if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
        v[slot] = px; v[slot + 1] = py; return true;
      });
    } else return fail();
    active.delete(id);
    compiled.add(id);
  }

  for (let i = 0; i < map.length; i++) {
    const out = slotOf(map[i], pre[i].kind, pre[i].kind === 'num' ? 'none' : undefined);
    pre[i].out = out;
  }
  // 坐标系槽位按 origin(2) ux(2) uy(2) det(1) 排布，运行时填入。
  return { defs, ext, statusIds, size, ops, pre, sysSlots, radian };
}

/** 程序依赖的定义是否仍然是编译时的那一批。 */
export function programValid(p: FastProgram, page: Page): boolean {
  if (p.radian !== isRadianMode()) return false;
  if (p.multi) return p.multi.every(m => programValid(m, page));
  for (const [id, d] of p.defs) if (byId(page, id)?.def !== d) return false;
  return true;
}

/** 为多映射状态循环预取固定外部值。调用方在映射/层循环之外创建一次工作区。 */
export function prepareFast(p: FastProgram, get: (id: Id) => Result): Float64Array | undefined {
  if (p.multi || p.radian !== isRadianMode()) return undefined;
  for (const id of p.statusIds) if (get(id).status !== 'ok') return undefined;
  const v = new Float64Array(p.size);
  for (const e of p.ext) {
    const sh = get(e.id).shape;
    if (e.kind === 'func') { if (sh?.k !== 'func') return undefined; continue; }
    if (e.kind === 'num') { if (sh?.k !== 'num' || !Number.isFinite(sh.q.v) || (e.unit !== undefined && sh.q.u !== e.unit)) return undefined; v[e.slot] = sh.q.v; }
    else if (e.kind === 'pt') { if (sh?.k !== 'pt' || !Number.isFinite(sh.p.x) || !Number.isFinite(sh.p.y)) return undefined; v[e.slot] = sh.p.x; v[e.slot + 1] = sh.p.y; }
    else if (e.kind === 'sys') {
      if (sh?.k !== 'sys') return undefined;
      const { origin, ux, uy } = sh, det = ux.x * uy.y - ux.y * uy.x;
      if (![origin.x, origin.y, ux.x, ux.y, uy.x, uy.y].every(Number.isFinite) || Math.abs(det) < EPS) return undefined;
      v[e.slot] = origin.x; v[e.slot + 1] = origin.y; v[e.slot + 2] = ux.x; v[e.slot + 3] = ux.y; v[e.slot + 4] = uy.x; v[e.slot + 5] = uy.y; v[e.slot + 6] = det;
    } else if (e.kind === 'line') {
      if (sh?.k !== 'line') return undefined;
      v[e.slot] = sh.s.a.x; v[e.slot + 1] = sh.s.a.y; v[e.slot + 2] = sh.s.b.x; v[e.slot + 3] = sh.s.b.y; v[e.slot + 4] = sh.s.ext === 'segment' ? 0 : sh.s.ext === 'ray' ? 1 : 2;
    } else if (e.kind === 'circle') {
      if (sh?.k !== 'circle') return undefined;
      v[e.slot] = sh.c.c.x; v[e.slot + 1] = sh.c.c.y; v[e.slot + 2] = sh.c.r;
    }
  }
  return v;
}

/** 求一个映射的一层。返回 undefined 表示输入或运算不适用，调用方可退回通用求值。 */
export function runFastStep(p: FastProgram, base: Float64Array, state: Result[]): Result[] | undefined {
  if (p.multi || p.radian !== isRadianMode()) return undefined;
  const v = base;
  for (let i = 0; i < p.pre.length; i++) {
    const sh = state[i]?.shape, pr = p.pre[i];
    if (pr.kind === 'pt') { if (sh?.k !== 'pt' || !Number.isFinite(sh.p.x) || !Number.isFinite(sh.p.y)) return undefined; v[pr.slot] = sh.p.x; v[pr.slot + 1] = sh.p.y; }
    else { if (sh?.k !== 'num' || sh.q.u !== 'none' || !Number.isFinite(sh.q.v)) return undefined; v[pr.slot] = sh.q.v; }
  }
  for (let k = 0; k < p.ops.length; k++) if (!p.ops[k](v)) return undefined;
  iterFast.used++;
  return p.pre.map(pr => pr.kind === 'pt'
    ? { shape: { k: 'pt', p: { x: v[pr.out], y: v[pr.out + 1] } }, status: 'ok' } as Result
    : { shape: { k: 'num', q: { v: v[pr.out], u: 'none' } }, status: 'ok' } as Result);
}

/** 多映射几何迭代的点型单步：写入坐标缓冲区，不为每个新状态分配 Result/数组。 */
export function runFastPointInto(p: FastProgram, base: Float64Array, x: number, y: number, out: Float64Array, offset: number): boolean {
  if (p.multi || p.radian !== isRadianMode() || p.pre.length !== 1 || p.pre[0].kind !== 'pt') return false;
  const pr = p.pre[0];
  base[pr.slot] = x; base[pr.slot + 1] = y;
  for (let k = 0; k < p.ops.length; k++) if (!p.ops[k](base)) return false;
  out[offset] = base[pr.out]; out[offset + 1] = base[pr.out + 1];
  if (!Number.isFinite(out[offset]) || !Number.isFinite(out[offset + 1])) return false;
  iterFast.used++;
  return true;
}

/** 从 state 起快速推进至多 maxLevels 层，返回实际推进的层数和末状态。推进 0 层表示没有用上快路径。 */
export function runFast(p: FastProgram, get: (id: Id) => Result, state: Result[], maxLevels: number): { levels: number; state: Result[] } {
  const none = { levels: 0, state };
  if (p.radian !== isRadianMode()) return none;
  for (const id of p.statusIds) if (get(id).status !== 'ok') return none;
  const v = new Float64Array(p.size);
  for (const e of p.ext) {
    const sh = get(e.id).shape;
    if (e.kind === 'func') { if (sh?.k !== 'func') return none; continue; }
    if (e.kind === 'num') { if (sh?.k !== 'num' || !Number.isFinite(sh.q.v) || (e.unit !== undefined && sh.q.u !== e.unit)) return none; v[e.slot] = sh.q.v; }
    else if (e.kind === 'pt') { if (sh?.k !== 'pt' || !Number.isFinite(sh.p.x) || !Number.isFinite(sh.p.y)) return none; v[e.slot] = sh.p.x; v[e.slot + 1] = sh.p.y; }
    else if (e.kind === 'sys') {
      if (sh?.k !== 'sys') return none;
      const { origin, ux, uy } = sh, det = ux.x * uy.y - ux.y * uy.x;
      if (![origin.x, origin.y, ux.x, ux.y, uy.x, uy.y].every(Number.isFinite) || Math.abs(det) < EPS) return none;
      v[e.slot] = origin.x; v[e.slot + 1] = origin.y; v[e.slot + 2] = ux.x; v[e.slot + 3] = ux.y; v[e.slot + 4] = uy.x; v[e.slot + 5] = uy.y; v[e.slot + 6] = det;
    } else if (e.kind === 'line') {
      if (sh?.k !== 'line') return none;
      v[e.slot] = sh.s.a.x; v[e.slot + 1] = sh.s.a.y; v[e.slot + 2] = sh.s.b.x; v[e.slot + 3] = sh.s.b.y; v[e.slot + 4] = sh.s.ext === 'segment' ? 0 : sh.s.ext === 'ray' ? 1 : 2;
    } else if (e.kind === 'circle') {
      if (sh?.k !== 'circle') return none;
      v[e.slot] = sh.c.c.x; v[e.slot + 1] = sh.c.c.y; v[e.slot + 2] = sh.c.r;
    }
  }
  for (let i = 0; i < p.pre.length; i++) {
    const sh = state[i]?.shape, pr = p.pre[i];
    if (pr.kind === 'pt') { if (sh?.k !== 'pt' || !Number.isFinite(sh.p.x) || !Number.isFinite(sh.p.y)) return none; v[pr.slot] = sh.p.x; v[pr.slot + 1] = sh.p.y; }
    else { if (sh?.k !== 'num' || sh.q.u !== 'none' || !Number.isFinite(sh.q.v)) return none; v[pr.slot] = sh.q.v; }
  }
  const { ops, pre } = p, nOps = ops.length, nPre = pre.length;
  let level = 0;
  outer: for (; level < maxLevels; level++) {
    for (let k = 0; k < nOps; k++) if (!ops[k](v)) break outer;
    // 一层的所有输出都算完之后再整体写回前像。
    for (let i = 0; i < nPre; i++) {
      const pr = pre[i];
      if (pr.kind === 'pt') { v[pr.slot] = v[pr.out]; v[pr.slot + 1] = v[pr.out + 1]; } else v[pr.slot] = v[pr.out];
    }
  }
  if (level === 0) return none;
  iterFast.used++;
  return {
    levels: level,
    state: pre.map(pr => pr.kind === 'pt'
      ? { shape: { k: 'pt', p: { x: v[pr.slot], y: v[pr.slot + 1] } }, status: 'ok' } as Result
      : { shape: { k: 'num', q: { v: v[pr.slot], u: 'none' } }, status: 'ok' } as Result),
  };
}

/** 函数图像采样用：把 y=f(x) 的函数表达式一次编译成闭包，逐个 x 求值，结果与 engine.callFunc 逐位相同。
 * refNum 给出引用的数值对象的当前值（必须是无单位的有限数，否则返回 undefined 表示不适用）。
 * 不适用（导函数、递归、带单位的常数、反三角函数、引用不满足条件…）时返回 undefined，由调用方走通用求值器。 */
export function compileFuncValue(page: Page, funcId: Id, refNum: (id: Id) => number | undefined): ((x: number) => number | undefined) | undefined {
  if (!iterFast.enabled) return undefined;
  try {
    const radian = isRadianMode();
    const f = byId(page, funcId);
    if (f?.def.k !== 'func' || f.def.derivativeOf !== undefined) return undefined;
    const slots = new Map<Id, number>();
    const numRef = (id: Id) => { let s = slots.get(id); if (s === undefined) { s = slots.size; slots.set(id, s); } return s; };
    const cache = new Map<Id, Ev>(), stack = new Set<Id>([funcId]);
    const funcOf = (id: Id): Ev => {
      const hit = cache.get(id); if (hit) return hit;
      const g = byId(page, id);
      if (g?.def.k !== 'func' || g.def.derivativeOf !== undefined || stack.has(id)) return fail();
      stack.add(id);
      const ev = compileExpr(g.def.expr, numRef, funcOf, true, radian);
      stack.delete(id); cache.set(id, ev);
      return ev;
    };
    const ev = compileExpr(f.def.expr, numRef, funcOf, true, radian);
    const v = new Float64Array(slots.size);
    for (const [id, s] of slots) { const n = refNum(id); if (n === undefined || !Number.isFinite(n)) return undefined; v[s] = n; }
    return x => { const r = ev(v, x); return r - r === 0 ? r : undefined; };
  } catch (e) { if (e instanceof Bail) return undefined; throw e; }
}
