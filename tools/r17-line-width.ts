/** 第十七轮调查：量某个文字对象每一行在不同字体栈下的宽度，对比文本框宽度，找出换行差异的来源。
 * 用法：npx tsx tools/r17-line-width.ts 截图序号 对象id */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { decodeGsp } from '../src/gsp/codec';

const rows = JSON.parse(readFileSync('docs/截图对照数据.json', 'utf8')).rows as Record<string, { file: string }>;
const doc = decodeGsp(new Uint8Array(readFileSync('../' + rows[process.argv[2]].file.replace(/\\/g, '/')))).doc;
const o = doc.pages[Math.min(doc.current ?? 0, doc.pages.length - 1)].objects.find(x => x.id === Number(process.argv[3]))!;
const d = o.def as { text: string; w: number; h: number; font: { name: string; size: number; bold: boolean; italic: boolean }; runs?: { text: string; font: { name: string; size: number; bold: boolean } }[] };
console.log('w', d.w, 'h', d.h, 'font', JSON.stringify(d.font), 'runs', d.runs?.length ?? 0, d.runs?.slice(0, 3).map(r => JSON.stringify(r.font)));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>'); await page.evaluate('window.__name = f => f');
const lines = d.text.split('\n');
const res = await page.evaluate(({ lines, f }) => {
  const g = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!;
  const stacks = [`'${f.name}','SimSun','Microsoft YaHei',sans-serif`, `${f.name}, 'Microsoft YaHei', sans-serif`];
  return lines.map(l => stacks.map(s => { g.font = `${f.bold ? 'bold ' : ''}${f.size}px ${s}`; return Math.round(g.measureText(l).width * 10) / 10; }));
}, { lines, f: d.font });
res.forEach((r, i) => console.log(i, 'chars', [...lines[i]].length, 'songStack', r[0], 'yaheiStack', r[1], 'box', d.w - 6));
await browser.close();
