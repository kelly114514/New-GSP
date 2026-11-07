/** 样例兼容扫描：用法 npm run scan -- <样例目录> [报告.json]。
 * 分别报告“结构读取成功”（读到文件末尾）与“完整课件兼容”（所有对象都能理解，可编辑保存）。 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';

const root = process.argv[2];
if (!root) throw new Error('用法：npm run scan -- <样例目录> [报告路径]');
function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gsp')) yield p;
  }
}
interface Row { file: string; structure: 'ok' | 'fail'; pages: number; objects: number; known: number; unknown: number; evaluated: number; protectedReason?: string; kinds: Record<string, number>; missing: Record<string, number>; error?: string }
const rows: Row[] = [];
const missingTotal = new Map<string, number>();
for (const path of files(root)) {
  const file = relative(root, path);
  try {
    const doc = decodeGsp(new Uint8Array(readFileSync(path)));
    let objects = 0, known = 0, evaluated = 0;
    const kinds: Record<string, number> = {}, missing: Record<string, number> = {};
    for (const page of doc.doc.pages) {
      const results = evaluatePage(page);
      for (const o of page.objects) {
        objects++;
        if (o.def.k === 'unknown') { missing[o.def.note] = (missing[o.def.note] ?? 0) + 1; missingTotal.set(o.def.note, (missingTotal.get(o.def.note) ?? 0) + 1); }
        else { known++; kinds[o.def.k] = (kinds[o.def.k] ?? 0) + 1; if (results.get(o.id)?.status === 'ok') evaluated++; }
      }
    }
    rows.push({ file, structure: 'ok', pages: doc.doc.pages.length, objects, known, unknown: objects - known, evaluated, protectedReason: doc.source.protectedReason, kinds, missing });
  } catch (e) {
    rows.push({ file, structure: 'fail', pages: 0, objects: 0, known: 0, unknown: 0, evaluated: 0, kinds: {}, missing: {}, error: String(e) });
  }
}
const ok = rows.filter(r => r.structure === 'ok');
const fully = ok.filter(r => r.unknown === 0);
const totalObjects = ok.reduce((s, r) => s + r.objects, 0), known = ok.reduce((s, r) => s + r.known, 0), evaluated = ok.reduce((s, r) => s + r.evaluated, 0);
const report = {
  generated: new Date().toISOString(),
  summary: {
    files: rows.length, structureOk: ok.length, structureFail: rows.length - ok.length,
    fullyCompatible: fully.length, readOnlyProtected: ok.length - fully.length,
    objects: totalObjects, objectsUnderstood: known, objectsEvaluated: evaluated,
    note: '“结构读取成功”只表示读到文件末尾；“完整课件兼容”这个历史字段只表示所有对象已有读取器、允许编辑；保存另受完整性保护，不代表原版互读认证。未能理解的文件按只读保护，仍可查看并逐字节原样另存。',
  },
  topMissing: [...missingTotal].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => ({ kind: k, count: v })),
  rows,
};
console.log(`文件 ${rows.length}；结构读取成功 ${ok.length}；完整兼容 ${fully.length}；只读保护 ${ok.length - fully.length}`);
console.log(`对象 ${totalObjects}；已理解 ${known} (${((known / totalObjects) * 100).toFixed(1)}%)；求值成功 ${evaluated}`);
console.log('最常见的未支持（方法/大类/类型）：', report.topMissing.slice(0, 12).map(x => `${x.kind}=${x.count}`).join('；'));
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 1));
if (ok.length !== rows.length) process.exitCode = 1;
