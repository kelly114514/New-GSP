/** 打印与打印预览：把页面渲染到离屏画布，再切成一张张纸交给系统打印。
 * 比例 100 表示正好放进一页，更大就铺到多张纸上（原版实测 probe_bigprint2：100 → “1页”，200 → “1页-2页”，内容跨过纸边继续）。 */
import { drawPage } from './render';
import type { DocView } from './docview';
import type { Page } from '../core/model';
import { evaluatePage } from '../core/engine';

/** 页面上是否有可打印的内容（原版空白文档会提示，不进预览）。 */
export function hasPrintable(page: Page): boolean { return page.objects.some(o => !o.hidden); }

const PAPER_MM: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A5: [148, 210], B5: [176, 250], Letter: [216, 279], Legal: [216, 356] };
export const PAPERS = Object.keys(PAPER_MM);
const PX_PER_MM = 96 / 25.4;
const paperOf = (v: DocView) => { const p = v.store.doc.paper; const [w, h] = PAPER_MM[p.size ?? 'A4'] ?? PAPER_MM.A4; return { name: p.size ?? 'A4', w: p.landscape ? h : w, h: p.landscape ? w : h, landscape: p.landscape, margin: p.marginMm }; };

interface Chart { canvas: HTMLCanvasElement; w: number; h: number; k: number }   // w、h 是页面（逻辑像素）大小，k 是画布像素 / 逻辑像素

/** 把一页上所有可见内容画到一张画布上（含四周留白）。 */
function renderChart(v: DocView, maxSide: number, pageIndex?: number): Chart {
  const st = v.store, page = pageIndex !== undefined ? st.doc.pages[pageIndex] : st.page;
  const results = page === st.page ? st.results : evaluatePage(page, undefined, undefined, st.ctx);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const o of page.objects) {
    if (o.hidden) continue;
    const s = results.get(o.id)?.shape; if (!s) continue;
    if (s.k === 'pt') grow(s.p.x, s.p.y);
    else if (s.k === 'line' && s.s.ext === 'segment') { grow(s.s.a.x, s.s.a.y); grow(s.s.b.x, s.s.b.y); }
    else if (s.k === 'circle') { grow(s.c.c.x - s.c.r, s.c.c.y - s.c.r); grow(s.c.c.x + s.c.r, s.c.c.y + s.c.r); }
    else if (s.k === 'arc' || s.k === 'sector' || s.k === 'disk') { const c = s.k === 'arc' || s.k === 'sector' ? s.c : s.c; const r = s.r; grow(c.x - r, c.y - r); grow(c.x + r, c.y + r); }
    else if (s.k === 'poly') s.pts.forEach(p => grow(p.x, p.y));
    else if (s.k === 'paths') s.paths.forEach(pa => pa.forEach(p => grow(p.x, p.y)));
    else if (s.k === 'box') { grow(s.at.x, s.at.y); grow(s.at.x + s.w, s.at.y + s.h); }
    else if (o.at) { grow(o.at.x, o.at.y); grow(o.at.x + 200, o.at.y + 24); }
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 400; y1 = 300; }
  const pad = 20; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  x0 = Math.max(x0, v.scroll.x - 4000); y0 = Math.max(y0, v.scroll.y - 4000);
  x1 = Math.min(x1, x0 + 8000); y1 = Math.min(y1, y0 + 8000);
  const w = Math.max(100, Math.ceil(x1 - x0)), h = Math.max(100, Math.ceil(y1 - y0));
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  drawPage(ctx, page, results, { selection: new Set(), hideHidden: true, view: { x0, y0, x1, y1 } });
  return { canvas: c, w, h, k };
}

export function renderPageImage(v: DocView, maxSide = 3000, pageIndex?: number): { url: string; w: number; h: number } {
  const c = renderChart(v, maxSide, pageIndex);
  return { url: c.canvas.toDataURL('image/png'), w: c.w, h: c.h };
}

/** 版面：scalePct = 100 时按“适应页面”（不放大超过原大小），其它是它的倍数；返回纸张可用区域、行列数和每张纸的图。 */
function layout(chart: Chart, paper: ReturnType<typeof paperOf>, scalePct: number) {
  const availW = (paper.w - 2 * paper.margin) * PX_PER_MM, availH = (paper.h - 2 * paper.margin) * PX_PER_MM;
  const fit = Math.min(availW / chart.w, availH / chart.h, 1), s = fit * (scalePct / 100);
  const cols = Math.max(1, Math.ceil((chart.w * s) / availW - 1e-6)), rows = Math.max(1, Math.ceil((chart.h * s) / availH - 1e-6));
  return { availW, availH, s, cols, rows, fit };
}
function tiles(chart: Chart, lay: ReturnType<typeof layout>): string[] {
  const out: string[] = [], SS = 2, tw = Math.round(lay.availW * SS), th = Math.round(lay.availH * SS);
  const sw = (lay.availW / lay.s) * chart.k, sh = (lay.availH / lay.s) * chart.k;   // 每张纸对应源画布上的区域
  for (let r = 0; r < lay.rows; r++) for (let c = 0; c < lay.cols; c++) {
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    const g = t.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, tw, th);
    const cw = Math.min(sw, chart.canvas.width - c * sw), ch = Math.min(sh, chart.canvas.height - r * sh);
    if (cw > 0 && ch > 0) g.drawImage(chart.canvas, c * sw, r * sh, cw, ch, 0, 0, (cw / sw) * tw, (ch / sh) * th);
    out.push(t.toDataURL('image/png'));
  }
  return out;
}

