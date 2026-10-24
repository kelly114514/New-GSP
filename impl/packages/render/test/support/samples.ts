import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGsp, readDocumentModel } from '@gsp-plus/core';
import type { DocumentModel } from '@gsp-plus/core';

/** 仓库里的基准样本目录（impl/packages/render/test/support → 仓库根/samples/baseline/samples）。 */
const samplesDir = fileURLToPath(new URL('../../../../../samples/baseline/samples/', import.meta.url));

export function loadSample(name: string): DocumentModel {
  const bytes = new Uint8Array(readFileSync(samplesDir + name));
  return readDocumentModel(parseGsp(bytes));
}
