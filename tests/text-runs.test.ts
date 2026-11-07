import { describe, expect, it, vi } from 'vitest';
import { fontAt, replaceText, styleRange } from '../src/core/text-runs';
import { newDoc, type FontSpec } from '../src/core/model';
import { Store } from '../src/core/store';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { drawRichText } from '../src/ui/render';

const f: FontSpec = { name: 'Arial', size: 16, bold: false, italic: false, underline: false, color: '#000000' };
describe('局部文本样式', () => {
  it('编辑保留未修改文字的样式，插入文字继承插入点样式', () => {
    const styled = styleRange([{ text: '甲乙丙', font: f }], 1, 2, x => ({ ...x, bold: true }));
    const edited = replaceText(styled, '甲乙新丙', f);
    expect(edited.map(r => [r.text, r.font.bold])).toEqual([['甲', false], ['乙新', true], ['丙', false]]);
    expect(fontAt(edited, 3, f).bold).toBe(false);
  });
  it('分段样式用 ngsp 保留，不静默写入原格式', () => {
    const st = new Store(newDoc('文本'));
    st.run('文本', () => st.add({ k: 'text', text: '甲乙', at: { x: 10, y: 10 }, w: 100, h: 30, font: f, runs: [{ text: '甲', font: f }, { text: '乙', font: { ...f, bold: true } }] }));
    expect(encodeFile(st.doc, undefined).ok).toBe(false);
    expect(decodeFile(encodeNgsp(st.doc), '文本.ngsp').doc.pages[0].objects[0].def).toEqual(st.page.objects[0].def);
  });
  it('画布绘制各段字体和颜色', () => {
    const calls: { text: string; font: string; color: string }[] = [];
    const ctx = { font: '', fillStyle: '', textBaseline: '', save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), measureText: (s: string) => ({ width: s.length * 8 }), fillText(text: string) { calls.push({ text, font: this.font, color: this.fillStyle }); } };
    const st = new Store(newDoc('绘制'));
    const o = st.add({ k: 'text', text: '甲乙', at: { x: 0, y: 0 }, w: 100, h: 30, font: f, runs: [{ text: '甲', font: f }, { text: '乙', font: { ...f, bold: true, color: '#ff0000' } }] });
    drawRichText(ctx as unknown as CanvasRenderingContext2D, o, '甲乙', { x0: 0, y0: 0, x1: 100, y1: 30 }, false);
    expect(calls.map(x => [x.text, x.font.includes('bold'), x.color])).toEqual([['甲', false, '#000000'], ['乙', true, '#ff0000']]);
  });
});
