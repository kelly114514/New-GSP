/**
 * 把 .gsp 文件转成可读的 JSON 树。
 *
 * 用法（在 impl/ 下）：
 *   node packages/core/scripts/gsp-dump.ts <file.gsp> [选项]
 *   npm run dump -w @gsp-plus/core -- <file.gsp> [选项]
 *
 * 选项：
 *   --summary         只输出摘要（布局、页/工具/对象/图片数、是否可无损往返、校验问题）
 *   --hex-limit N     不透明载荷最多输出 N 字节的十六进制（缺省 64）
 *   --big5            布局 4 文件按 Big5 解码文本（缺省 GBK）
 *   --compact         JSON 不缩进
 *
 * 只用 Node 24 能直接剥掉的 TS 语法（没有 enum / namespace / 参数属性），所以不需要构建。
 */

import { readFileSync } from 'node:fs';
import {
  GspFormatError,
  parseGsp,
  readDocumentModel,
  toDebugJson,
  validateDocument,
  writeGsp,
} from '../src/index.ts';

interface CliOptions {
  file: string | undefined;
  summary: boolean;
  hexLimit: number;
  big5: boolean;
  compact: boolean;
}

function usage(): string {
  return 'usage: node packages/core/scripts/gsp-dump.ts <file.gsp> [--summary] [--hex-limit N] [--big5] [--compact]';
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { file: undefined, summary: false, hexLimit: 64, big5: false, compact: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--summary') options.summary = true;
    else if (arg === '--big5') options.big5 = true;
    else if (arg === '--compact') options.compact = true;
    else if (arg === '--hex-limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw new Error(`--hex-limit needs a non-negative integer\n${usage()}`);
      options.hexLimit = n;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}\n${usage()}`);
    } else if (options.file === undefined) {
      options.file = arg;
    } else {
      throw new Error(`unexpected argument ${arg}\n${usage()}`);
    }
  }
  return options;
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** JSON 缩进输出，但全由基本值组成的数组写在一行里，树更好读。 */
function formatJson(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) return JSON.stringify(value).replaceAll(',', ', ');
    const inner = indent + '  ';
    const lines = value.map((v) => inner + formatJson(v, inner));
    return `[\n${lines.join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const inner = indent + '  ';
    const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function main(): number {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (options.file === undefined) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  const bytes = new Uint8Array(readFileSync(options.file));
  const ansiEncoding = options.big5 ? 'big5' : 'gbk';
  let output: unknown;
  try {
    const doc = parseGsp(bytes);
    if (options.summary) {
      const model = readDocumentModel(doc, { ansiEncoding });
      const again = writeGsp(doc);
      let roundTrip = again.length === bytes.length;
      for (let i = 0; roundTrip && i < bytes.length; i++) roundTrip = again[i] === bytes[i];
      output = {
        file: options.file,
        bytes: bytes.length,
        layout: model.layout,
        encoding: model.encoding,
        pages: model.pages.length,
        tools: model.tools.length,
        images: model.images.length,
        objects: model.pages.reduce((n, p) => n + p.objects.length, 0) + model.tools.reduce((n, t) => n + t.objects.length, 0),
        pageNames: model.pages.map((p) => p.name?.text ?? null),
        toolNames: model.tools.map((t) => t.name?.text ?? null),
        roundTripIdentical: roundTrip,
        issues: validateDocument(doc),
      };
    } else {
      output = toDebugJson(doc, { hexLimit: options.hexLimit, ansiEncoding });
    }
  } catch (e) {
    if (e instanceof GspFormatError) {
      process.stderr.write(`${options.file}: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  process.stdout.write(`${options.compact ? JSON.stringify(output) : formatJson(output)}\n`);
  return 0;
}

process.exitCode = main();
