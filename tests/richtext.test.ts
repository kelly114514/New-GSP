import { expect, it } from 'vitest';
import { isPlainTextMarkup, readRichText, readRichTextRuns } from '../src/gsp/richtext';
import { decodeGsp, encodeGsp } from '../src/gsp/codec';
import { Store } from '../src/core/store';
import { embeddedText } from '../src/ui/render';
const font = { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' };
it('来源文本补丁只接受已核验的文字与样式标记', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  expect(isPlainTextMarkup(bytes('<S#CP1W2<VL<H<T5x<字>>>>>'))).toBe(true);
  expect(isPlainTextMarkup(bytes('<S<VL<H<?x1>>>>'))).toBe(false);
  expect(isPlainTextMarkup(bytes('<S<VL<H</<T1x1><T1x2>>>>>>'))).toBe(false);
  expect(isPlainTextMarkup(bytes('<S<VL<H<X<T1xA>>>>>>'))).toBe(false);
  expect(isPlainTextMarkup(bytes('<S<VL<T2xA>>>'))).toBe(false);
});
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

it('公式的系数符号、对象标签和十六进制引用随文档更新', () => {
  const raw = '<H<+<T1xx><T1x2>><?1xD000A<H<T3x + ><T1x9>>><?1xA000B<T3x旧>><?1xC>>';
  const text = readRichText(new TextEncoder().encode(raw), 12, 1);
  expect(text).toBe('x²9:D10:A11');
  const bytes = new TextEncoder().encode('<?x10>');
  expect(readRichText(bytes, 16, 1)).toBe('15');
  expect(readRichText(bytes, 16, 1, false, true)).toBe('9');
  const st = new Store();
  const { caption, coefficient } = st.run('作图', () => {
    const coefficient = st.add({ k: 'param', name: 't', value: -3, unit: 'none', showEdit: true }, { decimals: 0 });
    const point = st.add({ k: 'free', x: 10, y: 20 }, { label: 'P' });
    const refs = Array(12).fill(coefficient.id);
    refs[10] = point.id;
    const caption = st.add({ k: 'text', text: text!, at: { x: 10, y: 10 }, w: 100, h: 30, refs, font });
    return { caption, coefficient };
  });
  const shown = () => embeddedText(st.page, st.results, caption).text;
  expect(shown()).toBe('x² − 3P-3');
  st.run('改系数', () => {
    if (coefficient.def.k === 'param') st.update(coefficient.id, { ...coefficient.def, value: 4 });
  });
  expect(shown()).toBe('x² + 4P4');
  const saved = new Store(decodeGsp(encodeGsp(st.doc)).doc);
  expect(embeddedText(saved.page, saved.results, saved.get(caption.id)!).text).toBe('x² + 4P4');
});

it('向量分量有分隔符，动态指数保留其运算范围', () => {
  const markup = '<H<{<VL<?x1><?x2>>><T1x ><+<T1xe><H<?x3><!70><!D7><T1xi>>>>';
  expect(readRichText(new TextEncoder().encode(markup), 3, 1)).toBe('(0, 1) e^(2π×i)');
});
