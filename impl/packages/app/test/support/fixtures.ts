import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EnvelopeNode } from '@gsp-plus/core';
import { isEnvelopeNode, newRecord, pagesOf, parseGsp, writeGsp } from '@gsp-plus/core';
import type { FilePlatform } from '../../src/model/editorController';

const samples = fileURLToPath(new URL('../../../../../samples/baseline/samples/', import.meta.url));

export function sampleBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(samples + name));
}

export const UNKNOWN_KIND = 61234;
export const UNKNOWN_PAYLOAD = new Uint8Array([9, 8, 7]);

/**
 * 两页文档：midpoint.gsp 的信封复制成第二页，并在第一页开头塞一条不认识的记录，
 * 第二页的自由点挪到别处，便于区分两页。
 */
export function twoPageBytes(): Uint8Array {
  const doc = parseGsp(sampleBytes('midpoint.gsp'));
  const page = pagesOf(doc)[0]!;
  const envelope = doc.items.find((i) => isEnvelopeNode(i) && i.items.includes(page)) as EnvelopeNode;
  const second = structuredClone(envelope);
  page.items.unshift(newRecord(UNKNOWN_KIND, UNKNOWN_PAYLOAD, 0));
  doc.items.splice(doc.items.indexOf(envelope) + 1, 0, second);
  return writeGsp(doc);
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 可编排的假平台：每个操作的行为由测试替换，写出成功的内容记在 written 里。 */
export class FakePlatform implements FilePlatform {
  openResult: () => Promise<{ path: string; bytes: Uint8Array } | null> = async () => null;
  saveTarget: () => Promise<string | null> = async () => null;
  writeImpl: (path: string, bytes: Uint8Array) => Promise<void> = async () => {};
  discard: (fileName: string) => Promise<boolean> = async () => false;
  written: { path: string; bytes: Uint8Array }[] = [];
  saveDefaults: (string | null)[] = [];
  discardAsked: string[] = [];
  openCalls = 0;

  openGsp() {
    this.openCalls += 1;
    return this.openResult();
  }

  chooseSavePath(defaultPath: string | null) {
    this.saveDefaults.push(defaultPath);
    return this.saveTarget();
  }

  async writeGsp(path: string, bytes: Uint8Array) {
    await this.writeImpl(path, bytes);
    this.written.push({ path, bytes });
  }

  confirmDiscard(fileName: string) {
    this.discardAsked.push(fileName);
    return this.discard(fileName);
  }
}
