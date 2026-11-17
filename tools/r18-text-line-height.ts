/** 按课件的单字体、显式换行文本框统计行距。筛选行数越多的样本，换行误差越容易辨认。 */
import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const groups = new Map<string, Map<number, number>>();
for (const { file } of Object.values(rows)) {
  for (const page of decodeGsp(readFileSync('../' + file)).doc.pages) {
    for (const { def, hidden } of page.objects) {
      if (hidden || def.k !== 'text' || def.math || def.refs?.length || def.runs?.some(r => r.font.name !== def.font.name || r.font.size !== def.font.size)) continue;
      const count = def.text.split('\n').length;
      if (count < 3) continue;
      const key = `${def.font.name} ${def.font.size}`;
      const heights = groups.get(key) ?? new Map<number, number>();
      const height = Math.round((def.h - 4) / count);
      if (height < def.font.size * 0.8 || height > def.font.size * 1.5 + 4) continue;
      heights.set(height, (heights.get(height) ?? 0) + 1);
      groups.set(key, heights);
    }
  }
}
for (const [key, heights] of [...groups].sort()) {
  if ([...heights.values()].reduce((a, b) => a + b, 0) >= 3) console.log(key, [...heights].sort((a, b) => b[1] - a[1]));
}
