/** 第十九轮调查：全库各类操作按钮覆盖多少课件，动画按钮的目标是什么（路径点 / 参数 / 自由点）。
 *  用来判断“动画速度和方向尚未标定”影响多大。用法：npx tsx tools/r19-button-survey.ts */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
import { readRecords } from '../src/gsp/records';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const files = new Map<string, number>(), count = new Map<string, number>();
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
let total = 0;
for (const row of Object.values(rows)) {
  let doc, ver = '?';
  try {
    const bytes = readFileSync('../' + row.file.replace(/\\/g, '/'));
    doc = decodeGsp(bytes).doc;
    const sig = readRecords(new Uint8Array(bytes)).records.find(r => r.tag === 900)?.data;   // 900 记录开头是文件版本号
    ver = sig ? `${sig[0]}.${sig[2]}` : '?';
  } catch { continue; }
  total++;
  const seen = new Set<string>();
  for (const pg of doc.pages) {
    const byId = new Map(pg.objects.map(o => [o.id, o]));
    for (const o of pg.objects) {
      if (o.def.k !== 'button') continue;
      const a = o.def.action as unknown as Record<string, unknown>;
      const kind = String(a.k ?? a.kind ?? a.type ?? Object.keys(a)[0]);
      seen.add('按钮:' + kind); bump(count, '按钮:' + kind);
      if (/anim/i.test(kind)) {
        for (const t of (a.targets as number[] | undefined) ?? []) {
          const d = byId.get(t)?.def as { k: string; path?: number } | undefined;
          const tk = d?.k === 'onpath' ? 'onpath/' + (byId.get(d.path ?? -1)?.def.k ?? '?') : d?.k ?? '?';
          seen.add('动画目标:' + tk); bump(count, '动画目标:' + tk);
        }
        if (typeof a.speed === 'number') {   // 文件里的浮点速度值（慢 4、中 24、快 80 之外的自定义值）
          const tk = ((a.targets as number[] | undefined) ?? []).some(t => byId.get(t)?.def.k === 'param') ? '参数' : '点';
          const key = `数值速度(${tk}，文件版本 ${ver}):${Number(a.speed.toPrecision(3))}`; seen.add(key); bump(count, key);
        }
        seen.add('动画方向:' + String(a.direction)); bump(count, '动画方向:' + String(a.direction));
        seen.add('动画速度:' + (typeof a.speed === 'number' ? '数值' : String(a.speed))); bump(count, '动画速度:' + (typeof a.speed === 'number' ? '数值' : String(a.speed)));
      }
      if (kind === 'move') { seen.add('移动速度:' + String(a.speed)); bump(count, '移动速度:' + String(a.speed)); }
    }
    for (const o of pg.objects) if ((o as { trace?: boolean }).trace) { seen.add('追踪'); bump(count, '追踪'); }
  }
  for (const s of seen) bump(files, s);
}
console.log('课件', total);
for (const [k, n] of [...files].sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(24)} ${String(n).padStart(5)} 份  ${count.get(k)} 个`);
