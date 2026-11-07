import { expect, it } from 'vitest';
import { readRichText, readRichTextRuns } from '../src/gsp/richtext';
const font = { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' };
it('嵌套样式、中文字节长度和正文尖括号使用同一读取规则', () => {
  const bytes = new TextEncoder().encode('<S<VL<H<T3x中><SW2<T3x<字>>><T3x尾>>>>');
  const runs = readRichTextRuns(bytes, 0, 1, font, (head, parent) => ({ ...parent, bold: head.includes('W2') || parent.bold }));
  // 第二段载荷的UTF-8长度不是3；不完整载荷必须拒绝，不能吞掉容器。
  expect(runs).toBeUndefined();
  const valid = new TextEncoder().encode('<S<VL<H<T3x中><SW2<T5x<字>>><T3x尾>>>>');
  const rich = readRichTextRuns(valid, 0, 1, font, (head, parent) => ({ ...parent, bold: head.includes('W2') || parent.bold }));
  expect(rich?.map(r => [r.text, r.font.bold])).toEqual([['中', false], ['<字>', true], ['尾', false]]);
  expect(readRichText(valid, 0, 1)).toBe('中<字>尾');
});
it('嵌入引用、备用文字选择和垂直换行保持一致', () => {
  const bytes = new TextEncoder().encode('<S<VL<H<T1xA><?x1>><H<T1xB>>>>');
  expect(readRichText(bytes, 1, 1)).toBe('A0\nB');
  expect(readRichTextRuns(bytes, 1, 1, font)?.map(r => r.text).join('')).toBe('A0\nB');
});
