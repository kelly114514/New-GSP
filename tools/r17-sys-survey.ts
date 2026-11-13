/** 第十七轮调查：导出每份课件当前页的坐标系原点、单位长度（页面像素）和视图尺寸，供对照原版截图里的刻度间隔。
 * 用法：npx tsx tools/r17-sys-survey.ts 列表.txt 输出.json */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
import { evaluatePage } from '../src/core/engine';
import { pageDisplay } from '../src/core/model';

const items = readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const out: Record<string, unknown> = {};
items.forEach((path, i) => {
  if (!path) return;
  const key = String(i).padStart(4, '0');
  try {
    const doc = decodeGsp(new Uint8Array(readFileSync(path))).doc;
    const pg = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)];
    const sysObjs = pg.objects.filter(o => o.def.k === 'sys');
    if (!sysObjs.length) return;
    const t0 = Date.now();
    const res = evaluatePage(pg, undefined, undefined, { angleUnit: pageDisplay(doc, pg).angleUnit, view: { x0: pg.scroll?.x ?? 0, y0: pg.scroll?.y ?? 0, x1: (pg.scroll?.x ?? 0) + 1190, y1: (pg.scroll?.y ?? 0) + 636 } });
    const list = sysObjs.map(o => {
      const s = res.get(o.id)?.shape;
      if (s?.k !== 'sys' || o.def.k !== 'sys') return undefined;
      return { grid: o.def.grid, piX: !!o.def.piX, piY: !!o.def.piY, origin: s.origin, ux: s.ux, uy: s.uy, hiddenAxes: false };
    }).filter(Boolean);
    out[key] = { scroll: pg.scroll, systems: list, ms: Date.now() - t0 };
  } catch (e) { out[key] = { error: String(e).slice(0, 80) }; }
});
writeFileSync(process.argv[3], JSON.stringify(out));
console.log('systems in', Object.keys(out).length, 'documents');
