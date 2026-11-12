import { evaluatePage } from '../src/core/engine';
import { parentsOf, type Doc } from '../src/core/model';

/** 几何结果保留点、线、圆、数值等完整参数；长数组保留数量与前16项以控制报告大小。 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 16 ? { count: value.length, first: value.slice(0, 16).map(compact) } : value.map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'data').map(([k, v]) => [k, compact(v)]));
  return value;
}
export function baselineSummary(doc: Doc) {
  return doc.pages.map(page => {
    const results = evaluatePage(page, undefined, undefined, { angleUnit: doc.settings.display?.angleUnit });
    const objects = page.objects.map(o => ({ id: o.id, kind: o.def.k, def: o.def, parents: parentsOf(o.def), hidden: o.hidden, status: results.get(o.id)?.status ?? 'missing', shape: compact(results.get(o.id)?.shape) }));
    return { objects, visibleUndefined: objects.filter(o => !o.hidden && o.status !== 'ok').map(o => ({ id: o.id, kind: o.kind, status: o.status })) };
  });
}
