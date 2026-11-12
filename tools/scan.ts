/** 样例兼容扫描：npm run scan -- <样例目录> [报告.json] [--decode-only]。 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeGsp } from '../src/gsp/codec';
import { evaluatePage, type Result } from '../src/core/engine';
import { pageDisplay } from '../src/core/model';

const args = process.argv.slice(2), decodeOnly = args.includes('--decode-only');
const [root, output] = args.filter(arg => arg !== '--decode-only');
if (!root) throw new Error('用法：npm run scan -- <样例目录> [报告路径] [--decode-only]');
function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gsp')) yield p;
  }
}
type EvaluationCounts = Record<Result['status'], number>;
const emptyCounts = (): EvaluationCounts => ({ ok: 0, undefined: 0, missing: 0, unsupported: 0 });
interface Row { file: string; structure: 'ok' | 'fail'; pages: number; objects: number; known: number; unknown: number; evaluated?: number; evaluationStatus?: EvaluationCounts; protectedReason?: string; kinds: Record<string, number>; missing: Record<string, number>; error?: string }
const rows: Row[] = [];
const missingTotal = new Map<string, number>();
let anchoredPositionsChecked = 0;
for (const path of files(root)) {
  const file = relative(root, path);
  try {
    const doc = decodeGsp(new Uint8Array(readFileSync(path)));
    let objects = 0, known = 0;
    const evaluationStatus = emptyCounts();
    const kinds: Record<string, number> = {}, missing: Record<string, number> = {};
    for (const page of doc.doc.pages) {
      const results = decodeOnly ? undefined : evaluatePage(page, undefined, undefined, { angleUnit: pageDisplay(doc.doc, page).angleUnit });
      for (const o of page.objects) {
        objects++;
        // 文件里附着文字的位置先换算为相对锚点偏移；全页独立求值后核验换算。
        if (results && o.def.k === 'text' && o.def.anchor !== undefined && o.def.off) {
          const anchor = results.get(o.def.anchor)?.shape;
          if (anchor?.k === 'pt') {
            anchoredPositionsChecked++;
            if (Math.abs(o.def.at.x - anchor.p.x - o.def.off.x) > 1e-7 || Math.abs(o.def.at.y - anchor.p.y - o.def.off.y) > 1e-7) throw new Error(`附着文字 ${o.id} 的位置与锚点不一致`);
          }
        }
        if (o.def.k === 'unknown') { missing[o.def.note] = (missing[o.def.note] ?? 0) + 1; missingTotal.set(o.def.note, (missingTotal.get(o.def.note) ?? 0) + 1); }
        else {
          known++;
          kinds[o.def.k] = (kinds[o.def.k] ?? 0) + 1;
          if (results) evaluationStatus[results.get(o.id)?.status ?? 'missing']++;
        }
      }
    }
    if ((objects !== known) !== Boolean(doc.source.protectedReason)) throw new Error('只读标记与未知对象不一致');
    rows.push({ file, structure: 'ok', pages: doc.doc.pages.length, objects, known, unknown: objects - known, ...(!decodeOnly ? { evaluated: evaluationStatus.ok, evaluationStatus } : {}), protectedReason: doc.source.protectedReason, kinds, missing });
  } catch (e) {
    rows.push({ file, structure: 'fail', pages: 0, objects: 0, known: 0, unknown: 0, kinds: {}, missing: {}, error: String(e) });
  }
  if (rows.length % 100 === 0) console.error(`已扫描 ${rows.length} 份课件`);
}
const ok = rows.filter(r => r.structure === 'ok');
const fully = ok.filter(r => r.unknown === 0);
const totalObjects = ok.reduce((s, r) => s + r.objects, 0), known = ok.reduce((s, r) => s + r.known, 0);
const evaluationStatus = emptyCounts();
for (const { evaluationStatus: row } of ok) {
  if (!row) continue;
  for (const status of Object.keys(row) as (keyof EvaluationCounts)[]) evaluationStatus[status] += row[status];
}
const report = {
  generated: new Date().toISOString(),
  ...(decodeOnly ? { scope: 'decode-only' } : {}),
  summary: {
    files: rows.length, structureOk: ok.length, structureFail: rows.length - ok.length,
    fullyCompatible: fully.length, readOnlyProtected: ok.length - fully.length,
    objects: totalObjects, objectsUnderstood: known, ...(!decodeOnly ? { objectsEvaluated: evaluationStatus.ok, evaluationStatus, anchoredPositionsChecked } : {}),
    note: '“结构读取成功”只表示读到文件末尾；“完整课件兼容”这个历史字段只表示所有对象已有读取器、允许编辑；保存另受完整性保护，不代表原版互读认证。未能理解的文件按只读保护，仍可查看并逐字节原样另存。',
  },
  topMissing: [...missingTotal].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => ({ kind: k, count: v })),
  rows,
};
console.log(`文件 ${rows.length}；结构读取成功 ${ok.length}；可编辑 ${fully.length}；只读保护 ${ok.length - fully.length}`);
console.log(`对象 ${totalObjects}；已理解 ${known}；未知 ${totalObjects - known}`);
if (!decodeOnly) console.log('已解码对象的求值状态：', evaluationStatus);
console.log('最常见的未支持（方法/大类/类型）：', report.topMissing.slice(0, 12).map(x => `${x.kind}=${x.count}`).join('；'));
if (output) writeFileSync(output, JSON.stringify(report, null, 1));
if (ok.length !== rows.length) process.exitCode = 1;
