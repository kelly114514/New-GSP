/** 用正式保存入口生成几何变换夹具，供原版另存和绘图区复核。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Store } from '../src/core/store';
import { encodeFile } from '../src/gsp/codec';

if (!process.argv[2]) throw Error('请指定系统临时目录');
const out = resolve(process.argv[2]);
const rel = relative(tmpdir(), out);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('夹具须放在系统临时目录的子目录');
mkdirSync(out, { recursive: true });

for (const kind of ['arc', 'sector', 'segment', 'bisector'] as const) {
  const st = new Store();
  const point = (x: number, y: number) => st.add({ k: 'free', x, y }, { hidden: true }).id;
  const c = point(160, 160), a = point(230, 160), b = point(160, 90);
  const destination = point(320, 210);
  const mirror = st.add({ k: 'line', a: point(390, 80), b: point(390, 360) }, { hidden: true }).id;
  const outline = kind === 'bisector'
    ? st.add({ k: 'bisect', a, v: c, b })
    : st.add({ k: 'arc-center', c, a, b }, { hidden: kind !== 'arc' });
  const base = kind === 'sector' || kind === 'segment'
    ? st.add({ k: 'arc-int', arc: outline.id, mode: kind })
    : outline;
  const translate = st.add({ k: 'translate', src: base.id, by: { mode: 'vector', from: c, to: destination } },
    { style: { ...base.style, color: '#884422', dash: 'dash', width: 3, fillAlpha: 127 / 255 } }).id;
  const rotate = st.add({ k: 'rotate', src: translate, center: destination, angle: { mode: 'fixed', deg: 90 } },
    { style: { ...base.style, color: '#224488', fillAlpha: 191 / 255 } }).id;
  const dilate = st.add({ k: 'dilate', src: rotate, center: destination, ratio: { mode: 'fixed', num: 1.5, den: 1 } },
    { style: { ...base.style, color: '#447722', fillAlpha: 127 / 255 } }).id;
  const reflect = st.add({ k: 'reflect', src: dilate, mirror }, { hidden: true, style: base.style }).id;
  const param = st.add({ k: 'param', unit: 'none', name: 'p', value: 0.25, showEdit: true }, { at: { x: 24, y: 34 } }).id;
  st.add({ k: 'colorize', src: reflect, params: [param], mode: 'color', cycle: 'one', from: 0, to: 1 },
    { style: { ...base.style, color: '#996699', fillAlpha: 191 / 255 } });
  if (kind === 'arc') st.add({ k: 'onpath', path: reflect, t: 0.25 });
  const saved = encodeFile(st.doc, undefined);
  if (!saved.ok) throw Error(`${kind}：${saved.reason}`);
  writeFileSync(join(out, `${kind}.gsp`), saved.bytes);
}

const st = new Store();
const point = (x: number, y: number) => st.add({ k: 'free', x, y }, { hidden: true }).id;
const crossing = st.add({ k: 'line', a: point(200, 120), b: point(200, 420) }).id;
const seg = st.add({ k: 'seg', a: point(100, 200), b: point(300, 200) }, { hidden: true }).id;
const c = point(260, 270), p = point(320, 270);
const circle = st.add({ k: 'circle', c, p }).id;
const axis = st.add({ k: 'axis-line', axis: 'x', mode: 'circle', unit: circle }).id;
const param = st.add({ k: 'param', unit: 'none', name: 'p', value: 0.25, showEdit: true }, { at: { x: 24, y: 34 } }).id;
const color = (src: number) => st.add({ k: 'colorize', src, params: [param], mode: 'color', cycle: 'one', from: 0, to: 1 }).id;
const hit = (a: number, b: number, branch: number, alternate?: true) =>
  st.add({ k: 'inter', a, b, branch, ...(alternate ? { alternate } : {}) }, { style: { color: '#c00090', pointSize: 2, width: 1, dash: 'solid' } });
hit(color(seg), crossing, 0);
hit(axis, color(circle), 1, true);
const a = point(120, 330), b = point(360, 330);
const basePath = st.add({ k: 'seg', a, b }, { hidden: true }).id;
const driver = st.add({ k: 'onpath', path: basePath, t: 0.55 }, { hidden: true }).id;
const moving = st.add({ k: 'seg', a, b: driver }, { hidden: true }).id;
const mid = st.add({ k: 'mid', seg: moving }, { hidden: true }).id;
const locus = st.add({ k: 'locus', driver, out: mid, samples: 40 }).id;
hit(color(crossing), locus, 0);
const saved = encodeFile(st.doc, undefined);
if (!saved.ok) throw Error(`intersections：${saved.reason}`);
writeFileSync(join(out, 'intersections.gsp'), saved.bytes);
