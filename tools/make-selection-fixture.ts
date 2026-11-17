/** 生成第十八轮原版打开选中状态夹具，输出到系统临时目录。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Store } from '../src/core/store';
import type { ButtonAction } from '../src/core/model';
import { encodeGsp } from '../src/gsp/codec';

const out = resolve(process.argv[2]);
const location = relative(tmpdir(), out);
if (!location || location.startsWith('..') || isAbsolute(location)) throw new Error('夹具须放在系统临时目录的子目录');
mkdirSync(out, { recursive: true });
const st = new Store();
const a = st.add({ k: 'free', x: 270, y: 175 }, { style: { color: '#ff0000', pointSize: 3, width: 1, dash: 'solid' } });
const b = st.add({ k: 'free', x: 460, y: 175 });
const seg = st.add({ k: 'seg', a: a.id, b: b.id });
const caption = st.add({ k: 'text', text: '选中状态', at: { x: 100, y: 220 }, w: 100, h: 30,
  font: { name: 'Arial', size: 18, color: '#000000', bold: false, italic: false, underline: false } });
const button = (text: string, action: ButtonAction, y: number) => st.add({ k: 'button', text, action, at: { x: 40, y }, w: 100, h: 24 });
const hide = button('隐藏', { type: 'hideshow', targets: [a.id], mode: 'hide', fade: false, select: false }, 40);
const series = button('系列', { type: 'series', buttons: [hide.id], mode: 'together' }, 75);
const link = button('下一页', { type: 'link', page: 2 }, 110);
const scroll = button('滚动', { type: 'scroll', point: b.id, where: 'topleft' }, 145);
st.addPage(false);
st.add({ k: 'free', x: 75, y: 75 });
st.switchPage(0);
for (const [name, ids] of Object.entries({ none: [], objects: [a.id, seg.id, caption.id], hide: [hide.id],
  series: [series.id], link: [link.id], scroll: [scroll.id] })) {
  st.page.savedSelection = ids;
  writeFileSync(join(out, `selected-${name}.gsp`), encodeGsp(st.doc));
}
