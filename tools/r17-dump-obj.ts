/** 第十七轮调查：按页内对象序号（跳过内嵌工具）列出对象头和全部数据记录的十六进制。用法：npx tsx tools/r17-dump-obj.ts 截图序号 对象序号[,对象序号…] */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';
const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const want = new Set(process.argv[3].split(',').map(Number));
let inTool = false, index = 0, show = false, page = 0;
for (const r of readRecords(new Uint8Array(readFileSync('../' + rows[process.argv[2]].file.replace(/\\/g, '/')))).records) {
  if (r.tag === 1002) { inTool = true; continue; }
  if (r.tag === 1003) { inTool = false; continue; }
  if (inTool) continue;
  if (r.tag === 1000) { page++; index = 0; }
  if (page > 1) break;
  if (r.tag === 2000) { index++; show = want.has(index); if (show) console.log(`#${index} 2000 ${Buffer.from(r.data).toString('hex')}`); continue; }
  if (show && r.tag !== 2007) console.log(`   ${r.tag} len=${r.data.length} ${Buffer.from(r.data.subarray(0, 120)).toString('hex')}`);
}
