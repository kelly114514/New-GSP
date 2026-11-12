import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { digestDoc, type ManifestEntry } from '../tools/freeze-acceptance';

const DIR = join(__dirname, '../acceptance');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf-8')) as { entries: ManifestEntry[] };
// 这两份旧冻结夹具含原版会替换的字体；仍要求原样另存及新版格式无损。
const substitutedFonts = new Set(['00-全部对象.gsp', '12-n-text.gsp']);

describe('冻结的验收文档（新版自己构造，acceptance/manifest.json）', () => {
  it('不少于 30 个文档', () => { expect(manifest.entries.length).toBeGreaterThanOrEqual(30); });
  for (const e of manifest.entries) {
    it(`${e.file}：读回后页数、页名、对象种类和求值摘要与冻结基线一致`, () => {
      const res = decodeFile(new Uint8Array(readFileSync(join(DIR, e.file))), e.file);
      const doc = res.doc;
      expect(doc.pages.length).toBe(e.pages);
      expect(doc.pages.map(p => p.name)).toEqual(e.pageNames);
      const kinds: Record<string, number> = {};
      for (const p of doc.pages) for (const o of p.objects) kinds[o.def.k] = (kinds[o.def.k] ?? 0) + 1;
      expect(kinds).toEqual(e.kinds);
      expect(kinds.unknown ?? 0).toBe(0);
      expect(digestDoc(doc)).toEqual(e.digest);
    });
    if (e.format === 'gsp') {
      it(`${e.file}：${substitutedFonts.has(e.file) ? '保护原版会替换的字体' : '再写出再读回，摘要不变'}`, () => {
        const bytes = new Uint8Array(readFileSync(join(DIR, e.file))), decoded = decodeFile(bytes, e.file), doc = decoded.doc;
        const enc = encodeFile(doc, undefined);
        if (substitutedFonts.has(e.file)) {
          expect(enc.ok).toBe(false);
          if (!enc.ok) expect(enc.reason).toContain('原版不能保留字体');
          expect(encodeFile(doc, decoded.source)).toMatchObject({ ok: true, bytes });
          expect(decodeFile(encodeNgsp(doc), 'x.ngsp').doc).toEqual(doc);
          return;
        }
        expect(enc.ok).toBe(true);
        if (!enc.ok) return;
        expect(digestDoc(decodeFile(enc.bytes, e.file).doc)).toEqual(e.digest);
      });
    }
  }
});
