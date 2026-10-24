/**
 * 生成表的纯函数部分（无副作用，测试也会用它检查已提交的生成文件是否与规格同步）。
 *
 * - `spec/objects/catalog.json` → `src/generated/constraints.ts`：
 *   约束外部 ID → 约束表 main_kind、genera、父模板词、描述模板（不含示例文件路径）。
 * - `spec/format/record-kinds.json` → `src/generated/recordKinds.ts`：
 *   记录 kind → 名称、配对 kind、成熟度。
 *
 * 只用可擦除的 TS 语法，Node 24 可直接运行。
 */

const HEADER_COMMENT = (source: string): string =>
  `// 本文件由 packages/core/scripts/gen-tables.ts 从 ${source} 生成，请勿手工编辑。\n` +
  `// 重新生成：在 impl/ 下运行 \`npm run gen\`。\n`;

export interface CatalogConstraintJson {
  ext_id: number;
  main_kind: number;
  genera: number;
  parent_template_words: number[] | null;
  description_template: string | null;
}

export interface CatalogJson {
  schema: string;
  constraints: CatalogConstraintJson[];
}

export interface RecordKindJson {
  kind: number;
  name: string;
  pair: number | null;
  closes: number | null;
  layout: string;
}

export interface RecordKindsJson {
  kinds: RecordKindJson[];
}

function fail(message: string): never {
  throw new Error(message);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 生成 `src/generated/constraints.ts` 的源码。 */
export function generateConstraintsSource(catalog: CatalogJson): string {
  if (catalog.schema !== 'gsp-object-catalog-v1') {
    fail(`unexpected catalog schema ${JSON.stringify(catalog.schema)}`);
  }
  const rows: string[] = [];
  let previous = -1;
  for (const c of catalog.constraints) {
    if (!isInt(c.ext_id) || !isInt(c.main_kind) || !isInt(c.genera)) {
      fail(`constraint ${JSON.stringify(c.ext_id)}: ext_id/main_kind/genera must be integers`);
    }
    if (c.ext_id <= previous) fail(`constraints are not in ascending ext_id order at ${c.ext_id}`);
    previous = c.ext_id;
    const words = c.parent_template_words;
    if (words !== null && !(Array.isArray(words) && words.every(isInt))) {
      fail(`constraint ${c.ext_id}: parent_template_words must be null or an integer array`);
    }
    const description = c.description_template;
    if (description !== null && typeof description !== 'string') {
      fail(`constraint ${c.ext_id}: description_template must be null or a string`);
    }
    rows.push(
      `  [${c.ext_id}, ${c.main_kind}, ${c.genera}, ${words === null ? 'null' : `[${words.join(', ')}]`}, ${
        description === null ? 'null' : JSON.stringify(description)
      }],`,
    );
  }
  return (
    HEADER_COMMENT('spec/objects/catalog.json') +
    `// catalog schema: ${catalog.schema}；${catalog.constraints.length} 行。\n` +
    `\n` +
    `/**\n` +
    ` * 约束表的一行。注意 tableMainKind / tableGenera 是原程序约束表里的内部编号，\n` +
    ` * 和 2000 对象头里的“主类外部 ID / genera 外部 ID”不是同一套编号（规格 spec/objects/README.md 已知限制 7）。\n` +
    ` */\n` +
    `export type ConstraintRow = readonly [\n` +
    `  extId: number,\n` +
    `  tableMainKind: number,\n` +
    `  tableGenera: number,\n` +
    `  parentTemplateWords: readonly number[] | null,\n` +
    `  descriptionTemplate: string | null,\n` +
    `];\n` +
    `\n` +
    `export const CONSTRAINT_ROWS: readonly ConstraintRow[] = [\n` +
    rows.join('\n') +
    `\n];\n`
  );
}

/** 生成 `src/generated/recordKinds.ts` 的源码。 */
export function generateRecordKindsSource(json: RecordKindsJson): string {
  const rows: string[] = [];
  let previous = -1;
  for (const k of json.kinds) {
    if (!isInt(k.kind) || typeof k.name !== 'string') fail(`bad record kind entry ${JSON.stringify(k)}`);
    if (k.kind <= previous) fail(`record kinds are not in ascending order at ${k.kind}`);
    previous = k.kind;
    if (k.layout !== 'known' && k.layout !== 'partial' && k.layout !== 'opaque') {
      fail(`record kind ${k.kind}: unexpected layout ${JSON.stringify(k.layout)}`);
    }
    rows.push(
      `  [${k.kind}, ${JSON.stringify(k.name)}, ${k.pair === null ? 'null' : k.pair}, ${
        k.closes === null ? 'null' : k.closes
      }, ${JSON.stringify(k.layout)}],`,
    );
  }
  return (
    HEADER_COMMENT('spec/format/record-kinds.json') +
    `// ${json.kinds.length} 种 kind。\n` +
    `\n` +
    `export type RecordKindRow = readonly [\n` +
    `  kind: number,\n` +
    `  name: string,\n` +
    `  pair: number | null,\n` +
    `  closes: number | null,\n` +
    `  layout: 'known' | 'partial' | 'opaque',\n` +
    `];\n` +
    `\n` +
    `export const RECORD_KIND_ROWS: readonly RecordKindRow[] = [\n` +
    rows.join('\n') +
    `\n];\n`
  );
}
