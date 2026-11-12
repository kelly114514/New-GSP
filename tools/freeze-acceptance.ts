/** 冻结验收文档：由新版自己构造的课件（不含原版任何内容），写到 acceptance/，并生成 manifest.json。
 * manifest 记录每个文档的格式、页数、页名、对象种类统计和每个对象的求值摘要；tests/acceptance.test.ts 读回比对。
 * 用法：npx tsx tools/freeze-acceptance.ts   （只在有意改变验收基线时运行，之后要在 docs/测试报告.md 里说明为什么变）
 * originalRoundtrip：该文档（或包含它的 interop-all）已经用原版打开、另存并由新版读回一致（reference/raw/runtime/interop_roundtrip.py）。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSystem } from '../src/core/construct';
import { evaluatePage } from '../src/core/engine';
import type { Doc } from '../src/core/model';
import { Store } from '../src/core/store';
import { encodeGsp, encodeNgsp } from '../src/gsp/codec';
import { buildAll, makePng } from './make-interop';
import { buildDemo } from './make-demo';

export interface ManifestEntry { file: string; format: 'gsp' | 'ngsp'; pages: number; pageNames: string[]; objects: number; kinds: Record<string, number>; digest: string[][]; originalRoundtrip: boolean; note: string }

/** 对象的求值摘要：种类 + 状态 + 关键数值（保留 2 位小数）。 */
export function digestDoc(doc: Doc): string[][] {
  return doc.pages.map(p => {
    const res = evaluatePage(p, undefined, undefined, { angleUnit: doc.settings.display?.angleUnit });
    const r2 = (v: number) => (Math.round(v * 100) / 100).toString();
    return p.objects.map(o => {
      const r = res.get(o.id), s = r?.shape as Record<string, unknown> | undefined;
      let v = '';
      if (s) {
        if (s.k === 'pt') v = `(${r2((s.p as { x: number }).x)},${r2((s.p as { y: number }).y)})`;
        else if (s.k === 'num') v = r2((s.q as { v: number }).v);
        else if (s.k === 'coords') v = `(${r2(s.x as number)},${r2(s.y as number)})`;
        else if (s.k === 'text') v = String(s.text);
        else v = String(s.k);
      }
      return `${o.def.k}|${r?.status ?? '-'}|${v}`;
    });
  });
}

function entry(file: string, doc: Doc, format: 'gsp' | 'ngsp', roundtrip: boolean, note: string): ManifestEntry {
  const kinds: Record<string, number> = {};
  for (const p of doc.pages) for (const o of p.objects) kinds[o.def.k] = (kinds[o.def.k] ?? 0) + 1;
  return { file, format, pages: doc.pages.length, pageNames: doc.pages.map(p => p.name), objects: doc.pages.reduce((n, p) => n + p.objects.length, 0), kinds, digest: digestDoc(doc), originalRoundtrip: roundtrip, note };
}

