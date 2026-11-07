/** 桌面适配层：文件、剪贴板、关闭、恢复快照。开发浏览器和 Tauri 程序共用业务代码，只有这里分两条路径。 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface OpenedFile { name: string; path?: string; bytes: Uint8Array }
export interface SavedFile { name: string; path?: string }
export interface ToolFile { name: string; bytes: Uint8Array }

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
let closeHandler: (() => Promise<boolean>) | undefined;

function pickBrowserFile(): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.gsp,.ngsp';
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}

export const desktop = {
  get native() { return isTauri(); },

  async openFile(path?: string): Promise<OpenedFile | undefined> {
    if (isTauri()) {
      let p = path;
      if (!p) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const r = await open({ multiple: false, filters: [{ name: '画板文件', extensions: ['gsp', 'ngsp'] }] });
        p = typeof r === 'string' ? r : undefined;
      }
      if (!p) return undefined;
      const bytes = new Uint8Array(await invoke<number[]>('read_gsp', { path: p }));
      return { name: base(p), path: p, bytes };
    }
    const f = await pickBrowserFile();
    return f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : undefined;
  },

  /** 另存到 path（无 path 则弹出保存对话框）。桌面版写同目录临时文件、校验后原子替换。 */
  async saveFile(bytes: Uint8Array, path: string | undefined, suggested: string, ext: 'gsp' | 'ngsp' = 'gsp'): Promise<SavedFile | undefined> {
    if (isTauri()) {
      let p = path;
      if (!p) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const r = await save({ defaultPath: suggested, filters: [{ name: ext === 'gsp' ? '画板文件' : '新版课件', extensions: [ext] }] });
        p = r ?? undefined;
      }
      if (!p) return undefined;
      if (!new RegExp(`\.${ext}$`, 'i').test(p)) p += `.${ext}`;
      await invoke('save_gsp', { path: p, bytes: Array.from(bytes) });
      return { name: base(p), path: p };
    }
    type Picker = (o: object) => Promise<{ name: string; createWritable(): Promise<{ write(b: BufferSource): Promise<void>; close(): Promise<void> }> }>;
    const w = window as unknown as { showSaveFilePicker?: Picker };
    if (w.showSaveFilePicker) {
      try {
        const h = await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: '画板文件', accept: { 'application/octet-stream': [`.${ext}`] } }] });
        const s = await h.createWritable(); await s.write(bytes as BufferSource); await s.close();
        return { name: h.name };
      } catch (e) { if ((e as Error).name === 'AbortError') return undefined; throw e; }
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = suggested; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { name: suggested };
  },

  async writeClipboardText(text: string) { await navigator.clipboard?.writeText(text); },
  async readClipboardImage(): Promise<{ data: string; mime: string } | undefined> {
    if (isTauri()) {   // 桌面版：经 Rust 取（navigator.clipboard.read 在 WebView2 里会弹权限提示）
      try {
        const bytes = await invoke<number[] | null>('read_clipboard_image');
        if (!bytes) return undefined;
        const buf = new Uint8Array(bytes); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { data: btoa(s), mime: 'image/png' };
      } catch { return undefined; }
    }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await it.getType(type);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { data: btoa(s), mime: type };
      }
    } catch { /* 无权限或没有图片 */ }
    return undefined;
  },

  /** 窗口标题栏显示当前文档名。 */
  setTitle(title: string) {
    document.title = title;
    if (isTauri()) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title)).catch(() => undefined);
  },
  /** 让用户选一个文件夹（桌面版）；浏览器里返回 undefined。 */
  async pickFolder(): Promise<string | undefined> {
    if (!isTauri()) return undefined;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false });
    return typeof r === 'string' ? r : undefined;
  },

  /** 读工具文件夹里的全部 .gsp（桌面版）。 */
  async readToolFolder(dir: string): Promise<ToolFile[]> {
    if (!isTauri()) return [];
    const sep = dir.includes('\\') ? '\\' : '/', out: ToolFile[] = [];
    for (const name of await invoke<string[]>('list_gsp_files', { dir })) out.push({ name, bytes: new Uint8Array(await invoke<number[]>('read_gsp', { path: `${dir.replace(/[\\/]+$/, '')}${sep}${name}` })) });
    return out;
  },
  /** 浏览器里选一个文件夹，读出其中的 .gsp（开发/测试用；桌面版用 pickFolder + readToolFolder）。 */
  pickBrowserFolder(): Promise<ToolFile[] | undefined> {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
      input.onchange = async () => {
        const fs = [...(input.files ?? [])].filter(f => /\.gsp$/i.test(f.name) && (f.webkitRelativePath.match(/\//g) ?? []).length <= 1).sort((a, b) => a.name.localeCompare(b.name));
        resolve(await Promise.all(fs.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      };
      input.oncancel = () => resolve(undefined);
      input.click();
    });
  },
  /** 把工具文件夹复制到应用数据目录；返回新路径和个数（桌面版）。 */
  async importToolFolder(src: string): Promise<{ path: string; count: number } | undefined> {
    if (!isTauri()) return undefined;
    const [path, count] = await invoke<[string, number]>('import_tool_folder', { src });
    return { path, count };
  },

  onCloseRequested(handler: () => Promise<boolean>) {
    closeHandler = handler;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        void getCurrentWindow().onCloseRequested(async ev => { ev.preventDefault(); await handler(); });
      });
    }
  },
  async exit() {
    if (isTauri()) await invoke('exit_app');
    else window.close();
  },

  // ---- 恢复快照：保存到应用数据目录，不伪装成兼容文件 ----
  async writeRecovery(name: string, json: string) {
    if (isTauri()) await invoke('recovery_write', { name, text: json });
    else try { localStorage.setItem(`newgsp.recovery.${name}`, json); } catch { /* 存储已满时忽略 */ }
  },
  async listRecovery(): Promise<string[]> {
    if (isTauri()) return invoke<string[]>('recovery_list');
    return Object.keys(localStorage).filter(k => k.startsWith('newgsp.recovery.')).map(k => k.slice(16));
  },
  async readRecovery(name: string): Promise<string | undefined> {
    if (isTauri()) return invoke<string | undefined>('recovery_read', { name });
    return localStorage.getItem(`newgsp.recovery.${name}`) ?? undefined;
  },
  async deleteRecovery(name: string) {
    if (isTauri()) await invoke('recovery_delete', { name });
    else localStorage.removeItem(`newgsp.recovery.${name}`);
  },
  /** 用系统默认浏览器打开网址（只接受 http/https）。 */
  async openUrl(url: string) {
    if (!/^https?:\/\/[^\s"<>]+$/i.test(url)) return;
    if (isTauri()) await invoke('open_url', { url });
    else window.open(url, '_blank', 'noopener');
  },
  async launchFiles(): Promise<string[]> { return isTauri() ? invoke<string[]>('launch_args') : []; },
  get closeHandler() { return closeHandler; },
};
