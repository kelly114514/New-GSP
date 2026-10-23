import { describe, expect, it } from 'vitest';
import { readMagic } from '../src/index';
import {
  baselineSampleFiles,
  corpusAvailable,
  corpusDir,
  corpusFiles,
  displayPath,
  readBytes,
} from './support';

/** 返回魔数不是 expected 的文件，格式为“相对路径: 实际魔数”。 */
function magicMismatches(files: readonly string[], expected: string): string[] {
  const bad: string[] = [];
  for (const file of files) {
    const magic = readMagic(readBytes(file));
    if (magic !== expected) bad.push(`${displayPath(file)}: ${JSON.stringify(magic)}`);
  }
  return bad;
}

const dir = corpusDir();

// 语料目录不存在（例如 CI）时整组跳过，不算失败。
describe.skipIf(!corpusAvailable(dir))(`语料库 ${dir}`, () => {
  it('每个 .gsp 文件的魔数都是 GSP4', () => {
    const files = corpusFiles(dir);
    expect(files.length, '语料目录存在但没找到任何 .gsp').toBeGreaterThan(0);
    expect(magicMismatches(files, 'GSP4')).toEqual([]);
    console.info(`[corpus] ${dir}：检查了 ${files.length} 个 .gsp 文件，魔数均为 GSP4`);
  });
});

describe('samples/baseline/samples', () => {
  it('每个 .gsp 文件的魔数都是 GSP4', () => {
    const files = baselineSampleFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(magicMismatches(files, 'GSP4')).toEqual([]);
  });
});
