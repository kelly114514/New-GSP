/** 原版动画与移动夹具。输出目录应位于系统临时目录。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { createSystem, dragSysUnit } from '../src/core/construct';
import { CM } from '../src/core/expr';
import { buttonSize } from '../src/core/button';
import { encodeFile, encodeGsp } from '../src/gsp/codec';
import { defaultParameterAnimation, makeParameterAnimation } from '../src/gsp/animation';

const out = process.argv[2];
if (!out) throw new Error('请提供临时输出目录');
mkdirSync(out, { recursive: true });
const presets = ['slow', 'medium', 'fast'] as const;
const custom = [0.001875, 0.3, 0.39, 0.45, 0.625, 0.75, 1.2, 2.4, 4.001, 10, 12, 72, 96, 288, 480, 1920, 7680, 307200].map(Math.fround);
for (const speed of [...presets, ...custom]) for (const kind of ['line', 'short-line', 'circle', 'small-circle', 'free', 'param'] as const) {
  const st = new Store();
  const point = (x: number, y: number) => st.add({ k: 'free', x, y }, { hidden: true }).id;
  const style = (color: string) => ({ color, width: 1, pointSize: 3 as const, dash: 'solid' as const });
  const leg = st.add({ k: 'seg', a: point(30, 100), b: point(kind === 'short-line' ? 385 : 740, 100) }, { hidden: true });
  const track = st.add({ k: 'circle', c: point(320, 260), p: point(kind === 'small-circle' ? 370 : 420, 260) }, { hidden: true });
  const line = st.add({ k: 'onpath', path: leg.id, t: 0.15 }, { style: style('#ff0000') });
  const round = st.add({ k: 'onpath', path: track.id, t: 0 }, { style: style('#0000ff') });
  if (kind === 'line' && speed === 'slow') {
    line.trace = true;
  }
  const free = st.add({ k: 'free', x: 540, y: 245 }, { style: style('#00b000') });
  const system = createSystem(st, { x: 80, y: 400 });
  const sys = system.id;
  st.page.objects.forEach(o => { if (o.id >= sys - 4 && o.id <= sys && o.id > free.id) o.hidden = true; });
  const parameter = st.add({ k: 'param', name: 'p', value: 1, unit: 'none', showEdit: true }, { hidden: kind !== 'param', at: { x: 20, y: 55 } });
  const zero = st.add({ k: 'param', name: 'q', value: 0, unit: 'none', showEdit: true }, { hidden: true });
  st.add({ k: 'plotxy', x: parameter.id, y: zero.id, sys }, { style: style('#c000c0') });
  const target = { line: line.id, 'short-line': line.id, circle: round.id, 'small-circle': round.id, free: free.id, param: parameter.id }[kind];
  const name = typeof speed === 'number' ? String(Number(speed.toPrecision(6))) : speed;
  const button = st.add({ k: 'button', text: name, at: { x: 12, y: 12 }, w: 80, h: 24,
    action: { type: 'animate', targets: [target], speed, direction: 'forward' } });
  st.page.savedSelection = [button.id];
  const bytes = encodeGsp(st.doc);
  writeFileSync(join(out, `${kind}-${name}${line.trace ? '-trace' : ''}.gsp`), bytes);
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
    if (system.def.k !== 'sys') throw new Error('夹具缺坐标系');
    dragSysUnit(st, system, system.def.unitX, { x: 280, y: 400 });
    st.page.savedSelection = [];
    const fields: [string, number, number, number, number, number][] = [
      ['base', 0, 4, 4, 0, 4], ['speed8', 0, 0.025, 4, 0, 4], ['speed12', 0, 4, 0.025, 0, 4],
      ['low', 0, 4, 4, 0.5, 4], ['high', 0, 4, 4, 0, 2], ['wide', 0, 4, 4, 0, 25600],
      ['discrete', 0x800, 4, 4, 0, 16], ['backward', 0x1000, 4, 4, 0, 4], ['bounce', 0x2000, 4, 4, 0, 4],
      ['once', 0x8000, 4, 4, 0, 16], ['random', 0x3000, 4, 4, 0, 16], ['signed', 0, 4, 4, -1, 16],
      ['once-bounce', 0xa000, 4, 4, 0, 16], ['once-discrete', 0x8800, 4, 4, 0, 16], ['once-random', 0xb000, 4, 4, 0, 16],
      ['angle', 0x400, Math.PI * 2, 4, 0, Math.PI * 8], ['distance', 0x200, CM * 128, 4, 0, CM * 512],
      ['medium', 0, 24, 24, 0, 4], ['fast', 0, 80, 80, 0, 4],
      ['default', 0, 4, 0, 0, 25600],
      ...[0.1, 0.25, 1, 2, 6, 16, 24, 80, 320, 25600].map((value): [string, number, number, number, number, number] =>
        [`scale-${value}`, 0, value, 4, -value, Math.max(value, 16)]),
    ];
    for (const [test, flags, first, second, lower, upper] of fields) {
      const def = button.def;
      if (def.k !== 'button' || def.action.type !== 'animate') throw new Error('夹具缺动画按钮');
      const record = Buffer.alloc(36);
      record.writeUInt16LE(62, 0);
      record.writeUInt16LE(flags & 0xe00, 6);
      record.writeFloatLE(second, 12);
      record.writeFloatLE(lower, 16);
      record.writeFloatLE(upper, 20);
      const direction = (['forward', 'backward', 'bounce', 'random'] as const)[(flags >> 12) & 3];
      st.update(button.id, { ...def, action: { ...def.action, speed: first, direction, once: !!(flags & 0x8000), gspOptions: record.toString('base64') } });
      if (parameter.def.k !== 'param') throw new Error('夹具缺参数');
      const unit = flags & 0x400 ? 'angle' : flags & 0x200 ? 'distance' : 'none';
      st.update(parameter.id, { ...parameter.def, unit });
      dragSysUnit(st, system, system.def.unitX, { x: unit === 'angle' ? 83 : 280, y: 400 });
      writeFileSync(join(out, `param-fields-${test}.gsp`), encodeGsp(st.doc));
      st.page.savedSelection = [button.id];
      writeFileSync(join(out, `properties-${test}.gsp`), encodeGsp(st.doc));
      st.page.savedSelection = [];
    }
    if (parameter.def.k !== 'param') throw new Error('夹具缺参数');
    for (const unit of ['none', 'angle', 'distance'] as const) {
      st.update(parameter.id, { ...parameter.def, unit });
      dragSysUnit(st, system, system.def.unitX, { x: unit === 'angle' ? 83 : 280, y: 400 });
      st.page.savedSelection = [parameter.id];
      writeFileSync(join(out, `creation-${unit}.gsp`), encodeGsp(st.doc));
      const made = new Store();
      const input = made.add({ k: 'param', name: 'p', value: 1, unit, showEdit: true }, { at: { x: 20, y: 55 } });
      const action = makeParameterAnimation([input.id], unit, 'forward', defaultParameterAnimation(unit));
      const text = '动画 p';
      made.add({ k: 'button', text, at: { x: 12, y: 12 }, ...buttonSize(text), action });
      const saved = encodeFile(made.doc, undefined);
      if (!saved.ok) throw new Error(saved.reason);
      writeFileSync(join(out, `created-${unit}.gsp`), saved.bytes);
    }
  }
}

for (const speed of [...presets, 'high'] as const) for (const distance of [90, 270]) {
  const st = new Store();
  const a = st.add({ k: 'free', x: 80, y: 100 }, { style: { color: '#ff0000', width: 1, pointSize: 3, dash: 'solid' } });
  const b = st.add({ k: 'free', x: 80 + distance, y: 100 }, { hidden: true });
  st.add({ k: 'button', text: 'Move', at: { x: 12, y: 12 }, w: 80, h: 24,
    action: { type: 'move', from: a.id, to: b.id, speed } });
  writeFileSync(join(out, `move-${speed}-${distance}.gsp`), encodeGsp(st.doc));
}
