/** 全库内存审计：强制重编码后比较模型内容，同时检查未修改文件原样保存。
 * 用法：npx tsx tools/roundtrip-audit.ts <样例目录> [报告.json]
 * 不启动原版、不写样例；编码成功、模型相等、原版互读分别报告。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeGsp, encodeFile, encodeGsp } from '../src/gsp/codec';
import { compareContent, type ContentDifference } from '../src/gsp/semantic';

const root = process.argv[2];
if (!root) throw new Error('用法：npx tsx tools/roundtrip-audit.ts <样例目录> [报告.json]');
function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p); else if (e.isFile() && e.name.toLowerCase().endsWith('.gsp')) yield p;
  }
}
const reasons: Record<string, number> = {}, categories: Record<string, number> = {};
const rows: { file: string; reason?: string; differences?: ContentDifference[] }[] = [];
let total = 0, editable = 0, encodeFail = 0, encoded = 0, diffFiles = 0, definitionDiffFiles = 0, unchangedExact = 0, sourceRebuildExact = 0, guardAcceptedLoss = 0;
// 报告不写入图片/工具的整段数据；路径和短标量足以定位最小差异。
const short = (value: unknown) => typeof value === 'string' && value.length > 180 ? `${value.slice(0, 120)}…（长度${value.length}）` : value;
for (const f of files(root)) {
  const bytes = new Uint8Array(readFileSync(f)), a = decodeGsp(bytes);
  total++;
  if (total % 100 === 0) console.error(`已审计 ${total} 份`);
  const original = encodeFile(a.doc, a.source);
  if (original.ok && Buffer.from(original.bytes).equals(Buffer.from(bytes))) unchangedExact++;
  if (a.source.protectedReason) continue;
  editable++;
  let output: Uint8Array;
  try { output = encodeGsp(a.doc); }
  catch (e) {
    encodeFail++;
    const reason = (e as Error).message;
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    rows.push({ file: relative(root, f), reason });
    continue;
  }
  encoded++;
  if (Buffer.from(output).equals(Buffer.from(bytes))) sourceRebuildExact++;
  const differences = compareContent(a.doc, decodeGsp(output).doc);
  if (!differences.length) continue;
  diffFiles++;
  if (differences.some(d => d.path.includes('.def.'))) definitionDiffFiles++;
  // 强制走重编码入口，避免“原样另存”掩盖写入器问题。
  if (encodeFile(a.doc, undefined).ok) guardAcceptedLoss++;
  for (const d of differences) {
    const key = d.path.replace(/\.\d+(?=\.|$)/g, '.*');
    categories[key] = (categories[key] ?? 0) + 1;
  }
  rows.push({ file: relative(root, f), differences: differences.map(d => ({ ...d, before: short(d.before), after: short(d.after) })) });
}
const summary = { total, unchangedExact, editable, encodeFail, encoded, diffFiles, definitionDiffFiles, modelEqual: encoded - diffFiles, sourceRebuildExact, guardAcceptedLoss };
const report = { summary, scope: '仅新版模型内容与保存入口验证；不证明尚未解码字段无损，不代表原版互读验收', reasons, categories, rows };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, reasons, categories }, null, 2));
if (unchangedExact !== total || guardAcceptedLoss !== 0) process.exitCode = 1;
