/** 第十九轮调查：把截图对照的剩余差距按“当前页含有哪类对象”归因，找出还值得做的显示类问题。
 *  对每个特征给出：含该特征的课件数、它们的平均分、不含的平均分、它们占全部损失（Σ(1−得分)）的比例，
 *  以及最小二乘回归里该特征单独解释的每份损失。不开原版，不重画，只读 docs/截图对照数据.json 和课件。
 *  用法：npx tsx tools/r19-score-features.ts [输出.json] */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

type Row = { score: number; colorScore?: number; origInk: number; newInk: number; file: string };
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, Row>;
const feats: Record<string, (kinds: Map<string, number>, extra: { fonts: Set<string>; n: number; hiddenShare: number }) => boolean> = {
  '文字（说明）': k => (k.get('text') ?? 0) > 0,
  '文字 ≥ 5 个': k => (k.get('text') ?? 0) >= 5,
  '按钮': k => (k.get('button') ?? 0) > 0,
  '度量/计算/参数': k => (k.get('measure') ?? 0) + (k.get('calc') ?? 0) + (k.get('param') ?? 0) > 0,
  '函数/函数图像': k => (k.get('func') ?? 0) + (k.get('plot') ?? 0) > 0,
  '函数图像': k => (k.get('plot') ?? 0) > 0,
  '坐标系': k => (k.get('sys') ?? 0) > 0,
  '轨迹': k => (k.get('locus') ?? 0) > 0,
  '迭代象': k => (k.get('iterimg') ?? 0) > 0,
  '多边形/圆内部': k => (k.get('poly') ?? 0) + (k.get('circle-interior') ?? 0) + (k.get('sector') ?? 0) + (k.get('arcseg') ?? 0) > 0,
  '图片': k => (k.get('image') ?? 0) + (k.get('image-clip') ?? 0) + (k.get('warp') ?? 0) > 0,
  '参数颜色': k => (k.get('colorize') ?? 0) > 0,
  '表格': k => (k.get('table') ?? 0) > 0,
  '弧': k => (k.get('arc3') ?? 0) + (k.get('arc') ?? 0) + (k.get('arc-center') ?? 0) > 0,
  '中文字体（宋/黑/楷等）': (_k, e) => [...e.fonts].some(f => /[一-鿿]/.test(f)),
  '符号字体（Symbol/Wingdings）': (_k, e) => [...e.fonts].some(f => /symbol|wingdings|webdings/i.test(f)),
  '对象 ≥ 300': (_k, e) => e.n >= 300,
};
const names = Object.keys(feats);
const data: { key: string; loss: number; closs: number; f: boolean[]; kinds: Record<string, number> }[] = [];
for (const [key, row] of Object.entries(rows)) {
  let doc;
  try { doc = decodeGsp(readFileSync('../' + row.file.replace(/\\/g, '/'))).doc; } catch { continue; }
  const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
  const kinds = new Map<string, number>(); const fonts = new Set<string>(); let hidden = 0;
  for (const o of pg.objects) {
    if (o.hidden) { hidden++; continue; }
    kinds.set(o.def.k, (kinds.get(o.def.k) ?? 0) + 1);
    const f = (o as { font?: { name?: string } }).font?.name ?? (o.def as { font?: { name?: string } }).font?.name; if (f) fonts.add(f);
    for (const r of ((o.def as { runs?: { font?: { name?: string } }[] }).runs ?? [])) if (r.font?.name) fonts.add(r.font.name);
  }
  data.push({ key, loss: 1 - row.score, closs: 1 - (row.colorScore ?? row.score), f: names.map(n => feats[n](kinds, { fonts, n: pg.objects.length, hiddenShare: hidden / Math.max(1, pg.objects.length) })), kinds: Object.fromEntries(kinds) });
}
const total = data.reduce((s, d) => s + d.loss, 0);
console.log(`课件 ${data.length}，总损失 ${total.toFixed(1)}，平均分 ${(1 - total / data.length).toFixed(4)}`);
// 最小二乘：loss ≈ b0 + Σ b_i·f_i（正规方程，高斯消元）
const m = names.length + 1, A = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0));
for (const d of data) { const x = [1, ...d.f.map(Number)]; for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += x[i] * x[j]; A[i][m] += x[i] * d.loss; } }
for (let i = 0; i < m; i++) { let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; if (Math.abs(A[i][i]) < 1e-12) continue; for (let r = 0; r < m; r++) if (r !== i) { const q = A[r][i] / A[i][i]; for (let c = i; c <= m; c++) A[r][c] -= q * A[i][c]; } }
const beta = A.map((r, i) => Math.abs(r[i]) < 1e-12 ? 0 : r[m] / r[i]);
const out = names.map((n, i) => {
  const yes = data.filter(d => d.f[i]), no = data.filter(d => !d.f[i]);
  const ly = yes.reduce((s, d) => s + d.loss, 0);
  return { 特征: n, 份数: yes.length, 含: 1 - ly / Math.max(1, yes.length), 不含: 1 - no.reduce((s, d) => s + d.loss, 0) / Math.max(1, no.length), 占损失: ly / total, 回归每份: beta[i + 1], 回归合计: beta[i + 1] * yes.length };
}).sort((a, b) => b.回归合计 - a.回归合计);
for (const r of out) console.log(`${r.特征.padEnd(16, '　')} ${String(r.份数).padStart(5)} 份  含 ${r.含.toFixed(4)}  不含 ${r.不含.toFixed(4)}  占损失 ${(r.占损失 * 100).toFixed(0).padStart(3)}%  回归每份 ${r.回归每份.toFixed(4)}  合计 ${r.回归合计.toFixed(1)}`);
console.log('截距（什么特征都没有时的损失）', beta[0].toFixed(4));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ names, data }, null, 0));
