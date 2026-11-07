/**
 * 调查工具文件夹：每个工具能不能用、卡在哪里。用法：tsx tools/survey-tools.ts [工具文件夹] [报告路径.md]
 * 默认读 ../sketchpad5/Tool Folder（开发机上的原版目录，不在仓库里）；报告默认写 docs/工具兼容报告.md。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolFile, resolveTool } from '../src/toolkit';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, '../../sketchpad5/Tool Folder');
const out = process.argv[3] ?? join(here, '../docs/工具兼容报告.md');
const groups = readdirSync(dir).filter(f => /\.gsp$/i.test(f)).sort().flatMap(f => { const g = loadToolFile(f, new Uint8Array(readFileSync(join(dir, f)))); return g ? [g] : []; });

interface Row { group: string; name: string; keys: string[]; text?: string }
const rows: Row[] = [];
for (const g of groups) for (const r of g.tools) { const t = resolveTool(r); rows.push({ group: g.name, name: t.name, keys: t.blockerKeys ?? [], text: t.blocked }); }
const usable = rows.filter(r => !r.keys.length);

// 每个阻碍项：出现在多少个工具里；“只差它”（它是该工具唯一的阻碍）的有多少个——解开它直接多出这么多可用工具
const stat = new Map<string, { tools: number; only: number }>();
for (const r of rows) for (const k of r.keys) { const e = stat.get(k) ?? { tools: 0, only: 0 }; e.tools++; if (r.keys.length === 1) e.only++; stat.set(k, e); }
const ranked = [...stat.entries()].sort((a, b) => b[1].only - a[1].only || b[1].tools - a[1].tools);

const lines: string[] = [];
lines.push('# 自定义工具兼容报告', '', `由 \`tools/survey-tools.ts\` 生成（${new Date().toLocaleDateString('sv-SE')}）。读取原版的 ${groups.length} 个工具文件、${rows.length} 个工具。`, '');
lines.push(`- **可重放 ${usable.length} / ${rows.length}**（${(usable.length / rows.length * 100).toFixed(1)}%）：解析与输入类型检查通过，菜单可选择。合成输入重放及引用完整性由 \`tests/tooling.test.ts\` 另行回归；本脚本只做静态统计。**这不等于逐个与原版结果一致，也不保证任意输入下都有几何结果**，退化构造与计算定义域仍可能产生无定义对象。验证记录见 \`进度.md\`。`);
lines.push(`- 不可用 ${rows.length - usable.length} 个${rows.length === usable.length ? '，阻碍项已清零。' : '：在菜单里灰显，鼠标悬停显示原因。'}`, '');
lines.push('## 阻碍项排名', '', '键的含义：`prereq:大类/类型` = 前提条件类型还没核对；`obj:方法/大类/类型` = 工具里有读不懂的对象；`free` = 工具里有不依赖前提条件的自由点。“只差它”= 该工具唯一的阻碍，解开它就多一个可用工具。', '');
lines.push('| 阻碍项 | 涉及工具数 | 只差它 |', '|---|---|---|');
for (const [k, v] of ranked.slice(0, 40)) lines.push(`| \`${k}\` | ${v.tools} | ${v.only} |`);
lines.push('', '## 按工具文件', '', '| 文件 | 工具数 | 可用 |', '|---|---|---|');
for (const g of groups) { const n = g.tools.length, u = rows.filter(r => r.group === g.name && !r.keys.length).length; lines.push(`| ${g.name} | ${n} | ${u} |`); }
lines.push('', '## 逐个工具', '');
for (const g of groups) {
  lines.push(`### ${g.name}`, '');
  for (const r of rows.filter(x => x.group === g.name)) lines.push(`- ${r.keys.length ? '✗' : '✓'} ${r.name}${r.keys.length ? `　（${r.keys.map(k => `\`${k}\``).join('、')}）` : ''}`);
  lines.push('');
}
writeFileSync(out, lines.join('\n'));
console.log(`可用 ${usable.length} / ${rows.length}`);
console.log(ranked.slice(0, 16).map(([k, v]) => `${k.padEnd(18)} 涉及 ${String(v.tools).padStart(3)}  只差它 ${v.only}`).join('\n'));
