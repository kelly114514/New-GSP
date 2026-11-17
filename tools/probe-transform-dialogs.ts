/** 对同一批临时夹具采集新版对话框的默认值、状态和取消结果。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { App } from '../src/app';

declare global { interface Window { __app: App } }

if (!process.argv[2]) throw Error('请指定系统临时目录');
const out = resolve(process.argv[2]);
const rel = relative(tmpdir(), out);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('夹具须放在系统临时目录的子目录');
const cases = JSON.parse(readFileSync(join(out, 'dialogs.json'), 'utf8')) as
  { name: string; filename: string; prep: number[]; cmds: number[] }[];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  await page.goto('http://127.0.0.1:5173/');
  const results = [];
  for (const { name, filename, prep, cmds } of cases) {
    await page.waitForFunction(() => !!window.__app?.active);
    const chooser = page.waitForEvent('filechooser');
    await page.evaluate(() => { void window.__app.openFile(); });
    await (await chooser).setFiles(join(out, filename));
    await page.waitForFunction(name => window.__app.active?.store.doc.name === name, name);
    const prepared = await page.evaluate(async steps => {
      const app = window.__app, prepared = [];
      for (const id of steps) {
        const enabled = app.queryMenu(id).enabled;
        if (enabled) await app.exec(id);
        prepared.push([id, enabled]);
      }
      return prepared;
    }, prep);
    const dialogs = [];
    for (const cmd of cmds) {
      if (cmd === 36889) { await page.evaluate(id => window.__app.exec(id), cmd); continue; }
      const before = await page.evaluate(cmd => {
        const app = window.__app, view = app.active!;
        return { enabled: app.queryMenu(cmd).enabled, selection: view.sel, doc: JSON.stringify(view.store.doc), center: view.marks.center };
      }, cmd);
      if (!before.enabled) { dialogs.push({ cmd, enabled: false, selection: before.selection }); continue; }
      await page.evaluate(cmd => { void window.__app.exec(cmd); }, cmd);
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const snapshot = () => dialog.evaluate(box => ({
        title: box.querySelector('.dlg-title')?.textContent,
        text: (box as HTMLElement).innerText,
        center: box.querySelector('.tgt')?.textContent,
        buttons: [...box.querySelectorAll('button')].map(b => b.textContent),
        inputs: [...box.querySelectorAll<HTMLInputElement>('input')].filter(i => i.getClientRects().length).map(i => ({
          type: i.type, name: i.name, value: i.value, enabled: !i.disabled, checked: i.checked, label: i.labels?.[0]?.textContent?.trim(),
        })),
        preview: !!window.__app.active?.ghost,
      }));
      const data = await snapshot();
      if (process.argv.includes('--images')) await dialog.screenshot({ path: join(out, `${name}-${cmd}-new.png`) });
      let rect;
      if (cmd === 36945) {
        await dialog.locator('input[name=tmode][value=rect]').check();
        rect = await snapshot();
        if (process.argv.includes('--images')) await dialog.screenshot({ path: join(out, `${name}-${cmd}-rect-new.png`) });
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      const after = await page.evaluate(expected => {
        const v = window.__app.active!;
        return { selection: v.sel, documentUnchanged: JSON.stringify(v.store.doc) === expected, ghostCleared: !v.ghost, center: v.marks.center };
      }, before.doc);
      dialogs.push({ cmd, enabled: true, selection: before.selection, beforeCenter: before.center, ...data, rect, after });
    }
    results.push({ name, prep: prepared, dialogs });
    await page.evaluate(async () => {
      const view = window.__app.active!;
      view.store.markSaved();
      await window.__app.closeDocument(view);
    });
    console.log(name);
  }
  writeFileSync(join(out, 'new-dialogs.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
