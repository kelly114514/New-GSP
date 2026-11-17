/** 生成选中状态夹具并汇总原版、新版的命令结果。文件均写在系统临时目录。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { App } from '../src/app';
import { createSystem } from '../src/core/construct';
import { evaluatePage, type Shape } from '../src/core/engine';
import { Store } from '../src/core/store';
import { decodeFile, encodeGsp } from '../src/gsp/codec';

declare global { interface Window { __app: App } }

const [dir, mode] = process.argv.slice(2);
if (!dir) throw new Error('请指定系统临时目录');
const out = resolve(dir);
const rel = relative(tmpdir(), out);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('夹具须放在系统临时目录的子目录');

interface Case {
  cmd: number;
  name: string;
  filename: string;
  selectionCount: number;
  before: number;
}

function makeFixtures(probes = false) {
  mkdirSync(out, { recursive: true });
  const st = new Store();
  const a = st.add({ k: 'free', x: 200, y: 150 }).id;
  const b = st.add({ k: 'free', x: 350, y: 150 }).id;
  const c = st.add({ k: 'free', x: 280, y: 240 }).id;
  const s = st.add({ k: 'seg', a, b }).id;
  const t = st.add({ k: 'seg', a, b: c }).id;
  const l = st.add({ k: 'line', a, b: c }).id;
  const m = st.add({ k: 'line', a: b, b: c }).id;
  const circle = st.add({ k: 'circle', c: a, p: b }).id;
  const arc = st.add({ k: 'arc3', a, b, c }).id;
  const poly = st.add({ k: 'poly', pts: [a, b, c] }).id;
  const p = st.add({ k: 'onpath', path: s, t: 0.3 }).id;
  const q = st.add({ k: 'onpath', path: circle, t: Math.PI / 2 }).id;
  createSystem(st, { x: 480, y: 325 });
  const cases: [number, string, number[]][] = [
    [36924, '路径上取点', [s]], [36925, '线段中点', [s]], [36926, '两直线交点', [l, m]],
    [36927, '三点连线段', [a, c, b]], [36928, '三点连射线', [a, c, b]], [36929, '三点连直线', [a, c, b]],
    [36930, '过点作平行线', [b, l]], [36931, '过点作垂线', [b, l]], [36932, '角平分线', [a, c, b]],
    [36933, '圆心及圆周点绘圆', [a, b]], [36934, '以线段为半径绘圆', [c, s]],
    [36935, '圆上构造弧', [circle, b, q]], [36936, '三点构造弧', [a, b, c]],
    [36937, '三角形内部', [a, c, b]], [36937, '圆的内部', [circle]], [36937, '弧的内部', [arc]],
    [36953, '线段长度', [s]], [36954, '两点距离', [a, b]], [36954, '点到直线距离', [b, l]],
    [36955, '三角形周长', [poly]], [36956, '圆周长', [circle]], [36957, '角度', [a, c, b]],
    [36958, '三角形面积', [poly]], [36958, '圆面积', [circle]], [36959, '弧度角', [arc]],
    [36960, '弧长', [arc]], [36961, '弧半径', [arc]], [36961, '圆半径', [circle]],
    [36962, '两线段比', [t, s]], [36963, '线段上点的值', [p]], [36964, '点的坐标', [c]],
    [36965, '点的横坐标', [c]], [36966, '点的纵坐标', [c]], [36967, '坐标距离', [a, c]],
    [36968, '直线斜率', [l]], [36969, '直线方程', [l]], [36969, '圆方程', [circle]],
  ];
  const probeCases: [number, string, number[]][] = [];
  if (probes) {
    const d = st.add({ k: 'free', x: 240, y: 280 }).id;
    const closeB = st.add({ k: 'free', x: 350, y: 150 }).id;
    const crossing = st.add({ k: 'line', a: b, b: d }).id;
    st.add({ k: 'inter', a: l, b: crossing, branch: 0 });
    st.add({ k: 'mid', seg: s });
    st.add({ k: 'circle-seg', c, seg: s });
    st.add({ k: 'arc-circle', circle, a: b, b: q });
    st.add({ k: 'parallel', pt: b, line: l });
    st.add({ k: 'perp', pt: b, line: l });
    st.add({ k: 'bisect', a, v: c, b });
    probeCases.push(
      [36924, '同一线段取点甲', [s]], [36924, '同一线段取点乙', [s]], [36924, '另一线段取点', [t]],
      [36924, '直线上取点', [l]], [36924, '圆上取点', [circle]], [36924, '弧上取点', [arc]],
      [36925, '重复求线段中点', [s]], [36926, '反序重复求同一交点', [crossing, l]],
      [36926, '选择圆与经过圆上已知点的直线', [circle, crossing]],
      [36930, '重复作平行线', [b, l]], [36931, '重复作垂线', [b, l]],
      [36932, '反序重复作角平分线', [b, c, a]], [36933, '选取重合但独立的圆周点', [a, closeB]],
      [36933, '圆心圆周对换', [b, a]], [36934, '重复以线段为半径绘圆', [c, s]], [36935, '重复作圆上的弧', [circle, b, q]],
      [36935, '圆上起终点对换', [circle, q, b]], [36936, '三点弧端点对换', [c, b, a]],
      [36936, '三点弧中间点改变', [a, c, b]],
    );
  }
  const rows: Case[] = (probes ? probeCases : cases).map(([cmd, name, ids], i) => {
    const filename = `${cmd}-${i + 1}.gsp`;
    st.page.savedSelection = ids;
    const bytes = encodeGsp(st.doc);
    writeFileSync(join(out, filename), bytes);
    return { cmd, name, filename, selectionCount: ids.length, before: decodeFile(bytes, filename).doc.pages[0].objects.length };
  });
  writeFileSync(join(out, 'commands.json'), JSON.stringify(rows, null, 2));
}

interface Product { k: string; shape: Shape | undefined; path?: number }
interface CommandResult { cmd: number; filename: string; enabled: boolean; products: Product[]; selected: number[] }

async function runNew(rows: Case[]) {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5173/');
    const results: CommandResult[] = [];
    for (const row of rows) {
      await page.waitForFunction(() => !!window.__app?.active);
      const chooser = page.waitForEvent('filechooser');
      await page.evaluate(() => { void window.__app.openFile(); });
      await (await chooser).setFiles(join(out, row.filename));
      await page.waitForFunction(name => window.__app.active?.store.doc.name === name, row.filename.slice(0, -4));
      const result = await page.evaluate(async ({ cmd, filename, before, selectionCount }) => {
        const app = window.__app;
        const view = app.active!;
        const store = view.store;
        if (store.page.objects.length !== before || view.sel.length !== selectionCount) throw Error('新版读入的对象或选择数量不符');
        const enabled = app.queryMenu(cmd).enabled;
        if (enabled) await app.exec(cmd);
        const objects = store.page.objects;
        const products = objects.slice(before).map(obj => ({
          k: obj.def.k, shape: store.results.get(obj.id)?.shape,
          path: obj.def.k === 'onpath' ? objects.indexOf(store.get(obj.def.path)!) : undefined,
        }));
        const selected = view.sel.map(id => store.page.objects.findIndex(obj => obj.id === id) - before);
        store.markSaved();
        await app.closeDocument(view);
        return { cmd, filename, enabled, products, selected };
      }, row);
      results.push(result);
    }
    writeFileSync(join(out, 'new-results.json'), JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

function comparable(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1e8) / 1e8;
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, comparable(v)]));
  }
  return value;
}

function compare(rows: Case[]) {
  const newResults: CommandResult[] = JSON.parse(readFileSync(join(out, 'new-results.json'), 'utf8'));
  const nativeResults = JSON.parse(readFileSync(join(out, 'original', 'native-open-report.json'), 'utf8')) as
    { input: string; output?: string; opened: boolean; error?: string }[];
  const report = rows.map(row => {
    const native = nativeResults.find(r => r.input.endsWith(row.filename));
    const actual = newResults.find(r => r.filename === row.filename);
    if (!native?.opened || !native.output || !actual?.enabled) return { ...row, actual, error: native?.error ?? '两端之一未运行' };
    const doc = decodeFile(readFileSync(native.output), row.filename).doc;
    const page = doc.pages[0];
    const evaluated = evaluatePage(page, undefined, undefined, { angleUnit: doc.settings.display?.angleUnit });
    const expected: Product[] = page.objects.slice(row.before).map(obj => {
      const def = obj.def;
      return { k: def.k, shape: evaluated.get(obj.id)?.shape,
        path: def.k === 'onpath' ? page.objects.findIndex(parent => parent.id === def.path) : undefined };
    });
    const selected = (page.savedSelection ?? []).map(id => page.objects.findIndex(obj => obj.id === id) - row.before);
    const shapeEqual = JSON.stringify(comparable(expected)) === JSON.stringify(comparable(actual.products)) && selected.length > 0;
    const selectionEqual = JSON.stringify(selected) === JSON.stringify(actual.selected);
    const randomPlacement = row.cmd === 36924 && expected.length === 1 && actual.products.length === 1 &&
      expected[0].shape?.k === 'pt' && actual.products[0].shape?.k === 'pt' &&
      expected[0].path !== undefined && expected[0].path >= 0 && actual.products[0].path === expected[0].path;
    return { ...row, shapeEqual, selectionEqual, randomPlacement, expected, selected, actual };
  });
  writeFileSync(join(out, 'comparison.json'), JSON.stringify(report, null, 2));
  for (const row of report) {
    if ('error' in row) console.log(row.cmd, row.name, row.error);
    else console.log(row.cmd, row.name, row.randomPlacement ? '随机点依附一致' : row.shapeEqual ? '结果一致' : '结果待查', row.selectionEqual ? '选择一致' : '选择待查');
  }
  if (report.some(row => 'error' in row || !row.selectionEqual || !(row.shapeEqual || row.randomPlacement))) process.exitCode = 1;
}

if (mode === 'make' || mode === 'make-probes') makeFixtures(mode === 'make-probes');
else {
  const rows: Case[] = JSON.parse(readFileSync(join(out, 'commands.json'), 'utf8'));
  if (mode === 'new') await runNew(rows);
  else if (mode === 'compare') compare(rows);
  else throw new Error('使用 make、make-probes、new 或 compare');
}
