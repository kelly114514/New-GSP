import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { DEFAULT_DISPLAY, pageDisplay } from '../src/core/model';
import { decodeGsp, encodeFile, encodeNgsp, decodeFile } from '../src/gsp/codec';
import { compareContent } from '../src/gsp/semantic';

function numberAt(st: Store): number {
  const shape = st.results.get(1)?.shape;
  if (shape?.k !== 'num') throw new Error('计算结果无定义');
  return shape.q.v;
}

describe('多页角度单位', () => {
  const fixture = resolve(import.meta.dirname, '../../reference/raw/runtime/interop-evidence/multipage-angle-units.gsp');
  it.skipIf(!existsSync(fixture))('原版实测夹具切页时按各页单位重新求值', () => {
    const imported = decodeGsp(readFileSync(fixture)), st = new Store(imported.doc);
    expect(st.doc.pages.map(p => p.display?.angleUnit)).toEqual(['deg', 'rad']);
    expect(numberAt(st)).toBeCloseTo(0.5, 10);
    st.switchPage(1);
    expect(numberAt(st)).toBeCloseTo(Math.sin(30), 10);
    st.switchPage(0);
    expect(numberAt(st)).toBeCloseTo(0.5, 10);
    const saved = encodeFile(st.doc, imported.source);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(Buffer.from(saved.bytes).equals(readFileSync(fixture))).toBe(true);
  });

  it('完整重编码及新版格式都保留每一页的单位', () => {
    const st = new Store();
    st.add({ k: 'calc', expr: { t: 'fn', name: 'sin', a: { t: 'num', v: 30 } }, unit: 'none' }, { at: { x: 10, y: 5 } });
    st.doc.settings.display = { ...DEFAULT_DISPLAY };
    st.doc.pages[0].display = { angleUnit: 'deg' };
    const second = structuredClone(st.doc.pages[0]);
    second.name = '2'; second.display = { angleUnit: 'rad' }; st.doc.pages.push(second);
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw new Error(encoded.reason);
    const result = decodeGsp(encoded.bytes).doc;
    expect(result.pages.map(p => p.display?.angleUnit)).toEqual(['deg', 'rad']);
    expect(compareContent(st.doc, result)).toEqual([]);
    expect(decodeFile(encodeNgsp(st.doc), 'x.ngsp').doc.pages.map(p => p.display?.angleUnit)).toEqual(['deg', 'rad']);
  });

  it('第一页覆盖单位时按实际页设置保存，同时保留其余页的单位', () => {
    const st = new Store();
    st.add({ k: 'calc', expr: { t: 'fn', name: 'sin', a: { t: 'num', v: 30 } }, unit: 'none' }, { at: { x: 10, y: 5 } });
    st.doc.settings.display = { ...DEFAULT_DISPLAY };
    st.doc.pages[0].display = { angleUnit: 'rad' };
    const second = structuredClone(st.doc.pages[0]); second.name = '2'; second.display = { angleUnit: 'deg' }; st.doc.pages.push(second);
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw new Error(encoded.reason);
    const decoded = decodeGsp(encoded.bytes).doc;
    expect(decoded.pages.map(p => p.display?.angleUnit)).toEqual(['rad', 'deg']);
    expect(compareContent(st.doc, decoded)).toEqual([]);
  });

  it('只有页面单位、没有旧文档设置时也可以无损写回', () => {
    const st = new Store();
    st.add({ k: 'calc', expr: { t: 'fn', name: 'sin', a: { t: 'num', v: 30 } }, unit: 'none' }, { at: { x: 10, y: 5 } });
    st.page.display = { angleUnit: 'rad' };
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw new Error(encoded.reason);
    const decoded = decodeGsp(encoded.bytes).doc;
    expect(compareContent(st.doc, decoded)).toEqual([]);
    expect(decoded.settings.display?.angleUnit).toBe('rad');
  });

  const precision = resolve(import.meta.dirname, '../../reference/raw/runtime/interop-evidence/multipage-precision-style.gsp');
  it.skipIf(!existsSync(precision))('原版参数选项实测的页级精度按距离、角度、其他顺序读取', () => {
    const doc = decodeGsp(readFileSync(precision)).doc;
    expect(pageDisplay(doc, doc.pages[0])).toMatchObject({ anglePrec: 2, distPrec: 2, otherPrec: 2 });
    expect(pageDisplay(doc, doc.pages[1])).toMatchObject({ angleUnit: 'rad', anglePrec: 3, distPrec: 4, otherPrec: 1 });
    expect(pageDisplay(doc, doc.pages[1]).textStyles).toMatchObject({ title: { name: 'Arial', size: 20, bold: true }, value: { size: 23, italic: true } });
    expect(pageDisplay(doc, doc.pages[0]).textStyles?.title).toBeUndefined();
    expect(pageDisplay(doc, doc.pages[0]).textStyles?.label?.italic).toBe(true);
    expect(pageDisplay(doc, doc.pages[1]).textStyles?.label?.italic).toBe(false);
    expect(pageDisplay(doc, doc.pages[1], { ...DEFAULT_DISPLAY, mathItalic: true }).mathItalic).toBe(true);
    expect(pageDisplay(doc, doc.pages[1], { ...DEFAULT_DISPLAY, mathItalic: false }).mathItalic).toBe(false);
  });

  it('重编码时保留各页的独立默认精度', () => {
    const st = new Store();
    st.add({ k: 'calc', expr: { t: 'num', v: 0.5 }, unit: 'none' }, { at: { x: 10, y: 5 } });
    st.doc.settings.display = { ...DEFAULT_DISPLAY };
    st.page.display = { angleUnit: 'deg', anglePrec: 2, distPrec: 2, otherPrec: 2 };
    const second = structuredClone(st.page); second.name = '2';
    second.display = { angleUnit: 'rad', anglePrec: 3, distPrec: 4, otherPrec: 1,
      textStyles: { label: { italic: false }, title: { name: 'Arial', size: 20, bold: true } } }; st.doc.pages.push(second);
    const result = encodeFile(st.doc, undefined);
    if (!result.ok) throw new Error(result.reason);
    const decoded = decodeGsp(result.bytes).doc;
    expect(pageDisplay(decoded, decoded.pages[1])).toMatchObject({ angleUnit: 'rad', anglePrec: 3, distPrec: 4, otherPrec: 1 });
    expect(pageDisplay(decoded, decoded.pages[1]).textStyles).toMatchObject({ title: { name: 'Arial', size: 20, bold: true } });
    expect(compareContent(st.doc, decoded)).toEqual([]);
  });

  const written = resolve(import.meta.dirname, '../../reference/raw/runtime/interop-evidence/multipage-angle-written.gsp');
  const resaved = resolve(import.meta.dirname, '../../reference/raw/runtime/interop-evidence/multipage-angle-written-resaved.gsp');
  it.skipIf(!existsSync(written) || !existsSync(resaved))('新版写出的各页单位与标签字体斜体经原版另存仍保留', () => {
    const before = decodeGsp(readFileSync(written)).doc, after = decodeGsp(readFileSync(resaved)).doc;
    expect(before.pages.map(p => p.display?.angleUnit)).toEqual(['deg', 'rad']);
    expect(after.pages.map(p => p.display?.angleUnit)).toEqual(['deg', 'rad']);
    expect(before.settings.display?.textStyles?.label?.italic).toBe(true);
    expect(after.settings.display?.textStyles?.label?.italic).toBe(true);
  });
  const styleWritten = resolve(import.meta.dirname, '../../reference/raw/runtime/interop-evidence/multipage-style-written.gsp');
  const styleResaved = resolve(import.meta.dirname, '../../reference/raw/runtime/interop-evidence/multipage-style-written-resaved.gsp');
  it.skipIf(!existsSync(styleWritten) || !existsSync(styleResaved))('各页精度和文本样式经原版另存后保留', () => {
    const before = decodeGsp(readFileSync(styleWritten)).doc, after = decodeGsp(readFileSync(styleResaved)).doc;
    // 原版另存会补写页设置 10005（数学标签用斜体），夹具写出时没有该记录：比较时忽略“是否取自文件”的标记，数值本身仍须相同。
    const plain = (doc: typeof before) => doc.pages.map(p => { const { mathItalicKnown: _known, ...rest } = pageDisplay(doc, p); return rest; });
    expect(plain(before)).toEqual(plain(after));
    expect(pageDisplay(after, after.pages[1])).toMatchObject({ angleUnit: 'rad', anglePrec: 3, distPrec: 4, otherPrec: 1,
      textStyles: { title: { name: 'Arial', size: 20, bold: true }, value: { size: 23, italic: true } } });
  });
});
