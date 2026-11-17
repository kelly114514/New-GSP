/** 第十七轮调查：列出每份课件当前页的轴文字样式（字号、字体、粗体）及其 10044 记录的第 4 个 u16，按字号分组。用法：npx tsx tools/r17-axis-sizes.ts ../sketchpad5 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gsp')) yield p;
  }
}
const sorted = [...files(process.argv[2])].sort();
const by = new Map<string, string[]>();
sorted.forEach((path, i) => {
  try {
    let seen = false;
    for (const r of readRecords(new Uint8Array(readFileSync(path))).records) {
      if (r.tag === 2000) break;
      if (r.tag === 10044 && r.data.length > 26) {
        const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        if (v.getUint16(0, true) === 5) {
          const z = r.data.indexOf(0, 26), name = new TextDecoder().decode(r.data.subarray(26, z < 0 ? r.data.length : z));
          const key = `size=${v.getUint16(6, true)} bold=${v.getUint16(8, true)} f4=${v.getUint16(2, true)} f5=${v.getUint16(4, true)} ${name}`;
          (by.get(key) ?? by.set(key, []).get(key)!).push(String(i).padStart(4, '0')); seen = true;
        }
      }
    }
    if (!seen) (by.get('none') ?? by.set('none', []).get('none')!).push(String(i).padStart(4, '0'));
  } catch { /* 跳过 */ }
});
for (const [k, v] of [...by].sort((a, b) => b[1].length - a[1].length)) console.log(String(v.length).padStart(5), k, v.slice(0, 6).join(','));
console.log(JSON.stringify(sorted.map(p => p)).length > 0 ? 'listing index = sorted readdir order' : '');
