import { describe, expect, it, vi } from 'vitest';
import { fontAt, replaceText, styleRange } from '../src/core/text-runs';
import { newDoc, type FontSpec } from '../src/core/model';
import { Store } from '../src/core/store';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { drawPage, drawRichText, embeddedButtonAt, embeddedText } from '../src/ui/render';
import type { RichNode } from '../src/gsp/richtext';

const f: FontSpec = { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' };
describe('局部文本样式', () => {
  it('编辑保留未修改文字的样式，插入文字继承插入点样式', () => {
    const styled = styleRange([{ text: '甲乙丙', font: f }], 1, 2, x => ({ ...x, bold: true }));
    const edited = replaceText(styled, '甲乙新丙', f);
    expect(edited.map(r => [r.text, r.font.bold])).toEqual([['甲', false], ['乙新', true], ['丙', false]]);
    expect(fontAt(edited, 3, f).bold).toBe(false);
  });
  it('不同字体和颜色的分段样式可写入原版格式并读回', () => {
    const st = new Store(newDoc('文本'));
    st.run('文本', () => st.add({ k: 'text', text: '甲乙', at: { x: 10, y: 10 }, w: 100, h: 30, font: f, runs: [{ text: '甲', font: { ...f, name: 'Times New Roman', color: '#0000ff' } }, { text: '乙', font: { ...f, bold: true, italic: true, underline: true, color: '#ff0000' } }] }));
    const saved = encodeFile(st.doc, undefined);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(decodeFile(saved.bytes, '文本.gsp').doc.pages[0].objects[0].def).toEqual(st.page.objects[0].def);
    expect(decodeFile(encodeNgsp(st.doc), '文本.ngsp').doc.pages[0].objects[0].def).toEqual(st.page.objects[0].def);
  });
  it('同样式的相邻文本段按显示内容比较，不因分段方式不同拒绝保存', () => {
    const st = new Store(newDoc('文本'));
    st.add({ k: 'text', text: '甲乙', at: { x: 10, y: 10 }, w: 100, h: 30, font: f, runs: [{ text: '甲', font: f }, { text: '乙', font: f }] });
    expect(encodeFile(st.doc, undefined).ok).toBe(true);
  });
  it('分段样式在动态引用展开、换行和原版格式读回后保留', () => {
    const st = new Store(newDoc('文本'));
    const param = st.add({ k: 'param', name: 'a', value: 5.5, unit: 'none', showEdit: true }, { at: { x: 10, y: 10 } });
    const blue = { ...f, name: 'Times New Roman', bold: true, color: '#0000ff' };
    const red = { ...f, italic: true, color: '#ff0000' };
    const underlined = { ...f, underline: true, color: '#0000ff' };
    const text = 'L=0\nDONE';
    const o = st.add({ k: 'text', text, refs: [param.id], at: { x: 20, y: 20 }, w: 50, h: 48, font: f,
      runs: [{ text: 'L=', font: blue }, { text: '0', font: red }, { text: '\n', font: f }, { text: 'DONE', font: underlined }] });
    const layout = embeddedText(st.page, st.results, o);
    expect(layout.text).toBe('L=5.50\nDONE');
    expect(layout.runs?.map(r => [r.text, r.font.color])).toEqual([['L=', '#0000ff'], ['5.50', '#ff0000'], ['\n', '#000000'], ['DONE', '#0000ff']]);
    const calls: { text: string; color: string }[] = [];
    const ctx = { font: '', fillStyle: '', textBaseline: '', save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), measureText: (s: string) => ({ width: s.length * 8 }), fillText(text: string) { calls.push({ text, color: this.fillStyle }); } };
    drawRichText(ctx as unknown as CanvasRenderingContext2D, o, layout.text, { x0: 0, y0: 0, x1: 100, y1: 80 }, false, layout.runs);
    expect(calls.slice(2, 6).map(c => c.color)).toEqual(['#ff0000', '#ff0000', '#ff0000', '#ff0000']);
    const encoded = encodeFile(st.doc, undefined); expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const back = decodeFile(encoded.bytes, 'x.gsp').doc.pages[0].objects[1].def;
    expect(back).toEqual(o.def);
  });
  it('分段内容与正文不一致时拒绝保存', () => {
    const st = new Store(newDoc('文本'));
    st.add({ k: 'text', text: '甲乙', at: { x: 10, y: 10 }, w: 100, h: 30, font: f, runs: [{ text: '甲', font: f }] });
    expect(encodeFile(st.doc, undefined).ok).toBe(false);
  });
  it('原版会替换的字体不能被当作无损原版格式保存', () => {
    const st = new Store(newDoc('字体'));
    st.add({ k: 'text', text: '你好', at: { x: 10, y: 10 }, w: 100, h: 30, font: { ...f, name: 'Microsoft YaHei' } });
    const saved = encodeFile(st.doc, undefined);
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.reason).toContain('原版不能保留字体');
    expect(decodeFile(encodeNgsp(st.doc), '文字.ngsp').doc).toEqual(st.doc);
  });
  it('分数公式结构写入原版格式后仍可按公式排版', () => {
    const st = new Store(newDoc('公式'));
    const text = 'z→1z', math: RichNode = { t: 'col', items: [{ t: 'row', items: [
      { t: 'run', text: 'z→', font: f },
      { t: 'frac', num: { t: 'run', text: '1', font: f }, den: { t: 'run', text: 'z', font: f } },
    ] }] };
    const o = st.add({ k: 'text', text, at: { x: 20, y: 20 }, w: 100, h: 50, font: f, math, mathText: text });
    const encoded = encodeFile(st.doc, undefined); expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(decodeFile(encoded.bytes, 'x.gsp').doc.pages[0].objects[0].def).toEqual(o.def);
  });
  it('上下标、根号和括号结构写入原版格式后保留', () => {
    const x: RichNode = { t: 'run', text: 'x', font: f }, two: RichNode = { t: 'run', text: '2', font: f };
    const cases: [string, RichNode][] = [
      ['x²', { t: 'sup', base: x, exp: two }], ['x₂', { t: 'sub', base: x, sub: two }],
      ['x', { t: 'root', body: x }], ['x', { t: 'paren', body: x, font: f }],
    ];
    for (const [text, node] of cases) {
      const st = new Store(newDoc('公式')), math: RichNode = { t: 'col', items: [node] };
      const o = st.add({ k: 'text', text, at: { x: 20, y: 20 }, w: 100, h: 50, font: f, math, mathText: text });
      const encoded = encodeFile(st.doc, undefined); expect(encoded.ok).toBe(true);
      if (encoded.ok) expect(decodeFile(encoded.bytes, 'x.gsp').doc.pages[0].objects[0].def).toEqual(o.def);
    }
  });
  it('画布绘制各段字体和颜色', () => {
    const calls: { text: string; font: string; color: string }[] = [];
    const ctx = { font: '', fillStyle: '', textBaseline: '', save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), measureText: (s: string) => ({ width: s.length * 8 }), fillText(text: string) { calls.push({ text, font: this.font, color: this.fillStyle }); } };
    const st = new Store(newDoc('绘制'));
    const o = st.add({ k: 'text', text: '甲乙', at: { x: 0, y: 0 }, w: 100, h: 30, font: f, runs: [{ text: '甲', font: f }, { text: '乙', font: { ...f, bold: true, color: '#ff0000' } }] });
    drawRichText(ctx as unknown as CanvasRenderingContext2D, o, '甲乙', { x0: 0, y0: 0, x1: 100, y1: 30 }, false);
    expect(calls.map(x => [x.text, x.font.includes('bold'), x.color])).toEqual([['甲', false, '#000000'], ['乙', true, '#ff0000']]);
  });
  it('组合文字中的按钮保持可点击，但不绘制额外边框', () => {
    const st = new Store(newDoc('按钮'));
    const pt = st.add({ k: 'free', x: 200, y: 200 }, { hidden: true });
    const button = st.add({ k: 'button', action: { type: 'hideshow', targets: [pt.id], mode: 'toggle' }, text: 'ABC', at: { x: 0, y: 0 }, w: 60, h: 24 }, { hidden: true });
    const text = st.add({ k: 'text', text: '0', refs: [button.id], at: { x: 20, y: 20 }, w: 100, h: 30, font: f });
    const ctx = { font: '', fillStyle: '', textBaseline: '', save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), measureText: (s: string) => ({ width: s.length * 8 }), fillText: vi.fn() };
    const canvas = ctx as unknown as CanvasRenderingContext2D;
    drawPage(canvas, st.page, st.results, { selection: new Set(), hideHidden: true, view: { x0: 0, y0: 0, x1: 300, y1: 300 } });
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(embeddedButtonAt(canvas, st.page, st.results, text, { x: 25, y: 25 })?.id).toBe(button.id);
  });
});
