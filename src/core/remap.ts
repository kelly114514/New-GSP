/** 把定义里的对象引用按映射换成别的对象（粘贴、自定义变换回放共用）。 */
import type { Expr } from './expr';
import type { ButtonAction, Def, Id } from './model';

/** 值是对象 ID 的字段（数字）。注意 x、y 不在其中：只有 plotxy 的 x、y 是 ID，别处（自由点、文本位置…）都是坐标。 */
const ID_KEYS = new Set(['derivativeOf', 'seg', 'a', 'b', 'c', 'p', 'v', 'pt', 'line', 'path', 'src', 'center', 'mirror', 'sys', 'circle', 'arc', 'driver', 'out', 'func', 'origin', 'unitX', 'unitY', 'axisX', 'axisY', 'from', 'to', 'm', 'anchor', 'clip', 'point', 'value', 'dxBy', 'dyBy', 'iter', 'img', 'stroke', 'param', 'fx', 'fy', 'value', 'unitX', 'unit']);
/** 值是 ID 数组（或 ID 的二维数组）的字段。 */
const ID_ARRAY_KEYS = new Set(['pts', 'cols', 'refs', 'targets', 'funcs', 'buttons', 'pre', 'maps', 'body', 'params']);

/** 把定义里的对象引用按映射换成别的对象；没有映射的引用保持不变。返回新对象，不改原定义。 */
export function remapDef(d: Def, map: Map<Id, Id>): Def {
  const m = (id: Id) => map.get(id) ?? id;
  const walkIds = (x: unknown): unknown => (Array.isArray(x) ? x.map(walkIds) : typeof x === 'number' ? m(x) : x && typeof x === 'object' ? walk(x, false) : x);
  const walk = (x: unknown, top: boolean): unknown => {
    if (Array.isArray(x)) return x.map(v => walk(v, false));
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        if ((k === 'x' || k === 'y') && typeof val === 'number') out[k] = top && d.k === 'plotxy' ? m(val) : val;
        else if (k === 'value' && d.k === 'param' || d.k === 'colorize' && (k === 'from' || k === 'to')) out[k] = val;
        else if ((ID_KEYS.has(k) || k === 'pre') && typeof val === 'number') out[k] = m(val);
        else if (ID_ARRAY_KEYS.has(k) && Array.isArray(val)) out[k] = walkIds(val);
        else if (k === 'expr' || k === 'action') out[k] = val;   // 下面单独处理
        else out[k] = walk(val, false);
      }
      return out;
    }
    return x;
  };
  const out = walk(d, true) as Def;
  if (out.k === 'calc' || out.k === 'func') out.expr = remapExpr(out.expr, m);
  if (out.k === 'button') out.action = remapAction(out.action, m);
  return out;
}
function remapExpr(e: Expr, m: (id: Id) => Id): Expr {
  switch (e.t) { case 'ref': return { t: 'ref', id: m(e.id) }; case 'neg': case 'fn': return { ...e, a: remapExpr(e.a, m) }; case 'bin': return { ...e, a: remapExpr(e.a, m), b: remapExpr(e.b, m) }; case 'call': return { ...e, func: m(e.func), a: remapExpr(e.a, m) }; default: return e; }
}
function remapAction(a: ButtonAction, m: (id: Id) => Id): ButtonAction {
  switch (a.type) { case 'hideshow': case 'animate': return { ...a, targets: a.targets.map(m) }; case 'move': return { ...a, from: m(a.from), to: m(a.to), ...(a.pairs ? { pairs: a.pairs.map(([x, y]) => [m(x), m(y)] as [Id, Id]) } : {}) }; case 'scroll': return { ...a, point: m(a.point) }; case 'sound': return { ...a, funcs: a.funcs.map(m) }; case 'series': return { ...a, buttons: a.buttons.map(m) }; default: return a; }
}
