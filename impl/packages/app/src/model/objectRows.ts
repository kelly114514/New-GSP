import type { ContainerModel, ObjectInfo } from '@gsp-plus/core';

/** 对象列表里的一行。 */
export interface ObjectRow {
  /** 页内对象序号，从 1 起。 */
  index: number;
  constraintId: number;
  /** 可读的描述（由约束的描述模板生成）。 */
  description: string;
  mainKind: number;
  genera: number;
  /** 父对象序号（页内，从 1 起）。 */
  parents: number[];
  /** 标签文字；没有或为空为 undefined。 */
  label: string | undefined;
  /** 自由点的保存坐标；不是自由点为 undefined。 */
  point: { x: number; y: number } | undefined;
  /** 当前是否在画布上画出。 */
  drawn: boolean;
}

/**
 * 把约束描述模板里的标记换成可读的占位符：`^A` → `〈A〉`，`^#`、`^*` 这类结束和可选标记直接去掉。
 * 例如 `^A 是连接^B 和^C 的线段。^#` → `〈A〉 是连接〈B〉 和〈C〉 的线段。`
 */
export function formatDescriptionTemplate(template: string): string {
  return template
    .replace(/\^[#*]/g, '')
    .replace(/\^([A-Za-z0-9])/g, (_match, letter: string) => `〈${letter}〉`)
    .replace(/\^/g, '')
    .trim();
}

/** 对象的一句话描述。 */
export function describeObject(o: ObjectInfo): string {
  if (o.constraintId === 0) return o.freePoint !== undefined ? '自由点' : '自由对象';
  const c = o.constraint;
  if (c === undefined) return `未知约束 ${o.constraintId}`;
  if (c.descriptionTemplate === null) return `约束 ${o.constraintId}（无描述模板）`;
  return formatDescriptionTemplate(c.descriptionTemplate);
}

/** 一页的对象列表行，按对象序号升序。 */
export function objectRows(page: ContainerModel, drawn: ReadonlySet<number>): ObjectRow[] {
  return page.objects.map((o) => {
    const label = o.label?.text;
    return {
      index: o.index,
      constraintId: o.constraintId,
      description: describeObject(o),
      mainKind: o.mainKind,
      genera: o.genera,
      parents: [...o.parents],
      label: label !== undefined && label.length > 0 ? label : undefined,
      point: o.freePoint === undefined ? undefined : { x: o.freePoint.x, y: o.freePoint.y },
      drawn: drawn.has(o.index),
    };
  });
}

/** 页签文字：页名（非空时），否则“第 N 页”（N 从 1 起）。 */
export function pageTabTitle(page: ContainerModel, pageIndex: number): string {
  const name = page.name?.text.trim() ?? '';
  return name.length > 0 ? name : `第 ${pageIndex + 1} 页`;
}

/** 数值的短显示：最多三位小数，去掉多余的 0。 */
export function formatCoordinate(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
