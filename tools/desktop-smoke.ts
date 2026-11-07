/** 桌面程序冒烟测试：启动 release 程序（带 WebView2 调试端口），在真实 Tauri 窗口里打开中文路径文件、编辑、Ctrl+S 原子保存、重读、关闭。
 * 用法：npx tsx tools/desktop-smoke.ts <exe 路径> <待测 .gsp 样本> */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { decodeGsp } from '../src/gsp/codec';

const [exe, sample] = [process.argv[2], process.argv[3]];
const dir = join(tmpdir(), `新版-桌面测试-${process.pid}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, '中文课件 测试.gsp');
copyFileSync(sample, file);
const before = readFileSync(file);
const port = 9333 + (process.pid % 200);
const log = (...a: unknown[]) => console.log('[桌面]', ...a);
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push([name, ok, note]); log(ok ? '通过' : '失败', name, note ?? ''); };

const child = spawn(exe, [file], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: join(dir, 'webview-profile') }, stdio: 'ignore' });
let exited = false; child.on('exit', () => { exited = true; });
try {
  let browser;
  for (let i = 0; i < 60 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!browser) throw new Error('连接不上桌面程序的调试端口');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => (window as any).__app?.docs.length >= 1, undefined, { timeout: 20000 });
  await page.waitForFunction(() => (window as any).__app.docs.some((d: any) => d.store.page.objects.length > 0), undefined, { timeout: 20000 });
  const info = await page.evaluate(() => ({ native: !!(window as any).__TAURI_INTERNALS__, title: document.title, docs: (window as any).__app.docs.length, objs: (window as any).__app.active.store.page.objects.length, path: (window as any).__app.active.path }));
  check('在 Tauri 窗口里运行', info.native, JSON.stringify(info));
  check('命令行传入的中文路径文件已打开', info.objs > 0 && String(info.path).endsWith('中文课件 测试.gsp'));

  // 编辑：用真实鼠标在空白处放一个点（点工具），再 Ctrl+S 保存
  await page.locator('.tool[data-group="point"]').click();
  const box = (await page.locator('.docwin canvas').last().boundingBox())!;
  await page.mouse.click(box.x + box.width - 80, box.y + 60);
  const dirty = await page.evaluate(() => (window as any).__app.active.store.dirty);
  check('编辑后文档标记为已修改', dirty === true);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => !(window as any).__app.active.store.dirty, undefined, { timeout: 10000 }).catch(() => undefined);
  const saved = readFileSync(file);
  check('Ctrl+S 写回原文件（原子替换，仍是 GSP4）', saved.subarray(0, 4).toString() === 'GSP4' && Buffer.compare(saved, before) !== 0);
  const reread = decodeGsp(new Uint8Array(saved));
  const n0 = decodeGsp(new Uint8Array(before)).doc.pages[0].objects.length;
  check('保存的文件能被读回且多出一个对象', reread.doc.pages[0].objects.length === n0 + 1, `${n0} → ${reread.doc.pages[0].objects.length}`);
  const leftovers = (await import('node:fs')).readdirSync(dir).filter(f => f.startsWith('.new-gsp-'));
  check('目录里没有遗留的临时文件', leftovers.length === 0);

  // 新建文档、平铺、复制粘贴（应用内剪贴板）
  await page.keyboard.press('Control+n');
  check('新建文档', (await page.evaluate(() => (window as any).__app.docs.length)) === 2, '带文件启动只有一个文档，新建后为 2');
  await page.evaluate(() => (window as any).__app.exec(57651));
  check('平铺窗口', (await page.locator('.docwin.framed').count()) === 2);
  await page.evaluate(() => (window as any).__app.exec(57650));

  // 打印预览（系统打印对话框无法自动操作，仅验证预览生成）
  await page.evaluate(() => (window as any).__app.printPreview((window as any).__app.docs[0]));
  check('打印预览生成图像', (await page.locator('#printpreview .pvsheet img').count()) === 1);
  await page.locator('#printpreview button', { hasText: '关闭' }).click();
  // 真实打印输出：把 window.print 换成空函数并保留打印内容，用 WebView2 的 Page.printToPDF 导出，检查是 1 页 A4 且含图像
  await page.evaluate(() => { (window as any).__keepPrintRoot = true; window.print = () => undefined; (window as any).__app.print((window as any).__app.docs[0]); });
  await page.waitForSelector('#printroot img', { state: 'attached', timeout: 5000 });
  const cdp = await page.context().newCDPSession(page);
  const pdf = Buffer.from((await cdp.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }) as { data: string }).data, 'base64');
  const pdfText = pdf.toString('latin1');
  const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const pdfBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdfText);
  check('打印输出 PDF 是 1 页 A4 且含图像', pdf.subarray(0, 5).toString() === '%PDF-' && pages === 1 && !!pdfBox && Math.abs(Number(pdfBox[1]) - 595) < 3 && Math.abs(Number(pdfBox[2]) - 842) < 3 && /\/Subtype\s*\/Image/.test(pdfText), `页数 ${pages}，MediaBox ${pdfBox?.slice(1, 3).join('×')}，${pdf.length} 字节`);
  await page.evaluate(() => { document.getElementById('printroot')?.remove(); (window as any).__keepPrintRoot = false; });

  // 真实 Windows 剪贴板里的图片：用 PowerShell 放一张 40×20 的位图，在真实窗口里按 Ctrl+V，应得到一个 PNG 图片对象（用完清空剪贴板）
  const ps = (cmd: string) => spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  ps('Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; $b = New-Object System.Drawing.Bitmap 40,20; $g=[System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::FromArgb(255,200,30,30)); $g.Dispose(); [System.Windows.Forms.Clipboard]::SetImage($b)');
  await page.evaluate(() => { const a = (window as any).__app; a.focusDoc(a.docs[0]); });
  await page.mouse.click(700, 500);   // 点击可能把焦点交给另一个文档窗口，所以点完之后再数对象
  const nObj = await page.evaluate(() => (window as any).__app.active.store.page.objects.length);
  await page.keyboard.press('Control+v');
  await page.waitForFunction(n => (window as any).__app.active.store.page.objects.length > n, nObj, { timeout: 8000 }).catch(() => undefined);
  const img = await page.evaluate(() => { const o = (window as any).__app.active.store.page.objects.at(-1); return o?.def?.k === 'image' ? { mime: o.def.mime, w: o.def.w, h: o.def.h } : undefined; });
  check('Ctrl+V 粘贴真实 Windows 剪贴板里的图片（PNG、原始大小）', !!img && img.mime === 'image/png' && img.w === 40 && img.h === 20, JSON.stringify(img));
  ps('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()');

  // 窗口关闭处理：有未保存修改时询问；选择“不保存”后程序退出
  await page.evaluate(() => { const a = (window as any).__app; a.focusDoc(a.docs[1]); a.docs[1].store.run('x', () => a.docs[1].store.add({ k: 'free', x: 5, y: 5 })); });
  void page.evaluate(() => (window as any).__app.quit());
  await page.locator('.dlg button', { hasText: '不保存' }).waitFor({ timeout: 10000 });
  check('退出时对未保存文档提示', true);
  // 每个有未保存修改的文档各问一次（粘贴的图片和新建文档里的点分属两个文档），逐个选“不保存”
  for (let i = 0; i < 40 && !exited; i++) {
    const btn = page.locator('.dlg button', { hasText: '不保存' });
    if (await btn.count().catch(() => 0)) await btn.first().click({ timeout: 2000 }).catch(() => undefined);
    await new Promise(r => setTimeout(r, 300));
  }
  check('选择不保存后程序退出', exited);
} catch (e) {
  check('冒烟流程', false, String(e));
} finally {
  if (!exited) child.kill();
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter(r => !r[1]);
console.log(`桌面冒烟：${results.length - failed.length}/${results.length} 项通过`);
if (existsSync(dir)) statSync(dir);
process.exit(failed.length ? 1 : 0);
