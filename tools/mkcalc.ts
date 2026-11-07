import { writeFileSync } from 'node:fs';
import { Store } from '../src/core/store';
import { encodeGsp } from '../src/gsp/codec';
const dir = process.argv[2];
function mk(name: string, f: (st: Store, t: number) => void) {
  const st = new Store();
  st.run('x', () => { const t = st.add({ k: 'param', name: 't', value: 2, unit: 'none', showEdit: true }, { at: { x: 10, y: 5 }, label: 't' }); f(st, t.id); });
  writeFileSync(`${dir}/${name}.gsp`, encodeGsp(st.doc));
}
mk('c-noref', st => { st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'num', v: 3 }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 10, y: 40 } }); });
mk('c-ref', (st, t) => { st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: t }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 10, y: 40 } }); });
mk('c-refonly', (st, t) => { st.add({ k: 'calc', expr: { t: 'ref', id: t }, unit: 'none' }, { at: { x: 10, y: 40 } }); });
