import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 语料测试的公共工具，供 packages/core 的各个测试复用。
 *
 * 目录约定（本文件位于 impl/packages/core/test/support/）：
 *   implRoot  = impl/
 *   repoRoot  = 仓库根目录
 *   语料目录  = 环境变量 GSP_CORPUS_DIR，默认 <repoRoot>/original/sketchpad5
 *   基线样本  = <repoRoot>/samples/baseline/samples（已入库，始终存在）
 */

const here = dirname(fileURLToPath(import.meta.url));

/** impl/ 目录的绝对路径。 */
export const implRoot = resolve(here, '../../../..');

/** 仓库根目录的绝对路径。 */
export const repoRoot = resolve(implRoot, '..');

/** 默认语料目录：<repo>/original/sketchpad5。 */
export const defaultCorpusDir = resolve(repoRoot, 'original', 'sketchpad5');

/** 已入库的基线样本目录：<repo>/samples/baseline/samples。 */
export const baselineSamplesDir = resolve(repoRoot, 'samples', 'baseline', 'samples');

/**
 * 语料目录。优先取环境变量 GSP_CORPUS_DIR（相对路径相对于 impl/ 解析），
 * 否则用默认目录。不检查目录是否存在。
 */
export function corpusDir(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env['GSP_CORPUS_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return resolve(implRoot, fromEnv);
  }
  return defaultCorpusDir;
}

/** 目录是否存在（且确为目录）。 */
export function dirExists(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** 语料目录是否可用。语料测试用它决定是否跳过（目录不存在时跳过，不算失败）。 */
export function corpusAvailable(dir: string = corpusDir()): boolean {
  return dirExists(dir);
}

/**
 * 递归列出 dir 下所有扩展名为 .gsp（不区分大小写）的文件，返回按路径排序的绝对路径。
 * 目录不存在时返回空数组。
 */
export function gspFilesIn(dir: string): string[] {
  if (!dirExists(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.gsp$/i.test(entry.name)) {
      out.push(join(entry.parentPath, entry.name));
    }
  }
  return out.sort();
}

/** 语料目录下的全部 .gsp 文件（绝对路径，已排序）。 */
export function corpusFiles(dir: string = corpusDir()): string[] {
  return gspFilesIn(dir);
}

/** samples/baseline/samples 下的全部 .gsp 文件（绝对路径，已排序）。 */
export function baselineSampleFiles(): string[] {
  return gspFilesIn(baselineSamplesDir);
}

/** 读取整个文件为 Uint8Array。 */
export function readBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(file));
}

/** 用于报错信息的短路径（相对于仓库根目录，使用 / 分隔）。 */
export function displayPath(file: string): string {
  return relative(repoRoot, file).replaceAll('\\', '/');
}
