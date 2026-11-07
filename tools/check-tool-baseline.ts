/** 比较新版编码输入与原版另存结果。用法：tsx tools/check-tool-baseline.ts <清单目录> <另存目录> [报告文件] */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGsp } from '../src/gsp/codec';
import { compareContent } from '../src/gsp/semantic';
import { baselineSummary } from './tool-baseline-summary';

const [source, saved, reportFile] = process.argv.slice(2);
if (!source || !saved) throw new Error('用法：tsx tools/check-tool-baseline.ts <清单目录> <另存目录> [报告文件]');
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')) as { rows: { id: string; variants: { phase: string; filename: string }[] }[] };
const rows: { id: string; phase: string; filename: string; severity: string; reason?: string; definitions?: unknown[]; numerical?: unknown[] }[] = [];
for (const row of manifest.rows) for (const v of row.variants) {
  const path = join(saved, v.filename);
  if (!existsSync(path)) { rows.push({ id: row.id, phase: v.phase, filename: v.filename, severity: 'missing', reason: '没有另存文件' }); continue; }
  try {
    const a = decodeGsp(new Uint8Array(readFileSync(join(source, v.filename)))).doc;
    const b = decodeGsp(new Uint8Array(readFileSync(path))).doc;
    const definitions = compareContent(a, b);
    const before = baselineSummary(a), after = baselineSummary(b);
    const numerical: { path: string; before: unknown; after: unknown }[] = [];
    const compare = (x: unknown, y: unknown, key: string) => {
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y))) return;
      if (Object.is(x, y)) return;
      if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
        const xx = x as Record<string, unknown>, yy = y as Record<string, unknown>;
        for (const k of new Set([...Object.keys(xx), ...Object.keys(yy)])) compare(xx[k], yy[k], `${key}.${k}`);
      } else numerical.push({ path: key, before: x, after: y });
    };
    compare(before.map(p => p.objects.map(o => ({ status: o.status, shape: o.shape }))), after.map(p => p.objects.map(o => ({ status: o.status, shape: o.shape }))), 'results');
    const severity = definitions.some(d => /\.def|\.objects\.\d+$/.test(d.path)) ? 'definition' : numerical.length ? 'numeric' : definitions.length ? 'appearance-or-settings' : 'equal';
    rows.push({ id: row.id, phase: v.phase, filename: v.filename, severity, definitions, numerical });
  } catch (e) { rows.push({ id: row.id, phase: v.phase, filename: v.filename, severity: 'error', reason: (e as Error).message }); }
}
const report = { scope: '对比两份文件经新版解码后的模型和求值；只采样长数组前16项，数值相对容差1e-6。不比较原版运行时求值，不是像素对照。definition、numeric、appearance-or-settings 均须人工分类，可能包含原版规范化或新版解码差异。', rows };
const out = reportFile ?? join(saved, 'comparison.json'); writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: out, counts: Object.fromEntries([...new Set(rows.map(r => r.severity))].map(s => [s, rows.filter(r => r.severity === s).length])) }, null, 2));
