/**
 * 记录 kind 表（来自 spec/format/record-kinds.json，经 scripts/gen-tables.ts 生成）。
 */

import { RECORD_KIND_ROWS } from './generated/recordKinds.ts';

export interface RecordKindInfo {
  kind: number;
  name: string;
  /** 开始记录对应的结束记录 kind；不是开始记录为 null。 */
  pair: number | null;
  /** 结束记录对应的开始记录 kind；不是结束记录为 null。 */
  closes: number | null;
  /** known：布局全清楚；partial：部分字段已解码；opaque：只知位置与尺寸。 */
  layout: 'known' | 'partial' | 'opaque';
}

let table: Map<number, RecordKindInfo> | undefined;

function kindTable(): Map<number, RecordKindInfo> {
  if (table === undefined) {
    table = new Map();
    for (const [kind, name, pair, closes, layout] of RECORD_KIND_ROWS) {
      table.set(kind, { kind, name, pair, closes, layout });
    }
  }
  return table;
}

/** 规格表里登记的 kind 信息；不认识的 kind 返回 undefined。 */
export function lookupRecordKind(kind: number): RecordKindInfo | undefined {
  return kindTable().get(kind);
}

/** kind 的名字；不认识的返回 `unknown_<kind>`。 */
export function recordKindName(kind: number): string {
  return kindTable().get(kind)?.name ?? `unknown_${kind}`;
}
