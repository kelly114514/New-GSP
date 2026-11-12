/** 本轮桌面保存冒烟：自制临时课件、独立恢复目录及 WebView2 配置；不操作原版、系统输入或剪贴板。
 * npx tsx tools/desktop-save-smoke.ts <release.exe>
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { newDoc, defaultStyle } from '../src/core/model';
import { decodeFile, encodeNgsp, encodeGsp } from '../src/gsp/codec';

const exe = resolve(process.argv[2] ?? 'src-tauri/target/release/new-gsp.exe');
const dir = mkdtempSync(join(tmpdir(), 'new-gsp-save-'));
const ngsp = join(dir, '中文启动.NGSP'), gsp = join(dir, '保留元数据.gsp'), dest = join(dir, '转存.ngsp');
const doc = newDoc('桌面保存');
const def = { k: 'free', x: 100, y: 100 } as const;
doc.pages[0].objects.push({ id: 1, def, style: defaultStyle(def), hidden: false, label: 'A', labelShown: true });
writeFileSync(ngsp, encodeNgsp(doc));
const plain = encodeGsp(doc), record = new Uint8Array(12), rv = new DataView(record.buffer);
rv.setUint32(0, 4, true); rv.setUint32(4, 9008, true); rv.setUint32(8, 42, true);
const original = Buffer.concat([plain.subarray(0, plain.length - 8), record, plain.subarray(plain.length - 8)]);
writeFileSync(gsp, original);
const port = 9700 + process.pid % 200;
const child = spawn(exe, [ngsp], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
  NEW_GSP_TEST_RECOVERY_DIR: join(dir, 'recovery'), WEBVIEW2_USER_DATA_FOLDER: join(dir, 'profile'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
const checks: string[] = [];
function check(name: string, ok: boolean) { if (!ok) throw Error(name); checks.push(name); console.log('通过：', name); }
try {
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!browser) throw Error('桌面连接失败');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => (window as any).__app?.active?.path?.endsWith('.NGSP'), undefined, { timeout: 20000 });
  check('中文 .NGSP 启动参数打开且名称不带扩展名', await page.evaluate(() => (window as any).__app.active.store.doc.name === '中文启动'));
  check('真实 Tauri / 隔离恢复目录', await page.evaluate(async () => !!(window as any).__TAURI_INTERNALS__ && (await (window as any).__TAURI_INTERNALS__.invoke('recovery_list')).length === 0));
  await page.evaluate(async file => { await (window as any).__app.openFile(file); }, gsp);
  check('未修改原版格式原样保存', await page.evaluate(() => { const a = (window as any).__app; return a.save(a.active, false); }) && original.equals(readFileSync(gsp)));
  await page.evaluate(() => { const st = (window as any).__app.active.store; st.run('拖动自由点', () => st.moveFree(1, 140, 160)); });
  check('拖动自由点保留源格式写回', await page.evaluate(() => { const a = (window as any).__app; return a.save(a.active, false); }));
  const stable = readFileSync(gsp);
  check('源记录保留且自由点位置正确', stable.subarray(-20, -8).equals(Buffer.from(record)) && JSON.stringify(decodeFile(new Uint8Array(stable), gsp).doc.pages[0].objects[0].def) === JSON.stringify({ k: 'free', x: 140, y: 160 }));
  await page.evaluate(() => { const st = (window as any).__app.active.store; st.run('移动标签', () => { st.page.objects[0].labelDx = 80; }); });
  await page.evaluate(() => { const a = (window as any).__app; (window as any).__saveResult = a.save(a.active, false); });
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  check('取消转存保留未保存状态', await page.evaluate(async () => !(await (window as any).__saveResult) && (window as any).__app.active.store.dirty));
  check('取消后原课件字节不变', stable.equals(readFileSync(gsp)));
  // 预置临时目标路径，跳过系统选文件框；实际走 App.save 的转存和原子写入。
  await page.evaluate(file => { const a = (window as any).__app; a.active.path = file; (window as any).__saveResult = a.save(a.active, false); }, dest);
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
  check('转存完成且清除未保存标记', await page.evaluate(async () => (await (window as any).__saveResult) && !(window as any).__app.active.store.dirty));
  check('转存读回保留标签偏移且原课件不变', decodeFile(new Uint8Array(readFileSync(dest)), dest).doc.pages[0].objects[0].labelDx === 80 && stable.equals(readFileSync(gsp)));
  check('无原子保存临时文件残留', !readdirSync(dir).some(f => f.startsWith('.new-gsp-')));
  console.log(JSON.stringify({ passed: checks.length, checks }));
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('exit_app')).catch(() => undefined);
} finally {
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  // 只清理本脚本 mkdtemp 创建的目录，验证绝对路径在系统临时目录内。
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('拒绝清理临时目录之外的路径');
  // Windows 的 WebView2 子进程可能在主程序退出后仍短暂持有配置目录。
  rmSync(dir, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 });
}
