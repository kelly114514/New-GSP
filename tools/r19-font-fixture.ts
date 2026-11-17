/** 第十九轮调查：把一份原版课件里“宋体”的字体表记录（1201）改写成几种写法，交给原版打开另存，
 *  看哪种写法会被原版换成 Tahoma。用来确定新版写字体表的正确格式。
 *  用法：npx tsx tools/r19-font-fixture.ts 源.gsp 输出目录
 *  之后对每个输出运行 python reference/raw/runtime/interop_roundtrip.py，再用 r19-font-table.ts 看结果。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '../src/gsp/records';

const [src, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const enc = new TextEncoder();
const bytes = new Uint8Array(readFileSync(src));
const rd = readRecords(bytes);
if (!rd.complete) throw new Error('记录读取不完整');
/** 原版自己的布局：[u16 标志][名字][NUL，补到偶数][u16] */
const native = (flag: number, name: string) => { const nb = enc.encode(name), n = (nb.length + 2) & ~1, b = new Uint8Array(2 + n + 2); b[0] = flag; b.set(nb, 2); return b; };
const variants: Record<string, Uint8Array> = {
  'a-nonul': (() => { const nb = enc.encode('宋体'), b = new Uint8Array(2 + nb.length); b.set(nb, 2); return b; })(),          // 新版现在的写法：偶数长度的名字后面没有 NUL
  'b-nul': (() => { const nb = enc.encode('宋体'), b = new Uint8Array(2 + nb.length + 2); b.set(nb, 2); return b; })(),        // 只补 NUL，不写末尾 u16
  'c-simsun': native(0, 'SimSun'),
  'd-yahei-en': native(0, 'Microsoft YaHei'),
  'e-yahei-cn': native(0, '微软雅黑'),
  'f-flag1': native(1, '宋体'),
};
const isSong = (d: Uint8Array) => Buffer.from(d.subarray(2, 8)).toString('hex') === 'e5ae8be4bd93';
for (const [name, data] of Object.entries(variants)) {
  const parts: Uint8Array[] = [bytes.subarray(0, 4)];
  let n = 0;
  for (const r of rd.records) {
    if (r.tag === 1201 && isSong(r.data)) {
      const raw = new Uint8Array(8 + data.length), v = new DataView(raw.buffer);
      v.setUint32(0, data.length, true); v.setUint32(4, 1201, true); raw.set(data, 8); parts.push(raw); n++;
    } else parts.push(r.raw);
  }
  const b = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0;
  for (const p of parts) { b.set(p, at); at += p.length; }
  writeFileSync(join(out, name + '.gsp'), b);
  console.log(name, '替换', n, '条', Buffer.from(data).toString('hex'));
}
