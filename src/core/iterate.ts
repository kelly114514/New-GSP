/** 迭代的构造：挑原象、找目标、算 body、创建迭代对象和迭代象；增加/减少迭代。 */
import type { Store } from './store';
import { ancestors, byId, descendants, isPathDef, isPointDef, type Def, type Id, type Obj } from './model';

/** 能当原象的对象：自由点、路径上的点、参数、计算结果。其它点（中点、交点、变换得到的点…）由原象推出，不能再当原象。 */
export function canBePreimage(o: Obj): boolean {
  const k = o.def.k;
  return k === 'free' || k === 'onpath' || k === 'param' || k === 'calc';
}
export const isNumericObj = (o: Obj) => o.def.k === 'param' || o.def.k === 'calc' || o.def.k === 'measure';

export interface IterSetup {
  pre: Id[];
  /** maps[j][i]：第 j 个映射里 pre[i] 的初象。 */
  maps: Id[][];
  /** 次数：固定值，或取自参数。 */
  depth: { fixed: number } | { param: Id };
  finalOnly?: boolean;
  /** 只给非点对象建迭代象（原版“仅保留非点类象”）。 */
  nonPointOnly?: boolean;
  /** 生成迭代数据表（原版：有数值原象时默认勾选）。 */
  table?: boolean;
}

/** 依赖于原象的、可见的几何对象：迭代要给它们建像。 */
export function iterationTargets(st: Store, pre: Id[], nonPointOnly: boolean): Obj[] {
  const page = st.page;
  const desc = descendants(page, pre);
  return page.objects.filter(o => {
    if (!desc.has(o.id) || o.hidden || o.def.k === 'iterate' || o.def.k === 'iterimg') return false;
    const s = st.results.get(o.id)?.shape;
    if (!s || !['pt', 'line', 'circle', 'arc', 'poly', 'disk', 'sector'].includes(s.k)) return false;
    if (!(isPointDef(o.def) || isPathDef(o.def))) return false;
    return !(nonPointOnly && isPointDef(o.def));
  });
}

/** body：原象的后代里，目标和初象依赖的那部分（含它们自己），按创建顺序。 */
export function iterationBody(st: Store, pre: Id[], images: Id[], targets: Id[]): Id[] {
  const page = st.page;
  const desc = descendants(page, pre);
  const need = new Set<Id>();
  for (const id of [...targets, ...images]) { need.add(id); for (const a of ancestors(page, [id])) need.add(a); }
  return page.objects.filter(o => need.has(o.id) && desc.has(o.id) && o.def.k !== 'iterate' && o.def.k !== 'iterimg').map(o => o.id);
}

/** 在一个事务里创建迭代对象和迭代象；返回迭代象。 */
export function constructIteration(st: Store, setup: IterSetup): { iter: Obj; images: Obj[] } {
  const images = setup.maps.flat();
  const targets = iterationTargets(st, setup.pre, !!setup.nonPointOnly);
  const body = iterationBody(st, setup.pre, images, targets.map(t => t.id));
  const def: Def = { k: 'iterate', pre: [...setup.pre], maps: setup.maps.map(m => [...m]), body, depth: setup.depth, ...(setup.finalOnly ? { finalOnly: true } : {}) };
  const iter = st.add(def);
  const made = targets.map(t => st.add({ k: 'iterimg', src: t.id, iter: iter.id }, { style: { ...t.style } }));
  const tableCols = tableColumns(st, setup);
  if (setup.table && tableCols.length) {
    const texts = st.page.objects.filter(o => o.at && ['measure', 'param', 'calc', 'table', 'func', 'picfunc', 'itertable'].includes(o.def.k)).length;
    made.push(st.add({ k: 'itertable', iter: iter.id, cols: tableCols }, { at: { x: 10, y: 16 + 24 * texts } }));   // 原版：表放在已有文字下面，样本里在 (10, 64)
  }
  return { iter, images: made };
}

/** 数据表的列：单映射、有数值原象时，各数值初象。 */
export function tableColumns(st: Store, setup: Pick<IterSetup, 'pre' | 'maps'>): Id[] {
  if (setup.maps.length !== 1 || !setup.pre.some(id => { const o = byId(st.page, id); return !!o && isNumericObj(o); })) return [];
  return setup.maps[0].filter(id => { const o = byId(st.page, id); return !!o && isNumericObj(o); });
}

/** 增加或减少迭代次数：固定次数改定义；取自参数时改参数的值。 */
export function changeDepth(st: Store, iterId: Id, delta: number) {
  const it = byId(st.page, iterId);
  if (!it || it.def.k !== 'iterate') return;
  if ('param' in it.def.depth) {
    const p = st.get(it.def.depth.param);
    if (p?.def.k === 'param') st.update(p.id, { ...p.def, value: Math.max(0, Math.round(p.def.value) + delta) });
    return;
  }
  st.update(it.id, { ...it.def, depth: { fixed: Math.max(0, it.def.depth.fixed + delta) } });
}

/** 迭代当前的次数（取自参数时取参数当前的值）。 */
export function depthOf(st: Store, iterId: Id): number | undefined {
  const it = byId(st.page, iterId);
  if (!it || it.def.k !== 'iterate') return undefined;
  if ('fixed' in it.def.depth) return it.def.depth.fixed;
  const p = st.results.get(it.def.depth.param)?.shape;
  return p?.k === 'num' && Number.isFinite(p.q.v) ? Math.round(p.q.v) : undefined;
}
