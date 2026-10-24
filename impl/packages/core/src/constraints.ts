/**
 * 约束外部 ID → 约束描述符（来自 spec/objects/catalog.json，经 scripts/gen-tables.ts 生成）。
 */

import { CONSTRAINT_ROWS } from './generated/constraints.ts';

export interface ConstraintDescriptor {
  /** 约束外部 ID（2000 对象头 +0 的 u16）。 */
  extId: number;
  /**
   * 约束表里的 main_kind（原程序内部编号）。
   * 不是对象头 +6 的“主类外部 ID”；两者只有约 69% 的对象相同（spec/objects/README.md）。
   */
  tableMainKind: number;
  /** 约束表里的 genera（原程序内部编号），与对象头 +8 的 genera 外部 ID 也不是同一套。 */
  tableGenera: number;
  /** 父模板指针表里的原始 u32 词（截到第一个 0，含）；下标越界的约束（62、76、89）为 null。含义未解码。 */
  parentTemplateWords: readonly number[] | null;
  /** 描述模板原文（`^A`、`^B` 等标记未解释）；目录里没有的（15 个约束）为 null。 */
  descriptionTemplate: string | null;
}

let table: Map<number, ConstraintDescriptor> | undefined;

function constraintTable(): Map<number, ConstraintDescriptor> {
  if (table === undefined) {
    table = new Map();
    for (const [extId, tableMainKind, tableGenera, parentTemplateWords, descriptionTemplate] of CONSTRAINT_ROWS) {
      table.set(extId, { extId, tableMainKind, tableGenera, parentTemplateWords, descriptionTemplate });
    }
  }
  return table;
}

/** 按约束外部 ID 查描述符；目录里没有（例如 103–107 或 ≥128）返回 undefined。 */
export function lookupConstraint(extId: number): ConstraintDescriptor | undefined {
  return constraintTable().get(extId);
}

/** 目录里的全部约束，按 ext_id 升序。 */
export function allConstraints(): ConstraintDescriptor[] {
  return [...constraintTable().values()];
}
