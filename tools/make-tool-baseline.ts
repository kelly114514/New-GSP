/** 生成自制工具重放基准；输出仅到新建的系统临时目录，不调用原版。 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadToolFile, resolveTool } from '../src/toolkit';
import { applyTool } from '../src/core/tooling';
import { parentsOf, type Doc } from '../src/core/model';
import { encodeGsp, decodeGsp } from '../src/gsp/codec';
import { compareContent } from '../src/gsp/semantic';
import { toolInputFixture } from './tool-input-fixture';
import { baselineSummary } from './tool-baseline-summary';

const dir = process.argv[2] ?? join(process.cwd(), '../sketchpad5/Tool Folder');
const output = mkdtempSync(join(tmpdir(), 'newgsp-tool-baseline-'));
const seed = 123456789;
const groups = readdirSync(dir).filter(f => /\.gsp$/i.test(f)).sort().flatMap(file => {
  const g = loadToolFile(file, new Uint8Array(readFileSync(join(dir, file)))); return g ? [g] : [];
});
interface Candidate { group: string; file: string; index: number; name: string; kinds: string[]; families: string[]; variants: { phase: string; bytes: Uint8Array; doc: Doc; move?: { id: number; from: unknown; to: unknown } }[] }
const candidates: Candidate[] = [], failures: Record<string, number> = {};
for (const group of groups) {
  for (let index = 0; index < group.tools.length; index++) {
    const ref = group.tools[index], tool = resolveTool(ref); if (tool.blocked || tool.objects.length > 350) continue;
    try {
      const { st, picks } = toolInputFixture(tool); let state = seed;
      const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
      st.run('工具', () => applyTool(st, tool, picks, () => ({ x: 20, y: 200 }), { random }));
      const free = st.page.objects.find(o => o.def.k === 'free'); if (!free || free.def.k !== 'free') continue;
      const variants: Candidate['variants'] = [];
      const capture = (phase: string, move?: Candidate['variants'][number]['move']) => {
        const doc = structuredClone(st.doc), bytes = encodeGsp(doc);
        // 编码器可写不等于保真；差异在清单中完整列出。
        decodeGsp(bytes);
        variants.push({ phase, bytes, doc, ...(move ? { move } : {}) });
      };
      capture('initial');
      const from = { x: free.def.x, y: free.def.y }, to = { x: from.x + 23, y: from.y + 17 };
      st.run('移动输入', () => st.update(free.id, { k: 'free', ...to }));
      capture('moved', { id: free.id, from, to });
      candidates.push({ group: group.name, file: group.file, index, name: ref.name, kinds: [...new Set(tool.inputs.map(i => i.kind))], families: [...new Set(tool.objects.filter(o => !tool.inputs.some(i => i.index === o.id)).map(o => o.def.k))], variants });
    } catch (e) { const key = (e as Error).message; failures[key] = (failures[key] ?? 0) + 1; }
  }
}
// 贪心覆盖组、输入种类和构造族；同分按文件和工具索引稳定排序。
const picked: Candidate[] = [], coveredGroups = new Set<string>(), coveredInputs = new Set<string>(), coveredFamilies = new Set<string>();
while (picked.length < 40 && candidates.length) {
  const score = (c: Candidate) => (coveredGroups.has(c.group) ? 0 : 10) + c.kinds.filter(k => !coveredInputs.has(k)).length * 20 + c.families.filter(k => !coveredFamilies.has(k)).length * 3;
  candidates.sort((a, b) => score(b) - score(a) || a.file.localeCompare(b.file) || a.index - b.index);
  const c = candidates.shift()!; picked.push(c); coveredGroups.add(c.group); c.kinds.forEach(k => coveredInputs.add(k)); c.families.forEach(k => coveredFamilies.add(k));
}
if (picked.length !== 40) throw new Error(`可编码候选不足40个：${picked.length}；临时目录 ${output}`);
const rows = picked.map((c, i) => ({ id: String(i + 1).padStart(2, '0'), group: c.group, sourceFile: c.file, toolIndexZeroBased: c.index, name: c.name, inputKinds: c.kinds, constructionFamilies: c.families, seed,
  variants: c.variants.map(v => {
    const filename = `${String(i + 1).padStart(2, '0')}-${v.phase}.gsp`; writeFileSync(join(output, filename), v.bytes);
    const decoded = decodeGsp(v.bytes).doc;
    return { phase: v.phase, filename, ...(v.move ? { move: v.move } : {}), model: baselineSummary(v.doc), encodedModel: baselineSummary(decoded), encodingDifferences: compareContent(v.doc, decoded), dependencies: v.doc.pages[0].objects.map(o => ({ id: o.id, parents: parentsOf(o.def) })) };
  }) }));
const manifest = { scope: '新版工具重放后导出自制构造，在原版打开另存比较；不是原版工具界面调用，也不证明工具段互读或编码无损。', seed, sourceGroups: groups.length, inputKinds: [...coveredInputs].sort(), constructionFamilies: [...coveredFamilies].sort(), groupCount: coveredGroups.size, failures, rows };
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, count: rows.length, files: rows.length * 2, groups: coveredGroups.size, inputKinds: manifest.inputKinds, constructionFamilies: manifest.constructionFamilies }, null, 2));
