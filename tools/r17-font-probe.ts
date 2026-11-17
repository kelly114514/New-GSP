/** 第十七轮调查：在渲染整库用的无头 Chrome 里画几组字体栈，保存截图，看中文回退到哪个字体。用法：npx tsx tools/r17-font-probe.ts 输出.png */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 1 });
await page.setContent('<canvas id=c width=900 height=420></canvas>');
await page.evaluate(() => {
  const g = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 420); g.fillStyle = '#000';
  const stacks = ["'SimSun'", "'华文行楷','SimSun','Microsoft YaHei',sans-serif", "'Times New Roman','SimSun','Microsoft YaHei',sans-serif", "'Tahoma','SimSun','Microsoft YaHei',sans-serif", "'Microsoft YaHei'", "'NoSuchFontX','SimSun',sans-serif", "'楷体_GB2312','KaiTi','SimSun','Microsoft YaHei',sans-serif"];
  stacks.forEach((s, i) => { g.font = '40px ' + s; g.fillText('画板分形Ab 梁宝同 ' + i, 10, 45 + i * 56); });
});
await page.screenshot({ path: process.argv[2] });
await browser.close();
