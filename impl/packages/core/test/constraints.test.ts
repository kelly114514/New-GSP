import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allConstraints, lookupConstraint, lookupRecordKind, recordKindName } from '../src/index';
import {
  generateConstraintsSource,
  generateRecordKindsSource,
} from '../scripts/tables';
import type { CatalogJson, RecordKindsJson } from '../scripts/tables';
import { implRoot, repoRoot } from './support';

const norm = (s: string): string => s.replaceAll('\r\n', '\n');
const catalog = JSON.parse(readFileSync(join(repoRoot, 'spec/objects/catalog.json'), 'utf8')) as CatalogJson;
const kinds = JSON.parse(readFileSync(join(repoRoot, 'spec/format/record-kinds.json'), 'utf8')) as RecordKindsJson;

describe('生成表与规格同步', () => {
  it('src/generated/constraints.ts 与 catalog.json 一致（改了规格要运行 npm run gen）', () => {
    const file = readFileSync(join(implRoot, 'packages/core/src/generated/constraints.ts'), 'utf8');
    expect(norm(file)).toBe(norm(generateConstraintsSource(catalog)));
  });

  it('src/generated/recordKinds.ts 与 record-kinds.json 一致', () => {
    const file = readFileSync(join(implRoot, 'packages/core/src/generated/recordKinds.ts'), 'utf8');
    expect(norm(file)).toBe(norm(generateRecordKindsSource(kinds)));
  });
});

describe('约束描述符查找', () => {
  it('123 个约束，字段取自目录', () => {
    expect(allConstraints().length).toBe(123);
    const c = lookupConstraint(1)!;
    expect(c.tableMainKind).toBe(1);
    expect(c.tableGenera).toBe(11);
    expect(c.parentTemplateWords).toEqual([14, 0]);
    expect(c.descriptionTemplate).toBe('^A 是^B 的中点。^#');
    expect(lookupConstraint(62)?.parentTemplateWords).toBeNull();
    expect(lookupConstraint(0)?.descriptionTemplate).toBeNull();
  });

  it('目录之外的 ID 返回 undefined', () => {
    expect(lookupConstraint(103)).toBeUndefined();
    expect(lookupConstraint(500)).toBeUndefined();
  });

  it('每个约束都和 catalog.json 对得上', () => {
    for (const row of catalog.constraints) {
      const c = lookupConstraint(row.ext_id);
      expect(c?.tableMainKind).toBe(row.main_kind);
      expect(c?.tableGenera).toBe(row.genera);
      expect(c?.parentTemplateWords ?? null).toEqual(row.parent_template_words);
      expect(c?.descriptionTemplate ?? null).toBe(row.description_template);
    }
  });
});

describe('记录 kind 表', () => {
  it('名字与配对', () => {
    expect(recordKindName(2201)).toBe('free_point_xy');
    expect(lookupRecordKind(2000)?.pair).toBe(2007);
    expect(lookupRecordKind(2007)?.closes).toBe(2000);
    expect(recordKindName(31337)).toBe('unknown_31337');
  });
});
