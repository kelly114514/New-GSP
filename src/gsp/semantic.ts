/** 保存前后的模型审计。属性顺序、页内 ID 重编号不是内容变化；其余差异逐字段报告。 */
import { remapDef } from '../core/remap';
import { DEFAULT_DISPLAY, isPointDef, type Doc, type Obj, type Page } from '../core/model';

export interface ContentDifference { path: string; before: unknown; after: unknown }

/** 对话框面向课件使用者；完整字段路径只留给测试和开发审计。 */
export function describeDifference(path: string): string {
  const match = /^pages\.(\d+)\.objects\.(\d+)\.(.+)/.exec(path);
  const labels: Record<string, string> = { settings: '文档显示设置', paper: '页面设置', tools: '自定义工具', labelDx: '标签位置', labelDy: '标签位置', label: '标签文字', labelShown: '标签显示', hidden: '隐藏状态', trace: '追踪设置', style: '外观样式', at: '文字位置', def: '构造或文本内容', anim: '动画设置', unselectable: '选择设置', colorBy: '参数着色' };
  if (match) return `第${Number(match[1]) + 1}页第${Number(match[2]) + 1}个对象的${labels[match[3].split('.')[0]] ?? '属性'}`;
  if (path.startsWith('pages.')) return '页面内容或标签计数';
  return labels[path.split('.')[0]] ?? '课件内容';
}

function objectContent(o: Obj, page: Page, ids: Map<number, number>) {
  const def = remapDef(o.def, ids);
  if (def.k === 'iterate') { delete def.salt; def.body.sort((a, b) => a - b); }
  if (def.k === 'custom-point') def.body.sort((a, b) => a - b);
  // 附着文本的位置由父点和 off 决定，at 是导入时的缓存；不拿缓存冒充构造变化。
  if (def.k === 'text' && def.anchor !== undefined && def.off) def.at = { x: 0, y: 0 };
  let base = o;
  const seen = new Set<number>();
  while (['translate', 'rotate', 'dilate', 'reflect'].includes(base.def.k) && 'src' in base.def && !seen.has(base.id)) {
    seen.add(base.id);
    const parent = page.objects.find(p => p.id === (base.def as { src: number }).src);
    if (!parent) break;
    base = parent;
  }
  const point = isPointDef(base.def);
  const region = ['poly', 'circle-int', 'arc-int'].includes(base.def.k);
  const line = ['seg', 'ray', 'line', 'perp', 'parallel', 'bisect', 'circle', 'circle-seg', 'arc3', 'arc-circle', 'arc-center', 'axis-line', 'locus', 'plot', 'pcurve'].includes(base.def.k);
  // 样式结构中不用于该类型的槽位不影响显示；有效槽位全部比较。
  const style = { color: o.style.color, ...(point ? { pointSize: o.style.pointSize } : {}), ...(line ? { width: o.style.width, dash: o.style.dash } : {}), ...(region ? { fillAlpha: Math.round((o.style.fillAlpha ?? 0.5) * 255) / 255 } : {}) };
  const { id: _id, src: _src, style: _style, def: _def, ...rest } = o;
  const content = { ...rest, label: o.label ?? (def.k === 'param' || def.k === 'func' ? def.name : undefined), trace: !!o.trace, unselectable: !!o.unselectable, def, style };
  if (content.colorBy) content.colorBy = { ...content.colorBy, param: ids.get(content.colorBy.param) ?? content.colorBy.param };
  return content;
}

/** 当前页、滚动、nextId 是编辑会话状态；name 是文件名。它们不属于原版课件的内容。 */
export function documentContent(doc: Doc): unknown {
  return {
    settings: doc.settings, paper: doc.paper, tools: doc.tools ?? [],
    pages: doc.pages.map(page => {
      const ids = new Map(page.objects.map((o, i) => [o.id, i + 1]));
      return { name: page.name, labelCounter: page.labelCounter, transforms: (page.transforms ?? []).map(t => ({ ...t, src: ids.get(t.src) ?? t.src, img: ids.get(t.img) ?? t.img })), objects: page.objects.map(o => objectContent(o, page, ids)) };
    }),
  };
}

/** 原样另存使用精确内容快照，不忽略样式或浮点差异。只排除文件名和会话状态。 */
export function sourceSnapshot(doc: Doc): string {
  return JSON.stringify({ ...doc, name: '', current: 0, pages: doc.pages.map(p => ({ ...p, scroll: { x: 0, y: 0 }, nextId: 0 })) });
}

export function compareContent(before: Doc, after: Doc): ContentDifference[] {
  const differences: ContentDifference[] = [];
  function walk(a: unknown, b: unknown, path: string) {
    if (Object.is(a, b)) return;
    // 显示精度未指定时编码写默认值，读回后有值不算丢失。
    // 字号在文件里按磅取整，读回可能差 1 像素。
    if (path.endsWith('.font.size') && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1) return;
    if (a === undefined && (path.endsWith('.decimals') || path.endsWith('.def.alternate'))) return;
    // 文档文本样式表由原样保存保留；重新编码不写（原版用默认样式打开）。
    if (path === 'settings.display') {
      const plain = (d: unknown) => { if (!d || (d as { fromFile?: boolean }).fromFile) return ''; const { textStyles: _ignored, ...rest } = d as Record<string, unknown>; const text = JSON.stringify(rest); return text === JSON.stringify(DEFAULT_DISPLAY) ? '' : text; };
      if (plain(a) === plain(b)) return;
    }
    // 数字仅容忍编解码浮点尾差（绝对误差），不容忍整数 ID、采样数、精度发生变化。
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) walk(x[k], y[k], path ? `${path}.${k}` : k);
      return;
    }
    differences.push({ path, before: a, after: b });
  }
  walk(documentContent(before), documentContent(after), '');
  return differences;
}
