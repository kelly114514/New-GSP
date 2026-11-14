/** 第十七轮原版动画夹具。输出目录应位于系统临时目录。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { createSystem } from '../src/core/construct';
import { encodeGsp } from '../src/gsp/codec';

const out = process.argv[2];
if (!out) throw new Error('请提供临时输出目录');
mkdirSync(out, { recursive: true });
for (const speed of ['slow', 'medium', 'fast'] as const) for (const kind of ['line', 'circle', 'free', 'param'] as const) {
  const st = new Store();
  const point = (x: number, y: number) => st.add({ k: 'free', x, y }, { hidden: true }).id;
  const style = (color: string) => ({ color, width: 1, pointSize: 3 as const, dash: 'solid' as const });
  const leg = st.add({ k: 'seg', a: point(30, 100), b: point(740, 100) }, { hidden: true });
  const track = st.add({ k: 'circle', c: point(320, 260), p: point(420, 260) }, { hidden: true });
  const line = st.add({ k: 'onpath', path: leg.id, t: 0.15 }, { style: style('#ff0000') });
  const round = st.add({ k: 'onpath', path: track.id, t: 0 }, { style: style('#0000ff') });
  if (kind === 'line' && speed === 'slow') {
    line.trace = true;
  }
  const free = st.add({ k: 'free', x: 540, y: 245 }, { style: style('#00b000') });
  const sys = createSystem(st, { x: 80, y: 400 }).id;
  st.page.objects.forEach(o => { if (o.id >= sys - 4 && o.id <= sys && o.id > free.id) o.hidden = true; });
  const parameter = st.add({ k: 'param', name: 'p', value: 1, unit: 'none', showEdit: true }, { hidden: kind !== 'param', at: { x: 20, y: 55 } });
  const zero = st.add({ k: 'param', name: 'q', value: 0, unit: 'none', showEdit: true }, { hidden: true });
  st.add({ k: 'plotxy', x: parameter.id, y: zero.id, sys }, { style: style('#c000c0') });
  const target = { line: line.id, circle: round.id, free: free.id, param: parameter.id }[kind];
  const button = st.add({ k: 'button', text: speed, at: { x: 12, y: 12 }, w: 80, h: 24,
    action: { type: 'animate', targets: [target], speed, direction: 'forward' } });
  st.page.startupButtons = [button.id];
  const bytes = encodeGsp(st.doc);
  writeFileSync(join(out, `${kind}-${speed}${line.trace ? '-trace' : ''}.gsp`), bytes);
  if (line.trace) {
    line.trace = false;
    writeFileSync(join(out, `${kind}-${speed}.gsp`), encodeGsp(st.doc));
  }
  // 0912 的参数动画记录还含两个值为 4 的字段。复制这组字段可在原版驱动数值探针移动。
  if (kind === 'param' && speed === 'slow') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 4; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset, true), tag = view.getUint32(offset + 4, true);
      if (tag === 2003 && size === 36 && view.getUint16(offset + 8, true) === 62) {
        for (const rate of [0.025, 0.1, 0.25]) {
          const copy = bytes.slice(), record = new DataView(copy.buffer, copy.byteOffset + offset + 8, size);
          record.setUint16(6, 0x2000, true);
          record.setFloat32(8, rate, true);
          record.setFloat32(12, 4, true);
          record.setFloat32(20, 4, true);
          writeFileSync(join(out, `param-native-${rate}.gsp`), copy);
        }
        break;
      }
      offset += 8 + size;
    }
  }
}