export function printDocument(v: DocView, preview: boolean) {
  if (!hasPrintable(v.store.page)) { void v.app.dlg.message('这一页没有可以打印的内容。'); return; }
  const paper = paperOf(v);
  let scalePct = 100, zoom = 1, pageIdx = v.store.doc.current;
  const run = () => {
    const chart = renderChart(v, 3000, pageIdx), lay = layout(chart, paper, scalePct), imgs = tiles(chart, lay);
    const root = document.createElement('div'); root.id = 'printroot';
    const style = document.createElement('style');
    style.textContent = `@page{size:${paper.name} ${paper.landscape ? 'landscape' : 'portrait'};margin:${paper.margin}mm}@media print{body>*:not(#printroot):not(#printpreview){display:none!important}#printroot{display:block!important}#printroot img{display:block;width:100%;height:auto}#printroot .tile{break-after:page}#printroot .tile:last-child{break-after:auto}.pvbar{display:none!important}#printpreview{position:static!important;background:none!important}}`;
    root.append(style);
    for (const u of imgs) { const d = document.createElement('div'); d.className = 'tile'; const im = document.createElement('img'); im.src = u; d.append(im); root.append(d); }
    document.body.append(root);
    window.setTimeout(() => { window.print(); if (!(window as unknown as { __keepPrintRoot?: boolean }).__keepPrintRoot) root.remove(); }, 50);   // __keepPrintRoot：自动化测试用，留着打印内容好导出 PDF
  };
  if (!preview) { run(); return; }

  const back = document.createElement('div'); back.id = 'printpreview';
  const bar = document.createElement('div'); bar.className = 'pvbar';
  const mk = (t: string, tip: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = tip; b.onclick = fn; bar.append(b); return b; };
  const scroller = document.createElement('div'); scroller.className = 'pvscroll';
  const sheets = document.createElement('div'); sheets.className = 'pvsheets'; scroller.append(sheets);
  const step = (d: number) => { const s = sheets.children[0] as HTMLElement | undefined; if (s) scroller.scrollBy({ left: d * (s.offsetWidth + 24), behavior: 'auto' }); };
  const next = mk('→', '下一页', () => step(1)), prev = mk('←', '上一页', () => step(-1));
  const zin = mk('放大', '放大预览', () => { zoom = Math.min(4, zoom * 1.25); draw(); }), zout = mk('缩小', '缩小预览', () => { zoom = Math.max(0.25, zoom / 1.25); draw(); });
  const fit = mk('调整到页面大小(F)', '比例回到 100：正好放进一页', () => { scalePct = 100; zoom = 1; draw(); });
  const lab = document.createElement('label'); lab.className = 'pvscale'; lab.append('比例：');
  const pct = document.createElement('input'); pct.type = 'text'; pct.style.width = '48px';
  pct.onchange = () => { const n = Number(pct.value.replace('%', '')); if (Number.isFinite(n) && n >= 10 && n <= 1000) scalePct = n; draw(); };
  lab.append(pct); bar.append(lab);
  const bigLab = document.createElement('label'); bigLab.className = 'pvbig'; bigLab.title = '本版暂缓：原版里这个选项在比例 100 和 200 时都是灰的，启用条件没有查清';
  const big = document.createElement('input'); big.type = 'checkbox'; big.disabled = true; bigLab.append(big, '打印大图表(L)'); bar.append(bigLab);
  mk('打印(P)…', '打印', () => run());
  mk('关闭(C)', '关闭预览', () => back.remove());
  const status = document.createElement('div'); status.className = 'pvstatus';
  const draw = () => {
    const pages = v.store.doc.pages;
    pageIdx = Math.max(0, Math.min(pages.length - 1, pageIdx));
    const chart = renderChart(v, 3000, pageIdx), lay = layout(chart, paper, scalePct), imgs = tiles(chart, lay);
    sheets.replaceChildren(...imgs.map(u => {
      const sheet = document.createElement('div'); sheet.className = 'pvsheet';
      const m = paper.margin * PX_PER_MM * zoom;
      Object.assign(sheet.style, { width: `${paper.w * PX_PER_MM * zoom}px`, height: `${paper.h * PX_PER_MM * zoom}px`, padding: `${m}px` });
      const im = document.createElement('img'); im.src = u; Object.assign(im.style, { width: `${lay.availW * zoom}px`, height: `${lay.availH * zoom}px` }); sheet.append(im); return sheet;
    }));
    if (document.activeElement !== pct) pct.value = String(Math.round(scalePct));
    status.textContent = imgs.length > 1 ? `1页-${imgs.length}页` : '1页';
    prev.disabled = next.disabled = imgs.length < 2;
    fit.disabled = scalePct === 100 && zoom === 1;
    zout.disabled = zoom <= 0.25; zin.disabled = zoom >= 4;
  };
  back.append(bar, scroller, status); document.body.append(back);
  draw();
}
