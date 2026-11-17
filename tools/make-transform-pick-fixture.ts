/** 生成在变换对话框中点选的临时课件。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Store } from '../src/core/store';
import { encodeGsp } from '../src/gsp/codec';

if (!process.argv[2]) throw Error('请指定系统临时目录');
const out = resolve(process.argv[2]);
const rel = relative(tmpdir(), out);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('夹具须放在系统临时目录的子目录');
mkdirSync(out, { recursive: true });

const st = new Store();
const point = (x: number, y: number, label: string) =>
  st.add({ k: 'free', x, y }, { label, labelShown: true }).id;
const a = point(145, 155, 'A'), b = point(315, 155, 'B');
const c = point(175, 255, 'C'), d = point(295, 255, 'D');
const obj = point(105, 310, 'P');
const ab = st.add({ k: 'seg', a, b }).id;
const cd = st.add({ k: 'seg', a: c, b: d }).id;
const length = (ref: number, y: number) =>
  st.add({ k: 'measure', m: 'length', refs: [ref] }, { at: { x: 40, y } });
const firstDistance = length(ab, 35).id;
length(cd, 68);
const theta = st.add({ k: 'param', name: 'alpha', value: 40, unit: 'angle', showEdit: true }, { at: { x: 38, y: 103 } }).id;
st.add({ k: 'param', name: 'scale', value: 2, unit: 'none', showEdit: true }, { at: { x: 39, y: 200 } });
const mark = st.add({ k: 'angle-mark', a, v: b, b: c, count: 1, mode: 'minor',
  appearance: { size: 2, flags: 0, reserved: 0, fill: 0xfefefe } }).id;
st.page.savedSelection = [obj];
writeFileSync(join(out, 'pick.gsp'), encodeGsp(st.doc));

delete st.page.savedSelection;
for (const [dist, color] of [[{ fixed: 2 }, '#bb0077'], [{ m: firstDistance }, '#007799']] as const) {
  st.add({ k: 'translate', src: obj, by: { mode: 'polar', angle: { m: mark, marker: true }, dist } },
    { style: { color, width: 1, pointSize: 3, dash: 'solid' } });
}
writeFileSync(join(out, 'polar-marker.gsp'), encodeGsp(st.doc));

const arc = st.add({ k: 'arc-center', c: b, a, b: c }).id;
st.add({ k: 'translate', src: arc, by: { mode: 'polar', angle: { m: mark, marker: true }, dist: { fixed: 3 } } },
  { style: { color: '#7733bb', width: 2, pointSize: 1, dash: 'solid' } });
st.add({ k: 'translate', src: arc, by: { mode: 'polar', angle: { m: theta }, dist: { m: firstDistance } } },
  { style: { color: '#227733', width: 2, pointSize: 1, dash: 'solid' } });
st.add({ k: 'rotate', src: arc, center: a, angle: { mode: 'mark', m: mark } },
  { style: { color: '#aa6622', width: 2, pointSize: 1, dash: 'solid' } });
writeFileSync(join(out, 'angle-arc.gsp'), encodeGsp(st.doc));
