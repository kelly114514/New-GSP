import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  baselineSampleFiles,
  corpusAvailable,
  corpusDir,
  corpusFiles,
  defaultCorpusDir,
  gspFilesIn,
  implRoot,
  repoRoot,
} from './support';

describe('语料测试工具 (test/support)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gsp-corpus-'));
    mkdirSync(join(tmp, 'sub', 'deeper'), { recursive: true });
    writeFileSync(join(tmp, 'a.gsp'), 'GSP4');
    writeFileSync(join(tmp, 'B.GSP'), 'GSP4');
    writeFileSync(join(tmp, 'sub', 'c.Gsp'), 'GSP4');
    writeFileSync(join(tmp, 'sub', 'deeper', 'd.gsp'), 'GSP4');
    writeFileSync(join(tmp, 'notes.txt'), 'x');
    writeFileSync(join(tmp, 'e.gsp.bak'), 'x');
    mkdirSync(join(tmp, 'dir.gsp')); // 目录不算文件
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('递归列出 .gsp 且不区分大小写，排除其它扩展名和目录', () => {
    const names = gspFilesIn(tmp).map((f) => f.slice(tmp.length + 1).replaceAll('\\', '/'));
    expect(names).toEqual(['B.GSP', 'a.gsp', 'sub/c.Gsp', 'sub/deeper/d.gsp']);
  });

  it('目录不存在时返回空数组，corpusAvailable 为 false', () => {
    const missing = join(tmp, 'no-such-dir');
    expect(gspFilesIn(missing)).toEqual([]);
    expect(corpusFiles(missing)).toEqual([]);
    expect(corpusAvailable(missing)).toBe(false);
  });

  it('corpusDir：未设置环境变量时用 <repo>/original/sketchpad5', () => {
    expect(corpusDir({})).toBe(defaultCorpusDir);
    expect(corpusDir({ GSP_CORPUS_DIR: '' })).toBe(defaultCorpusDir);
    expect(defaultCorpusDir).toBe(resolve(repoRoot, 'original', 'sketchpad5'));
  });

  it('corpusDir：GSP_CORPUS_DIR 优先；相对路径相对于 impl/ 解析', () => {
    expect(corpusDir({ GSP_CORPUS_DIR: tmp })).toBe(tmp);
    expect(corpusDir({ GSP_CORPUS_DIR: '../somewhere' })).toBe(resolve(implRoot, '../somewhere'));
  });

  it('基线样本目录里有已入库的 .gsp 文件', () => {
    const files = baselineSampleFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.every((f) => /\.gsp$/i.test(f))).toBe(true);
  });
});
