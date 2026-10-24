import { readFileSync } from 'node:fs';
import { PageGeometryEvaluator, parseGsp, readDocumentModel, toGeometryJson } from '../src/index.ts';
const args = process.argv.slice(2);
const file = args[0];
if (file === undefined || args.length > 1) {
  process.stderr.write('usage: node packages/core/scripts/geometry-dump.ts <file.gsp>\n');
  process.exitCode = 2;
} else {
  try {
    const model = readDocumentModel(parseGsp(new Uint8Array(readFileSync(file))));
    const operation: unknown = JSON.parse(process.env['GSP_M2_OPERATION'] ?? 'null');
    if (operation !== null) {
      if (typeof operation !== 'object' || !('type' in operation) || operation.type !== 'move_free_point' || !('pageIndex' in operation) || !Number.isInteger(operation.pageIndex) || !('objectIndex' in operation) || !Number.isInteger(operation.objectIndex) || !('to' in operation) || !Array.isArray(operation.to) || operation.to.length !== 2 || !operation.to.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) throw new Error('invalid GSP_M2_OPERATION');
      const page = model.pages[(operation.pageIndex as number) - 1];
      if (page === undefined) throw new Error('operation page does not exist');
      new PageGeometryEvaluator(page).moveFreePoint(model.doc, operation.objectIndex as number, operation.to[0] as number, operation.to[1] as number);
    }
    process.stdout.write(JSON.stringify(toGeometryJson(model), null, 2) + '\n');
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
