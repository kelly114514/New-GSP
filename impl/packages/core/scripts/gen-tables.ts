/**
 * 从规格 JSON 生成 core 里的查找表：
 *   spec/objects/catalog.json    → src/generated/constraints.ts
 *   spec/format/record-kinds.json → src/generated/recordKinds.ts
 *
 * 运行（在 impl/ 下）：npm run gen
 * 或直接：node packages/core/scripts/gen-tables.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateConstraintsSource, generateRecordKindsSource } from './tables.ts';
import type { CatalogJson, RecordKindsJson } from './tables.ts';

const coreRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(coreRoot, '../../..');

function readJson<T>(relativeToRepo: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relativeToRepo), 'utf8')) as T;
}

function writeGenerated(relativeToCore: string, content: string): void {
  const target = resolve(coreRoot, relativeToCore);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  process.stdout.write(`wrote ${relativeToCore} (${content.length} chars)\n`);
}

writeGenerated(
  'src/generated/constraints.ts',
  generateConstraintsSource(readJson<CatalogJson>('spec/objects/catalog.json')),
);
writeGenerated(
  'src/generated/recordKinds.ts',
  generateRecordKindsSource(readJson<RecordKindsJson>('spec/format/record-kinds.json')),
);
