/** 第十七轮调查：统计全库每页 10002..10007 六个标志的组合。用法：npx tsx tools/r17-flag-survey.ts ../sketchpad5 [输出.json] */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gsp')) yield p;
  }
}
const combos = new Map<string, string[]>();
let index = 0;
const listing: string[] = [];
for (const path of [...files(process.argv[2])].sort()) {
  const key = String(index++).padStart(4, '0');
  listing.push(path);
  try {
    const flags: number[] = [];
    let seenObject = false, pageSeen = false;
    for (const r of readRecords(new Uint8Array(readFileSync(path))).records) {
      if (r.tag === 2000) seenObject = true;
      if (seenObject) break;
      if (r.tag >= 10002 && r.tag <= 10007 && r.data.length >= 2) { flags[r.tag - 10002] = r.data[0] | (r.data[1] << 8); pageSeen = true; }
    }
    const c = pageSeen ? flags.map(v => v ?? '-').join('') : 'none';
    combos.set(c, [...(combos.get(c) ?? []), key]);
  } catch { /* 跳过 */ }
}
for (const [c, keys] of [...combos].sort((a, b) => b[1].length - a[1].length)) console.log(c.padEnd(8), String(keys.length).padStart(5), keys.slice(0, 8).join(','));
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ combos: Object.fromEntries(combos), listing }, null, 0));
