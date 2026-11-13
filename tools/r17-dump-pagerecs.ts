/** 第十七轮调查：列出页级设置记录（对象之前的 1xxx/9xxx/10xxx 记录）的十六进制，用于比较两组课件。用法：npx tsx tools/r17-dump-pagerecs.ts 序号,序号… */
import { readFileSync } from 'node:fs';
import { readRecords } from '../src/gsp/records';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
for (const key of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  const path = '../' + rows[key].file.replace(/\\/g, '/');
  console.log(`== ${key} ${rows[key].file.split('\\').pop()}`);
  let seenObject = false;
  for (const r of readRecords(new Uint8Array(readFileSync(path))).records) {
    if (r.tag === 2000) seenObject = true;
    if (seenObject) break;
    if (r.tag === 1002 || r.tag === 1003) continue;   // 内嵌工具
    if ([10002, 10003, 10004, 10005, 10006, 10007, 10008, 10020, 10021, 10022, 10023, 10040, 10041, 10042, 10044, 1201, 1203, 1204, 1300, 9004, 9005, 9006, 9007, 9008, 9009, 8000, 8002, 8004, 1100, 1006, 1007].includes(r.tag))
      console.log(`  ${r.tag} len=${r.data.length} ${Buffer.from(r.data.subarray(0, 72)).toString('hex')}`);
  }
}
