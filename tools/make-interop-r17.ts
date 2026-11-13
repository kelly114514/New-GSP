/** 第十七轮写出端互读样本：页设置 10005（数学标签用斜体）开/关各写一份，点标签和度量名字用来对照原版画面。
 * 用法：npx tsx tools/make-interop-r17.ts 输出目录 ；生成 italic-on.gsp、italic-off.gsp。
 * 再用 reference/raw/runtime/print_native.py 输出目录 italic-on italic-off 截原版画面，开：A、x_B 斜体；关：正体。
 * 加 --check 文件.gsp：读回并打印 mathItalic（原版另存的文件也可以这样检查）。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import { decodeGsp, encodeFile } from '../src/gsp/codec';
import { DEFAULT_DISPLAY, pageDisplay } from '../src/core/model';

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const doc = decodeGsp(new Uint8Array(readFileSync(args[1]))).doc;
  console.log('mathItalic =', pageDisplay(doc, doc.pages[0]).mathItalic, 'known =', doc.settings.display?.mathItalicKnown);
} else {
  const dir = args[0];
  mkdirSync(dir, { recursive: true });
  for (const [name, on] of [['italic-on', true], ['italic-off', false]] as const) {
    const st = new Store();
    st.run('r17', () => {
      const sys = createSystem(st, { x: 200, y: 300 });
      void sys;
      const A = st.add({ k: 'free', x: 300, y: 200 }, { label: 'A', labelShown: true });
      const B = st.add({ k: 'free', x: 480, y: 260 }, { label: 'B', labelShown: true });
      st.add({ k: 'measure', m: 'distance', refs: [A.id, B.id] }, { at: { x: 40, y: 40 } });
      st.add({ k: 'measure', m: 'abscissa', refs: [B.id, sys.id] }, { at: { x: 40, y: 90 }, label: 'x[B]' });
    });
    st.doc.settings.display = { ...DEFAULT_DISPLAY, mathItalic: on };
    const encoded = encodeFile(st.doc, undefined);
    if (!encoded.ok) throw new Error(encoded.reason);
    writeFileSync(join(dir, name + '.gsp'), encoded.bytes);
    console.log(name, encoded.bytes.length, '字节');
  }
}
