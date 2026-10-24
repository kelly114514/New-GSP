import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GspFormatError } from '@gsp-plus/core';
import { buildPageDrawList } from '@gsp-plus/render';
import { describe, expect, it } from 'vitest';
import { describeLoadError, loadGspDocument } from '../src/model/load';
import { formatDescriptionTemplate, objectRows, pageTabTitle } from '../src/model/objectRows';

const samplesDir = fileURLToPath(new URL('../../../../samples/baseline/samples/', import.meta.url));

function sampleBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(samplesDir + name));
}

describe('描述模板的占位符格式化', () => {
  it('^A/^B/^C 变成〈A〉〈B〉〈C〉，^# 去掉', () => {
    expect(formatDescriptionTemplate('^A 是连接^B 和^C 的线段。^#')).toBe('〈A〉 是连接〈B〉 和〈C〉 的线段。');
  });

  it('^* 与其它小写标记同样处理', () => {
    expect(formatDescriptionTemplate('直线^a 过^B 垂直于^C。^#')).toBe('直线〈a〉 过〈B〉 垂直于〈C〉。');
    expect(formatDescriptionTemplate('^A 有^X个顶点：^y。^*^#')).toBe('〈A〉 有〈X〉个顶点：〈y〉。');
  });

  it('没有标记的文字原样保留', () => {
    expect(formatDescriptionTemplate('纯文字')).toBe('纯文字');
  });
});

describe('打开文件的错误提示', () => {
  it('不是 .gsp 的字节 → 中文错误，包含原因和偏移', () => {
    const result = loadGspDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message.startsWith('打开失败：')).toBe(true);
    expect(result.message).toContain('GSP4');
    expect(result.message).toContain('字节偏移 0');
  });

  it('截断的文件 → 有原因说明', () => {
    const bytes = sampleBytes('segment.gsp').subarray(0, 100);
    const result = loadGspDocument(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('原因：');
  });

  it('正常文件 → 得到模型', () => {
    const result = loadGspDocument(sampleBytes('midpoint.gsp'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.layout).toBe(5);
    expect(result.model.pages).toHaveLength(1);
  });

  it('GspFormatError 的概括与原因都在消息里', () => {
    const err = new GspFormatError('truncated', 42, 'record header runs past end of file');
    const message = describeLoadError(err);
    expect(message).toContain('文件不完整');
    expect(message).toContain('record header runs past end of file');
    expect(message).toContain('字节偏移 42');
  });

  it('其它错误也转成中文说明', () => {
    expect(describeLoadError(new Error('boom'))).toBe('打开失败：boom');
  });
});

describe('对象列表行（基准样本）', () => {
  it('segment.gsp：三行，线段的描述、父序号和绘制状态', () => {
    const doc = readDocumentFrom('segment.gsp');
    const page = doc.pages[0]!;
    const drawn = buildPageDrawList(page).drawnIndices;
    const rows = objectRows(page, drawn);
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ constraintId: 0, description: '自由点', drawn: true, point: { x: 211, y: 147 } });
    expect(rows[2]).toMatchObject({
      constraintId: 2,
      description: '〈A〉 是连接〈B〉 和〈C〉 的线段。',
      parents: [2, 1],
      drawn: true,
      point: undefined,
    });
  });

  it('midpoint.gsp：中点一行标为已绘制，描述来自约束 1 的模板', () => {
    const page = readDocumentFrom('midpoint.gsp').pages[0]!;
    const rows = objectRows(page, buildPageDrawList(page).drawnIndices);
    expect(rows[3]).toMatchObject({
      index: 4,
      constraintId: 1,
      description: '〈A〉 是〈B〉 的中点。',
      parents: [3],
      drawn: true,
    });
  });

  it('页签标题：有页名用页名，否则“第 N 页”', () => {
    const page = readDocumentFrom('empty.gsp').pages[0]!;
    expect(pageTabTitle({ ...page, name: undefined }, 0)).toBe('第 1 页');
    expect(pageTabTitle({ ...page, name: { raw: new Uint8Array(), tail: new Uint8Array(), terminated: true, text: '  总览 ' } }, 2)).toBe('总览');
    expect(pageTabTitle({ ...page, name: { raw: new Uint8Array(), tail: new Uint8Array(), terminated: true, text: '' } }, 1)).toBe('第 2 页');
  });
});

function readDocumentFrom(name: string) {
  const result = loadGspDocument(sampleBytes(name));
  if (!result.ok) throw new Error(result.message);
  return result.model;
}

