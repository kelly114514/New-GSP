/** 第十七轮调查：在渲染用的无头 Chrome 里量常见符号在宋体与雅黑下的宽度（字号 100），找出换行差异来自哪些字符。 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>'); await page.evaluate('window.__name = f => f');
const rows = await page.evaluate(() => {
  const g = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!;
  const chars = '，。、；：？！（）“”‘’…—～∠△≤≥≠≈∥⊥°×÷±·√∞π①②,.;:?!()[]<>=+-/%&*#°℃AaMm0123456789 中文';
  const w = (font: string, ch: string) => { g.font = `100px ${font}`; return Math.round(g.measureText(ch).width); };
  return [...chars].map(ch => [ch, w("'Times New Roman'", ch), w("'Times New Roman','SimSun','Microsoft YaHei'", ch), w("'Times New Roman','Microsoft YaHei'", ch)]);
});
console.log('字符  纯TNR  TNR+宋体  TNR+雅黑');
for (const [ch, a, b, c] of rows) if (b !== c) console.log(`${ch}  ${a}  ${b}  ${c}`);
await browser.close();
