import './style.css';
import { App } from './app';
import { desktop } from './desktop';
import { Store } from './core/store';
import { decodeFile } from './gsp/codec';

const root = document.querySelector<HTMLDivElement>('#app')!;
const app = new App(root);
// 开发与测试辅助：浏览器里可通过 window.__app 驱动（不影响桌面程序）
(window as unknown as { __app: App }).__app = app;

// 命令行传入的 .gsp 文件
void desktop.launchFiles().then(async files => {
  if (!files.length) return;
  const blank = app.docs[0];
  for (const f of files) await app.openFile(f);
  // 带文件启动时不保留那个空白的“未命名”文档
  if (blank && !blank.store.dirty && blank.store.page.objects.length === 0 && app.docs.length > 1) { app.docs = app.docs.filter(d => d !== blank); app.mdi.remove(blank); app.focusDoc(app.docs[app.docs.length - 1]); }
});

// 崩溃恢复：每 20 秒把有改动的文档写成恢复快照（新版格式，存到应用数据目录）
setInterval(() => {
  app.docs.forEach(v => { if (v.store.dirty) void desktop.writeRecovery(v.rid, JSON.stringify(v.store.doc)).catch(() => undefined); });
}, 20000);
void desktop.listRecovery().then(async names => {
  if (!names.length) return;
  const ok = await app.dlg.confirm('上次新版没有正常关闭，找到了未保存的恢复内容。要打开它们吗？');
  for (const n of names) {
    if (ok) {
      const text = await desktop.readRecovery(n);
      if (text) { const doc = JSON.parse(text); const v = app.addView(new Store(doc)); v.store.doc.name = `${doc.name}（恢复）`; v.store.dirty = true; }
    }
    await desktop.deleteRecovery(n);
  }
});
void decodeFile;
