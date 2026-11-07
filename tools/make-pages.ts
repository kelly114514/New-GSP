/** 多页 + 页名互读样本（原版打开另存后用 check-pages 比较页名与对象数）。用法：make-pages 输出 [第二页保留的对象个数] */
import { writeFileSync } from 'node:fs';
import { Store } from '../src/core/store';
import { encodeGsp } from '../src/gsp/codec';

const st = new Store();
st.run('p', () => { const a = st.add({ k: 'free', x: 200, y: 200 }), b = st.add({ k: 'free', x: 400, y: 200 }); st.add({ k: 'seg', a: a.id, b: b.id }); });
st.doc.pages[0].name = '首页';
const mode = process.argv[3] ?? '3';
const p2 = { ...JSON.parse(JSON.stringify(st.doc.pages[0])), name: '第二页ABC' };
if (mode === 'p1empty') { st.doc.pages[0].objects = []; } else p2.objects = p2.objects.slice(0, Number(mode));
st.doc.pages.push(p2);
writeFileSync(process.argv[2], encodeGsp(st.doc));