function extra(): { name: string; build: (st: Store) => void; note: string }[] {
  return [
    { name: '空白文档', build: () => undefined, note: '没有任何对象' },
    { name: '多页与页名', note: '两页，页名“首页”“第二页ABC”（原版互读：页名、页数一致）', build: st => { st.run('p', () => { const a = st.add({ k: 'free', x: 200, y: 200 }), b = st.add({ k: 'free', x: 400, y: 200 }); st.add({ k: 'seg', a: a.id, b: b.id }); }); st.doc.pages[0].name = '首页'; const p2 = JSON.parse(JSON.stringify(st.doc.pages[0])); p2.name = '第二页ABC'; st.doc.pages.push(p2); } },
    { name: '隐藏显示按钮组合', note: '隐藏/显示/切换 × 淡入淡出 × 显示后选定', build: st => { st.run('b', () => { const pts = [0, 1, 2, 3, 4, 5].map(i => st.add({ k: 'free', x: 80 + 60 * i, y: 150 }).id); const cases = [['hide', 'hide', false, false], ['show', 'show', true, false], ['toggle', 'hide', true, true], ['toggle', 'show', false, true], ['hide', 'hide', true, true], ['show', 'show', false, false]] as const; cases.forEach((c, i) => st.add({ k: 'button', action: { type: 'hideshow', targets: [pts[i]], mode: c[0], first: c[1], fade: c[2], select: c[3] }, text: `按钮${i + 1}`, at: { x: 20 + 100 * i, y: 300 }, w: 90, h: 28 })); }); } },
    { name: '移动与动画按钮', note: '四档移动速度、移到初始位置、动画的速度/方向/只播放一次、滚动到窗口中央', build: st => { st.run('b', () => { const a = st.add({ k: 'free', x: 100, y: 100 }), b = st.add({ k: 'free', x: 300, y: 100 }), s = st.add({ k: 'seg', a: a.id, b: b.id }); const p = st.add({ k: 'onpath', path: s.id, t: 0.3 }); (['slow', 'medium', 'fast', 'high'] as const).forEach((sp, i) => st.add({ k: 'button', action: { type: 'move', from: a.id, to: b.id, speed: sp, ...(i % 2 ? { toInitial: true } : {}) }, text: `移${i}`, at: { x: 20 + 90 * i, y: 300 }, w: 80, h: 28 })); (['forward', 'backward', 'bounce', 'random'] as const).forEach((d, i) => st.add({ k: 'button', action: { type: 'animate', targets: [p.id], speed: i % 2 ? 'fast' : 'slow', direction: d, ...(i === 1 ? { once: true } : {}) }, text: `动${i}`, at: { x: 20 + 90 * i, y: 340 }, w: 80, h: 28 })); st.add({ k: 'button', action: { type: 'scroll', point: a.id, where: 'center' }, text: '滚动', at: { x: 20, y: 380 }, w: 80, h: 28 }); }); } },
    { name: '两幅 PNG 图片', note: '不同尺寸、其中一幅缩放显示', build: st => { st.run('i', () => { st.add({ k: 'image', data: makePng(41, 23, [200, 30, 30]), mime: 'image/png', at: { x: 100, y: 100 }, w: 41, h: 23 }); st.add({ k: 'image', data: makePng(30, 30, [30, 30, 200]), mime: 'image/png', at: { x: 200, y: 100 }, w: 60, h: 45 }); }); } },
    { name: '变换链', note: '平移、旋转（固定/取自度量）、缩放、反射的串联', build: st => { st.run('t', () => { const A = st.add({ k: 'free', x: 200, y: 200 }), C = st.add({ k: 'free', x: 300, y: 300 }), M = st.add({ k: 'free', x: 400, y: 150 }), N = st.add({ k: 'free', x: 400, y: 250 }); const pa = st.add({ k: 'param', name: 'ang', value: 40, unit: 'angle', showEdit: true }, { at: { x: 20, y: 20 }, label: 'ang' }); const r1 = st.add({ k: 'rotate', src: A.id, center: C.id, angle: { mode: 'value', m: pa.id } }); const r2 = st.add({ k: 'rotate', src: r1.id, center: C.id, angle: { mode: 'fixed', deg: 30 } }); st.add({ k: 'dilate', src: r2.id, center: C.id, ratio: { mode: 'fixed', num: 1, den: 2 } }); const mir = st.add({ k: 'line', a: M.id, b: N.id }); st.add({ k: 'reflect', src: A.id, mirror: mir.id }); }); } },
    { name: '坐标系与函数', note: '坐标系、函数、函数图像、坐标度量、方程度量', build: st => { st.run('f', () => { const sys = createSystem(st); const P = st.add({ k: 'free', x: 400, y: 300 }); const L = st.add({ k: 'line', a: st.add({ k: 'free', x: 300, y: 350 }).id, b: P.id }); st.add({ k: 'measure', m: 'coords', refs: [P.id, sys.id] }, { at: { x: 20, y: 20 } }); st.add({ k: 'measure', m: 'equation', refs: [L.id, sys.id] }, { at: { x: 20, y: 50 } }); }); } },
  ];
}

if (process.argv[1]?.includes('freeze-acceptance')) {
  const out = 'acceptance';
  mkdirSync(out, { recursive: true });
  const ran = new Set(['all', 'n-eq', 'n-table', 'n-call', 'n-rotv']);   // 已跑过原版互读的部分（interop-all 含全部对象）
  const entries: ManifestEntry[] = [];
  const add = (file: string, doc: Doc, format: 'gsp' | 'ngsp', rt: boolean, note: string) => {
    writeFileSync(join(out, file), format === 'gsp' ? encodeGsp(doc) : encodeNgsp(doc));
    entries.push(entry(file, doc, format, rt, note));
  };
  add('00-全部对象.gsp', buildAll().doc, 'gsp', true, '全对象族互读样本：点线圆、变换、度量、参数计算函数、坐标系、表格、方程度量、图片、按钮');
  let n = 1;
  for (const part of ['params', 'calc', 'func', 'plot', 'pv', 'n-poly', 'n-arc', 'n-disk', 'n-trans', 'n-dil', 'n-fn', 'n-text', 'n-btn', 'n-table', 'n-coords', 'n-img', 'n-eq', 'n-rotv', 'n-call', 'n-link', 'n-locus']) {
    add(`${String(n++).padStart(2, '0')}-${part}.gsp`, buildAll([part]).doc, 'gsp', ran.has(part), `buildAll 的 ${part} 部分（每个文档都带基础几何对象）`);
  }
  add(`${String(n++).padStart(2, '0')}-空白点线.gsp`, buildAll([]).doc, 'gsp', false, '只有基础几何对象');
  for (const x of extra()) { const st = new Store(); x.build(st); add(`${String(n++).padStart(2, '0')}-${x.name}.gsp`, st.doc, 'gsp', x.name === '多页与页名', x.note); }
  const demo = buildDemo();
  add(`${String(n++).padStart(2, '0')}-演示课件.ngsp`, demo.doc, 'ngsp', false, '演示课件（两页，含表格、图片、文本、按钮、动画），新版课件格式');
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), note: '新版自己构造的验收课件；不含原版的任何内容。originalRoundtrip=已在原版中打开另存并读回一致。', entries }, null, 1));
  console.log(`写出 ${entries.length} 个验收文档到 ${out}/`);
}
