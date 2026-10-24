/**
 * M5 第一批验收用批量 dump：一个 node 进程跑完整个 index，比逐文件起进程快两个数量级。
 * 只给验收工具用，不进运行时。
 *
 * 用法：node tools/m5_batch1_dump.ts <index.json> <outDir>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PageGeometryEvaluator, parseGsp, readDocumentModel, toGeometryJson } from '../impl/packages/core/src/index.ts';

interface Operation { type: string; pageIndex: number; objectIndex: number; to: [number, number] }

const [indexPath, outDir] = process.argv.slice(2);
if (indexPath === undefined || outDir === undefined) {
  process.stderr.write('usage: node tools/m5_batch1_dump.ts <index.json> <outDir>\n');
  process.exitCode = 2;
} else {
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { cases: { case: string; source: { path: string }; operation?: Operation }[] };
  let done = 0;
  let failed = 0;
  for (const item of index.cases) {
    const target = join(outDir, item.case);
    mkdirSync(outDir, { recursive: true });
    const source = resolve(item.source.path);
    try {
      const model = readDocumentModel(parseGsp(new Uint8Array(readFileSync(source))));
      if (item.operation !== undefined) {
        const page = model.pages[item.operation.pageIndex - 1];
        if (page === undefined) throw new Error('operation page does not exist');
        new PageGeometryEvaluator(page).moveFreePoint(model.doc, item.operation.objectIndex, item.operation.to[0], item.operation.to[1]);
      }
      writeFileSync(target, JSON.stringify(toGeometryJson(model)));
      done++;
    } catch (e) {
      failed++;
      writeFileSync(target, JSON.stringify({ schema: 'gsp-core-geometry-v1', pages: [], error: e instanceof Error ? e.message : String(e) }));
      process.stderr.write(`FAIL ${item.source.path}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  process.stdout.write(JSON.stringify({ done, failed, existed: Number(existsSync(outDir)) }) + '\n');
}
