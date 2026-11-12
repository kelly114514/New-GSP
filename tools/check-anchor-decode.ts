/** 对照按需与全页求值恢复文字锚点：n+ * npx tsx tools/check-anchor-decode.ts <课件目录> [结果.json] */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeGsp } from '../src/gsp/codec';
import { sourceSnapshot } from '../src/gsp/semantic';

const [root, output] = process.argv.slice(2);
if (!root) throw new Error('用法：check-anchor-decode.ts <课件目录> [结果.json]');
function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* files(path);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gsp')) yield path;
  }
}
let count = 0, matches = 0;
const failures: { file: string; error: string }[] = [];
for (const path of files(root)) {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    const actual = decodeGsp(bytes);
    const expected = decodeGsp(bytes, { fullAnchorCheck: true });
    if (sourceSnapshot(actual.doc) !== sourceSnapshot(expected.doc)) throw new Error('解码模型不一致');
    matches++;
  } catch (e) { failures.push({ file: relative(root, path), error: String(e) }); }
  count++;
  if (count % 100 === 0) console.log(`已检查 ${count}，一致 ${matches}，失败 ${failures.length}`);
}
const report = { generated: new Date().toISOString(), files: count, matches, failures };
console.log(JSON.stringify(report, null, 2));
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
