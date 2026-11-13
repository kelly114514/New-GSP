/** 保存前后的模型审计。属性顺序、页内 ID 重编号不是内容变化；其余差异逐字段报告。 */
import { remapDef } from '../core/remap';
import { evaluateTargets } from '../core/engine';
import { normalizeRuns } from '../core/text-runs';
import { DEFAULT_DISPLAY, TEXT_DEFAULTS, defaultValueDisplay, isPointDef, pageAutoSnap, pageDisplay, type DisplayPrefs, type Doc, type Obj, type Page, type TextCat } from '../core/model';

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
  if (def.k === 'text') {
    // 连续的同字体片段与合并后的片段显示完全相同；无效的旧公式缓存不参与显示。
    if (def.runs) {
      const runs = normalizeRuns(def.runs);
      if (!runs.length || (runs.length === 1 && JSON.stringify(runs[0].font) === JSON.stringify(def.font) && runs[0].text === def.text)) delete def.runs;
      else def.runs = runs;
    }
    if (def.mathText !== def.text) { delete def.math; delete def.mathText; }
  }
  if (def.k === 'sys') {
    def.snap = false; // 旧版新版课件把页级吸附存进坐标系，语义比较在页级统一。
    if (!def.gridPoints) delete def.gridPoints;
  }
  if (def.k === 'iterate') { delete def.salt; def.body.sort((a, b) => a - b); }
  if (def.k === 'custom-point' || def.k === 'custom-image') def.body.sort((a, b) => a - b);
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
  const region = ['poly', 'circle-int', 'arc-int', 'angle-mark'].includes(base.def.k);
  const line = ['seg', 'ray', 'line', 'perp', 'parallel', 'bisect', 'circle', 'circle-seg', 'arc3', 'arc-circle', 'arc-center', 'axis-line', 'locus', 'plot', 'pcurve', 'angle-mark', 'segment-mark'].includes(base.def.k);
  // 样式结构中不用于该类型的槽位不影响显示；有效槽位全部比较。
  // 文本的显示颜色在字体里，对象头颜色只是缺省文字颜色，写入时随字体颜色写，不单独比较
  const style = { ...(def.k === 'text' ? {} : { color: o.style.color }), ...(point ? { pointSize: o.style.pointSize } : {}), ...(line ? { width: o.style.width, dash: o.style.dash } : {}), ...(region ? { fillAlpha: Math.round((o.style.fillAlpha ?? 0.5) * 255) / 255 } : {}) };
  const { id: _id, src: _src, style: _style, def: _def, ...rest } = o;
  const content = { ...rest, label: o.label ?? (def.k === 'param' || def.k === 'func' ? def.name : undefined), trace: !!o.trace, unselectable: !!o.unselectable, def, style };
  if (def.k === 'calc' || def.k === 'measure') content.valueDisplay ??= defaultValueDisplay(o);
  if (content.colorBy) content.colorBy = { ...content.colorBy, param: ids.get(content.colorBy.param) ?? content.colorBy.param };
  return content;
}

/** 当前页、滚动、nextId 是编辑会话状态；name 是文件名。它们不属于原版课件的内容。 */
export function documentContent(doc: Doc): unknown {
  return {
    // 文件的文档级单位来自第一页；各页的实际覆盖另在页面内容里逐一比较。
    settings: { ...doc.settings, display: doc.pages[0] ? pageDisplay(doc, doc.pages[0]) : { ...DEFAULT_DISPLAY, ...doc.settings.display } }, paper: doc.paper, tools: doc.tools ?? [],
    pages: doc.pages.map(page => {
      const ids = new Map(page.objects.map((o, i) => [o.id, i + 1]));
      return { name: page.name, labelCounter: page.labelCounter, autoSnap: pageAutoSnap(page), display: pageDisplay(doc, page), transforms: (page.transforms ?? []).map(t => ({ ...t, src: ids.get(t.src) ?? t.src, img: ids.get(t.img) ?? t.img })), startupButtons: (page.startupButtons ?? []).map(id => ids.get(id) ?? id), objects: page.objects.map(o => objectContent(o, page, ids)) };
    }),
  };
}

/** 原样另存使用精确内容快照，不忽略样式或浮点差异。只排除文件名和会话状态。 */
export function sourceSnapshot(doc: Doc): string {
  return JSON.stringify({ ...doc, name: '', current: 0, pages: doc.pages.map(p => ({ ...p, scroll: { x: 0, y: 0 }, nextId: 0 })) });
}

export function compareContent(before: Doc, after: Doc): ContentDifference[] {
  const differences: ContentDifference[] = [];
  const defaultPrecision = (path: string): number | undefined => {
    const match = /^pages\.(\d+)\.objects\.(\d+)\.decimals$/.exec(path);
    if (!match) return undefined;
    const page = before.pages[Number(match[1])], o = page?.objects[Number(match[2])];
    if (!o || !['measure', 'param', 'calc'].includes(o.def.k)) return undefined;
    const display = pageDisplay(before, page);
    const shape = evaluateTargets(page, [o.id], { angleUnit: display.angleUnit }).get(o.id)?.shape;
    let unit = shape?.k === 'num' ? shape.q.u : undefined;
    if (!unit && o.def.k === 'param') unit = o.def.unit;
    if (!unit && o.def.k === 'calc') unit = o.def.unit;
    if (!unit && o.def.k === 'measure') {
      const m = o.def.m;
      unit = ['length', 'distance', 'arclength', 'perimeter', 'circumference', 'radius'].includes(m) ? 'distance' : ['angle', 'arcangle', 'markedangle', 'coordangle'].includes(m) ? 'angle' : 'none';
    }
    return unit === 'angle' ? display.anglePrec : unit === 'distance' ? display.distPrec : display.otherPrec;
  };
  function walk(a: unknown, b: unknown, path: string) {
    if (Object.is(a, b)) return;
    // 显示精度未指定时编码写默认值，读回后有值不算丢失。
    // 原版字号以整数保存；只容忍整数取整引入的半像素差。
    if (path.endsWith('.font.size') && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 0.5) return;
    if (a === undefined && path.endsWith('.def.alternate')) return;
    if (a === undefined && path.endsWith('.decimals') && b === defaultPrecision(path)) return;
    // 来源标记不是显示设置；实际精度、字体样式等即使来自文件也必须完整比较。
    if (path === 'settings.display' || /^pages\.\d+\.display$/.test(path)) {
      const plain = (d: unknown) => {
        const { fromFile: _source, mathItalicKnown: _known, textStyles, ...prefs } = (d ?? {}) as Partial<DisplayPrefs>;
        const styles: Record<string, Record<string, unknown>> = {};
        for (const cat of Object.keys(textStyles ?? {}).sort()) {
          const style = textStyles?.[cat as TextCat] as Record<string, unknown> | undefined;
          const defaults = TEXT_DEFAULTS[cat as TextCat]?.style as unknown as Record<string, unknown> | undefined;
          const entries = Object.entries(style ?? {}).filter(([key, value]) => {
            const inherited = cat === 'label' && key === 'italic' ? (prefs.mathItalic ?? DEFAULT_DISPLAY.mathItalic) : defaults?.[key];
            return value !== undefined && value !== inherited;
          }).sort(([a], [b]) => a.localeCompare(b));
          if (entries.length) styles[cat] = Object.fromEntries(entries);
        }
        return JSON.stringify({ ...DEFAULT_DISPLAY, ...prefs, textStyles: styles });
      };
      if (plain(a) !== plain(b)) differences.push({ path, before: a, after: b });
      return;
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
