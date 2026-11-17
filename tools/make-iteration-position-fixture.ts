/** 为原版对照生成迭代位置夹具。只写到传入的系统临时目录。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constructIteration } from '../src/core/iterate';
import { Store } from '../src/core/store';
import { encodeFile } from '../src/gsp/codec';

const out = process.argv[2];
if (!out) throw new Error('请指定系统临时目录');
mkdirSync(out, { recursive: true });
for (const random of [false, true]) for (const scene of ['single', 'multi', 'path-source', 'mixed'] as const) {
  const st = new Store();
  const point = (x: number, y: number, hidden = true) => st.add({ k: 'free', x, y }, { hidden }).id;
  const track = (x: number, y: number, t: number) => {
    const path = st.add({ k: 'seg', a: point(x, y), b: point(x + 200, y) }, { hidden: true }).id;
    return st.add({ k: 'onpath', path, t }, { hidden: true }).id;
  };
  const source = scene === 'path-source' ? track(50, 80, 0.25) : point(100, 250);
  const dest = track(180, 140, 0.25);
  const second = scene === 'mixed' ? point(700, 360) : track(550, 360, 0.75);
  const side = st.add({ k: 'seg', a: source, b: point(450, 250) }, { hidden: true }).id;
  st.add({ k: 'mid', seg: side }, { style: { color: '#ff0000', pointSize: 3, dash: 'solid', width: 1 } });
  const maps = scene === 'single' || scene === 'path-source' ? [[dest]] : [[dest], [second]];
  constructIteration(st, { pre: [source], maps, depth: { fixed: 4 }, random });
  const saved = encodeFile(st.doc, undefined);
  if (!saved.ok) throw new Error(saved.reason);
  writeFileSync(join(out, `iteration-${scene}-${random ? 'random' : 'relative'}.gsp`), saved.bytes);
}
