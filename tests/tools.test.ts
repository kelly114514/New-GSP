import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeGsp, encodeFile, encodeGsp, encodeToolBody } from '../src/gsp/codec';
import { defaultStyle, newDoc, type Def } from '../src/core/model';
import { readRecords } from '../src/gsp/records';

// 原版的工具文件夹和样例只在开发机上有（不进仓库、不随软件发布）；没有就跳过。
const ROOT = join(__dirname, '../../sketchpad5');
const TOOLS = join(ROOT, 'Tool Folder');
const have = existsSync(TOOLS);
const count = (bytes: Uint8Array, tag: number) => readRecords(bytes).records.filter(r => r.tag === tag).length;
/** 不在工具段里的 2000 记录个数 = 页面上应有的对象数。 */
const pageObjCount = (bytes: Uint8Array) => { let n = 0, inTool = false; for (const r of readRecords(bytes).records) { if (r.tag === 1002) inTool = true; else if (r.tag === 1003) inTool = false; else if (r.tag === 2000 && !inTool) n++; } return n; };
const walk = (d: string, out: string[] = []): string[] => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.gsp$/i.test(n)) out.push(p); } return out; };

it('新建工具写入文档头计数和独立的工具版本段，原版能找到工具', () => {
  const doc = newDoc();
  const defs: Def[] = [{ k: 'free', x: 0, y: 0 }, { k: 'free', x: 0, y: 0 }, { k: 'seg', a: 1, b: 2 }];
  doc.tools = [encodeToolBody(defs.map((def, i) => ({ id: i + 1, def, style: defaultStyle(def), hidden: false, labelShown: false })), '作线段', [1, 2])];
  const records = readRecords(encodeGsp(doc)).records;
  const signature = records[0].data;
  const view = new DataView(signature.buffer, signature.byteOffset, signature.byteLength);
  expect(view.getUint16(4, true)).toBe(1);
  expect(view.getUint16(24, true)).toBe(3);
  const wrapper = records[records.findIndex(r => r.tag === 1002) - 1];
  expect(wrapper.tag).toBe(902);
  expect(wrapper.data[0]).toBe(2);
  expect(wrapper.data.byteLength).toBe(240);
});

describe.skipIf(!have)('文件里的自定义工具段（1002…1003）', () => {
  it('反演.gsp：页面本身没有对象，工具对象不能混进页面，页名也不能被工具名覆盖', () => {
    const f = readdirSync(TOOLS).find(n => n.startsWith('31'))!;
    const d = decodeGsp(new Uint8Array(readFileSync(join(TOOLS, f)))).doc;
    expect(d.pages).toHaveLength(1);
    expect(d.pages[0].objects).toHaveLength(0);
    expect(d.pages[0].name).toBe('1');
    expect(d.tools).toHaveLength(6);
    expect(d.tools![0].name).toMatch(/反演变换/);
    expect(d.tools![0].prereq.length).toBeGreaterThan(0);
  });
  it('44 个工具文件：工具数 = 1002 记录数，页对象数 = 工具段之外的对象数，原样写回后再读完全一致', () => {
    let total = 0, checked = 0;
    for (const n of readdirSync(TOOLS).filter(x => /\.gsp$/i.test(x))) {
      const bytes = new Uint8Array(readFileSync(join(TOOLS, n))), res = decodeGsp(bytes), d = res.doc;
      expect(d.tools?.length ?? 0, n).toBe(count(bytes, 1002));
      total += d.tools?.length ?? 0;
      expect(d.pages.reduce((s, p) => s + p.objects.length, 0), n).toBe(pageObjCount(bytes));
      const enc = encodeFile(d, res.source);
      if (!enc.ok || res.source.protectedReason) continue;   // 页面里有写不出的对象：不比对（写出会提示改存 .ngsp）
      checked++;
      expect(decodeGsp(enc.bytes).doc.tools, n).toEqual(d.tools);
    }
    expect(total).toBe(807);
    expect(checked).toBeGreaterThan(30);
  });
});

describe.skipIf(!existsSync(join(ROOT, 'Samples')))('样例课件里内嵌的工具', () => {
  it('每个文件：工具数 = 1002 记录数，页上对象数 = 页头里的对象数之和（工具对象不混入）', () => {
    let withTools = 0;
    for (const f of walk(join(ROOT, 'Samples'))) {
      const bytes = new Uint8Array(readFileSync(f)), rd = readRecords(bytes);
      if (!rd.complete || !rd.records.some(r => r.tag === 1002)) continue;
      withTools++;
      const d = decodeGsp(bytes).doc;
      expect(d.tools?.length ?? 0, f).toBe(count(bytes, 1002));
      expect(d.pages.reduce((s, p) => s + p.objects.length, 0), f).toBe(pageObjCount(bytes));
    }
    expect(withTools).toBeGreaterThan(80);
  }, 60000);
});
