/** 在 release 的 Tauri/WebView2 中载入整库、逐个重放、保存并读回。只写独立临时目录，不使用剪贴板。
 * npx tsx tools/desktop-tools-smoke.ts <release.exe> [原版 Tool Folder]
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { loadToolFile, resolveTool } from '../src/toolkit';
import { decodeFile } from '../src/gsp/codec';
import { toolInputFixture } from './tool-input-fixture';
import { applyTool } from '../src/core/tooling';

const exe = resolve(process.argv[2]);
const folder = resolve(process.argv[3] ?? '../sketchpad5/Tool Folder');
const temp = realpathSync(tmpdir());
const dir = mkdtempSync(join(temp, 'newgsp-desktop-tools-'));
const file = join(dir, '工具保存测试.ngsp'), port = 9600 + process.pid % 200;
const groups = readdirSync(folder).filter(f => /\.gsp$/i.test(f)).sort().flatMap(f => {
  const g = loadToolFile(f, new Uint8Array(readFileSync(join(folder, f)))); return g ? [g] : [];
});
const fixtures = groups.flatMap((g, gi) => g.tools.map((ref, ti) => {
  const t = resolveTool(ref), f = toolInputFixture(t);
  const doc = structuredClone(f.st.doc);
  f.st.run(t.name, () => applyTool(f.st, t, f.picks, () => ({ x: 20, y: 200 }), { random: () => 0.37 }));
  return { gi, ti, name: `${g.name}/${t.name}`, doc, picks: f.picks, expected: f.st.page.objects.length };
}));
const child = spawn(exe, [], { stdio: 'ignore', env: { ...process.env,
  NEW_GSP_TEST_RECOVERY_DIR: join(dir, 'recovery'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`,
  WEBVIEW2_USER_DATA_FOLDER: join(dir, 'profile') } });
try {
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!browser) throw Error('无法连接桌面程序');
  const page = browser.contexts()[0].pages()[0];
  const trace = process.env.GSP_TOOL_TRACE === '1';
  if (trace) page.on('console', message => console.log(message.text()));
  page.on('crash', () => {
    console.error('WebView2 渲染进程崩溃');
    if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  });
  await page.waitForFunction(() => (window as any).__app?.active, undefined, { timeout: 20000 });
  const recovery = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('recovery_list'));
  if (recovery.length) throw Error('测试恢复目录没有隔离，停止而不处理既有恢复文件');
  const loaded = await page.evaluate(async folder => {
    const app = (window as any).__app;
    app.settings.toolFolder = folder; await app.reloadToolFolder();
    return { native: !!(window as any).__TAURI_INTERNALS__, groups: app.toolGroups.length,
      tools: app.toolGroups.reduce((n: number, g: any) => n + g.tools.length, 0) };
  }, folder);
  if (!loaded.native || loaded.groups !== groups.length || loaded.tools !== fixtures.length) throw Error(JSON.stringify(loaded));
  console.log('桌面载入：', JSON.stringify(loaded));
  console.log(`测试记录：${dir}`);
  let count = 0;
  for (const fixture of fixtures.slice(Number(process.env.GSP_TOOL_START ?? 0), Number(process.env.GSP_TOOL_END ?? fixtures.length))) {
    if (count % 50 === 0) console.log(`重放进度：${count}/${fixtures.length}`);
    const viewport = await page.evaluate(() => {
      const app = (window as any).__app, v = app.active;
      return { width: v.canvas.width, height: v.canvas.height, docs: app.docs.length,
        elements: document.querySelectorAll('*').length, scroll: v.scroll };
    });
    writeFileSync(join(dir, 'progress.json'), JSON.stringify({ count, tool: fixture.name, viewport }));
    const result = await page.evaluate(({ f, trace }) => {
      const app = (window as any).__app, v = app.active, st = v.store;
      if (trace) console.log('阶段：重置', performance.now().toFixed(0));
      st.resetHistory(); v.eraseTraces(); v.scroll = { x: 0, y: 0 };
      st.doc = f.doc; st.ctx = { view: v.viewRect() }; st.protectedReason = undefined; v.sel = []; st.recompute();
      if (trace) console.log('阶段：选择工具', performance.now().toFixed(0));
      app.useToolRef(app.toolGroups[f.gi].tools[f.ti]);
      const tool = app.customTool;
      if (tool.blocked) return tool.blocked;
      v.toolPicks = f.picks;
      const previousRandom = Math.random; let seed = 123456789;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      if (trace) console.log('阶段：执行工具', performance.now().toFixed(0));
      const originals: [any, string, any][] = [];
      if (trace) for (const [object, name] of [[st, 'recompute'], [st, 'commit'], [app, 'refresh'], [v, 'setSel']]) {
        originals.push([object, name, object[name]]);
        object[name] = new Proxy(object[name], {
          apply(fn, receiver, args) {
            const time = performance.now();
            console.log('开始', name);
            try { return Reflect.apply(fn as Function, receiver, args); }
            finally { console.log('完成', name, (performance.now() - time).toFixed(0), 'ms'); }
          },
        });
      }
      try { v.runTool(tool); } finally {
        Math.random = previousRandom;
        for (const [object, name, fn] of originals) object[name] = fn;
      }
      if (trace) console.log('阶段：执行完成', performance.now().toFixed(0));
      if (document.querySelector('.dlg')) return '出现了未处理的对话框';
      if (st.page.objects.length !== f.expected) return `预期 ${f.expected} 个对象，实际 ${st.page.objects.length} 个`;
      const bad = st.page.objects.filter((o: any) => o.def.k === 'unknown' || ['missing', 'unsupported'].includes(st.results.get(o.id)?.status));
      return bad.length ? JSON.stringify(bad.map((o: any) => [o.id, o.def.k])) : '';
    }, { f: fixture, trace });
    if (result) throw Error(`${fixture.name}：${result}`);
    writeFileSync(join(dir, 'progress.json'), JSON.stringify({ count, tool: fixture.name, phase: '绘制', viewport }));
    await page.evaluate(() => (window as any).__app.active.paint());
    count++;
  }
  console.log(`桌面逐个重放：${count}/${fixtures.length}`);
  const saved = await page.evaluate(async file => {
    const app = (window as any).__app, v = app.active;
    v.path = file; v.store.source = { kind: 'ngsp' };
    const ok = await app.save(v, false);
    return { ok, objects: v.store.page.objects, name: v.store.doc.name };
  }, file);
  if (!saved.ok) throw Error('桌面保存失败');
  const back = decodeFile(new Uint8Array(readFileSync(file)), file).doc;
  if (JSON.stringify(back.pages[0].objects) !== JSON.stringify(saved.objects)) throw Error('保存读回对象不一致');
  await page.evaluate(async file => {
    const app = (window as any).__app;
    await app.openFile(file);
  }, file);
  const reopened = await page.evaluate(() => (window as any).__app.active.store.page.objects);
  if (JSON.stringify(reopened) !== JSON.stringify(saved.objects)) throw Error('桌面重新打开不一致');
  console.log('桌面保存、读回、重新打开：通过');
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('exit_app')).catch(() => undefined);
} finally {
  if (child.exitCode === null && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  child.kill();
  if (child.exitCode === null && child.signalCode === null) await new Promise(r => child.once('exit', r));
  // 只清理本次创建的目录。WebView2 的子进程可能短暂持有文件。
  if (dirname(realpathSync(dir)) !== temp) throw Error('拒绝清理临时目录之外的路径');
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
  catch (error) { console.warn('临时目录暂未清理', dir, error); }
}
