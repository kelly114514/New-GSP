/** 去掉课件里的 9000 记录（保存时的选中对象；其中的动画/移动/系列按钮在原版打开时会自动执行），
 *  生成“打开后停在保存状态”的临时副本，用来和新版的静态画面对照。只写到给定目录，文件名是截图序号。
 *  用法：npx tsx tools/strip-selection.ts 输出目录 截图序号 [截图序号…]
 *  之后在项目根目录运行 python reference/raw/runtime/print_native.py 输出目录 序号… 截原版。
 *  第十八轮用它确认 0912、0302、0406 等课件的低分来自打开即动画（见 docs/兼容性报告.md）。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const [out, ...keys] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const key of keys) {
  const bytes = new Uint8Array(readFileSync('../' + rows[key].file.replace(/\\/g, '/')));
  const rd = readRecords(bytes);
  if (!rd.complete) { console.log(key, '记录读取不完整，跳过'); continue; }
  const keep = rd.records.filter(r => r.tag !== 9000);
  const size = 4 + keep.reduce((n, r) => n + r.raw.length, 0);
  const b = new Uint8Array(size); b.set(bytes.subarray(0, 4)); let at = 4;
  for (const r of keep) { b.set(r.raw, at); at += r.raw.length; }
  writeFileSync(join(out, key + '.gsp'), b);
  console.log(key, '去掉', rd.records.length - keep.length, '条', bytes.length, '->', size);
}
