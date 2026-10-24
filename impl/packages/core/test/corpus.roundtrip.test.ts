import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeText,
  forEachRecord,
  parseGsp,
  readDocumentModel,
  validateDocument,
  writeGsp,
} from '../src/index';
import { baselineSampleFiles, corpusAvailable, corpusDir, corpusFiles, displayPath, readBytes } from './support';

const dir = corpusDir();

interface Totals {
  files: number;
  records: number;
  pages: number;
  tools: number;
  objects: number;
  envelopes: number;
  images: number;
  layout4Files: string[];
  layout5Files: number;
  header28: number;
  header16: number;
  failures: string[];
  ms: number;
}

/** 单遍：读入 → 写出比较 → 对象模型 → 校验 → 计数。 */
function runPass(files: readonly string[]): Totals {
  const t: Totals = {
    files: 0, records: 0, pages: 0, tools: 0, objects: 0, envelopes: 0, images: 0,
    layout4Files: [], layout5Files: 0, header28: 0, header16: 0, failures: [], ms: 0,
  };
  const start = performance.now();
  for (const file of files) {
    const name = displayPath(file);
    const bytes = readBytes(file);
    try {
      const doc = parseGsp(bytes);
      const out = writeGsp(doc);
      if (Buffer.compare(out, bytes) !== 0) t.failures.push(`${name}: round trip differs`);
      forEachRecord(doc, (r) => {
        t.records++;
        if (r.kind === 902) t.envelopes++;
      });
      const model = readDocumentModel(doc);
      t.files++;
      t.pages += model.pages.length;
      t.tools += model.tools.length;
      t.images += model.images.length;
      if (model.layout === 4) t.layout4Files.push(file);
      else t.layout5Files++;
      for (const c of [...model.pages, ...model.tools]) {
        t.objects += c.objects.length;
        for (const o of c.objects) {
          if (o.header.byteLength === 28) t.header28++;
          else if (o.header.byteLength === 16) t.header16++;
          // 每个父序号 >=1 且 < 对象自己的序号
          for (const p of o.parents) {
            if (p < 1 || p >= o.index) t.failures.push(`${name}: ${c.type} ${c.index} object ${o.index} parent ${p}`);
          }
        }
        // 页头 / 工具区头的对象数等于对象个数
        if (c.header?.objectCount !== c.objects.length) {
          t.failures.push(`${name}: ${c.type} ${c.index} header count ${c.header?.objectCount} != ${c.objects.length}`);
        }
      }
      for (const issue of validateDocument(doc)) t.failures.push(`${name}: ${issue.path}: ${issue.message}`);
    } catch (e) {
      t.failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  t.ms = performance.now() - start;
  return t;
}

describe('基准样本', () => {
  it('全部往返一致、校验无问题', () => {
    const t = runPass(baselineSampleFiles());
    expect(t.failures).toEqual([]);
    expect(t.files).toBe(5);
    expect(t.pages).toBe(5);
  });
});

describe.skipIf(!corpusAvailable(dir))(`语料库 ${dir}`, () => {
  let files: string[] = [];
  let totals: Totals;

  beforeAll(() => {
    files = corpusFiles(dir);
    totals = runPass(files);
    console.info(
      `[corpus] ${totals.files} files, ${totals.records} records, ${totals.pages} pages, ${totals.tools} tools, ` +
        `${totals.objects} objects, ${totals.envelopes} envelopes, ${totals.images} images; ` +
        `parse+write+compare+model+validate in ${Math.round(totals.ms)} ms`,
    );
  }, 600_000);

  it('每个文件无损往返，对象图与页头计数一致，父序号合法', () => {
    expect(totals.failures.slice(0, 20)).toEqual([]);
    expect(totals.files).toBe(files.length);
  });

  it('完整语料的总数与规格 §1.3 一致', () => {
    if (files.length !== 1431) {
      console.info(`[corpus] ${files.length} files, not the full 1,431-file corpus; skipping total checks`);
      return;
    }
    expect(totals.files).toBe(1431);
    expect(totals.records).toBe(1_907_414);
    expect(totals.pages).toBe(2455);
    expect(totals.tools).toBe(1108);
    expect(totals.objects).toBe(400_744);
    expect(totals.envelopes).toBe(4973);
    expect(totals.images).toBe(370);
    expect(totals.layout5Files).toBe(1410);
    expect(totals.layout4Files.length).toBe(21);
    expect(totals.header28).toBe(360_923);
    expect(totals.header16).toBe(39_821);
  });

  it('布局 4 文件：16 字节对象头，文本按 GBK 解出且无替换字符；可改选 Big5', () => {
    expect(totals.layout4Files.length).toBeGreaterThan(0);
    let withCjk = 0;
    let differsUnderBig5 = 0;
    for (const file of totals.layout4Files) {
      const doc = parseGsp(readBytes(file));
      const gbk = readDocumentModel(doc);
      const big5 = readDocumentModel(doc, { ansiEncoding: 'big5' });
      expect(gbk.encoding).toBe('gbk');
      expect(big5.encoding).toBe('big5');
      expect(gbk.header.textEncodingId).toBe(3);
      let fileHasCjk = false;
      let fileDiffers = false;
      for (const c of [...gbk.pages, ...gbk.tools]) {
        for (const o of c.objects) {
          expect(o.header.byteLength, displayPath(file)).toBe(16);
          expect(o.header.ratio).toBe(1);
        }
        const texts = [
          ...(c.name ? [c.name.raw] : []),
          ...c.fonts.map((f) => f.name.raw),
          ...c.objects.flatMap((o) => (o.label ? [o.label.raw] : [])),
        ];
        for (const raw of texts) {
          const g = decodeText(raw, 'gbk');
          expect(g.includes('�'), `${displayPath(file)}: ${g}`).toBe(false);
          if (/[一-鿿]/.test(g)) fileHasCjk = true;
          if (g !== decodeText(raw, 'big5')) fileDiffers = true;
        }
      }
      if (fileHasCjk) withCjk++;
      if (fileDiffers) differsUnderBig5++;
    }
    expect(withCjk).toBeGreaterThan(10);
    expect(differsUnderBig5).toBeGreaterThan(0);
  });
});
