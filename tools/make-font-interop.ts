/** 在系统临时目录生成两页夹具，用原版打开并另存后交给 check-interop。 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_DISPLAY, emptyPage, type FontSpec } from '../src/core/model';
import { Store } from '../src/core/store';
import { encodeFile } from '../src/gsp/codec';

const output = process.argv[2];
if (!output) throw new Error('请指定系统临时目录内的输出文件');
const st = new Store();
const font = (name: string): FontSpec => ({ name, size: 18, bold: false, italic: false, underline: false, color: '#000000' });
st.doc.pages.push(emptyPage('字体二'));
st.doc.settings.display = { ...DEFAULT_DISPLAY, textStyles: { title: font('Microsoft YaHei') } };
st.doc.pages[1].display = { textStyles: { title: font('SimSun') } };
for (const [page, names] of [['SimSun', 'SimHei', 'KaiTi', 'Symbol'], ['Microsoft YaHei', 'Trebuchet MS', 'Arial', 'Segoe UI']].entries()) {
  st.doc.current = page;
  for (const [i, name] of names.entries()) {
    const at = { x: 48, y: 50 + i * 60 }, face = font(name);
    const text = name === 'Symbol' ? 'abg' : '字体 ABC';
    st.add({ k: 'text', text, at, w: 160, h: 30, font: face });
    st.add({ k: 'free', x: 240, y: at.y }, { label: String.fromCharCode(65 + i), labelShown: true, font: face });
    st.add({ k: 'text', text: 'x' + text, at: { x: 300, y: at.y }, w: 160, h: 30, font: font('Arial'),
      runs: [{ text: 'x', font: font('Arial') }, { text, font: face }] });
  }
}
st.doc.current = 0;
const saved = encodeFile(st.doc, undefined);
if (!saved.ok) throw new Error(saved.reason);
writeFileSync(output, saved.bytes);
