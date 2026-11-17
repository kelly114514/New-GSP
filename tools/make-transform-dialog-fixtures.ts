/** 为原版与新版的变换对话框创建相同的临时课件和选中状态。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DEFAULT_DISPLAY, type DisplayPrefs } from '../src/core/model';
import { Store } from '../src/core/store';
import { encodeGsp } from '../src/gsp/codec';

if (!process.argv[2]) throw Error('请指定系统临时目录');
const out = resolve(process.argv[2]);
const rel = relative(tmpdir(), out);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('夹具须放在系统临时目录的子目录');
mkdirSync(out, { recursive: true });

const st = new Store();
const a = st.add({ k: 'free', x: 160, y: 150 }, { label: 'A' }).id;
const b = st.add({ k: 'free', x: 320, y: 150 }, { label: 'B' }).id;
const c = st.add({ k: 'free', x: 220, y: 270 }, { label: 'C' }).id;
const s = st.add({ k: 'seg', a, b }).id;
const t = st.add({ k: 'seg', a: b, b: c }).id;
const length = st.add({ k: 'measure', m: 'length', refs: [s] }, { at: { x: 30, y: 30 } }).id;
const ratio = st.add({ k: 'measure', m: 'ratio', refs: [s, t] }, { at: { x: 30, y: 65 } }).id;
const [translate, rotate, scale] = [36945, 36946, 36947];
const fixtures: [string, number[], number[], number[], Partial<DisplayPrefs>?][] = [
  ['none', [], [], [translate, rotate, scale]],
  ['one', [a], [], [translate, rotate, scale]],
  ['ba', [b, a], [], [rotate, scale]],
  ['segment', [s], [], [translate, rotate, scale]],
  ['other-segment', [t], [], [rotate, scale]],
  ['point-segment', [b, s], [], [rotate, scale]],
  ['mixed', [a, s, length], [], [translate, rotate, scale]],
  ['center-cancel', [b], [], [rotate, 36889, scale]],
  ['marked-center', [b], [36939, 36889], [rotate, scale]],
  ['last-of-two-centers', [a, b, s], [36939], [rotate]],
  ['marked-vector', [b, a], [36943, 36889], [translate]],
  ['last-of-three-vector-points', [a, b, c, s], [36943], [translate]],
  ['marked-angle', [a, b, c], [36941, 36889], [translate, rotate]],
  ['marked-length', [length], [36944, 36889], [translate]],
  ['marked-ratio', [ratio], [36942, 36889], [scale]],
  ['radians', [a], [], [translate, rotate], { angleUnit: 'rad' }],
  ['directed-degrees', [a], [], [rotate], { angleUnit: 'dir' }],
];
const cases = fixtures.map(([name, selection, prep, cmds, display]) => {
  st.doc.settings.display = { ...DEFAULT_DISPLAY, ...display };
  st.page.savedSelection = selection;
  const filename = `${name}.gsp`;
  writeFileSync(join(out, filename), encodeGsp(st.doc));
  return { name, filename, prep, cmds };
});
st.doc.settings.display = { ...DEFAULT_DISPLAY };
st.moveFree(c, 560, 325);
st.page.savedSelection = [s];
for (const [name, hidden] of [['nearest-center', false], ['hidden-nearest-center', true]] as const) {
  st.get(c)!.hidden = hidden;
  const filename = `${name}.gsp`;
  writeFileSync(join(out, filename), encodeGsp(st.doc));
  cases.push({ name, filename, prep: [], cmds: [rotate] });
}
const picture = new Store();
const image = picture.add({ k: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSxkAAAAASUVORK5CYII=',
  mime: 'image/png', at: { x: 260, y: 250 }, w: 160, h: 100 });
picture.page.savedSelection = [image.id];
writeFileSync(join(out, 'picture-only.gsp'), encodeGsp(picture.doc));
cases.push({ name: 'picture-only', filename: 'picture-only.gsp', prep: [], cmds: [rotate, scale] });
writeFileSync(join(out, 'dialogs.json'), JSON.stringify(cases, null, 2));
