import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

export interface OpenedFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * 弹出系统“打开文件”对话框选一个 .gsp，并读出全部字节。用户取消时返回 null。
 *
 * 由菜单“文件 → 打开…”和 Ctrl+O 调用。
 * 读取权限来自 desktop/src-tauri/capabilities/default.json：fs 只开了 read-file，
 * 且没有静态路径范围；只有通过对话框选中的文件才会被临时加入范围。
 * 仅在 Tauri 窗口内可用，普通浏览器里调用会抛错。
 */
export async function openGspFile(): Promise<OpenedFile | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: '几何画板文件', extensions: ['gsp'] }],
  });
  if (path === null) return null;
  const bytes = await readFile(path);
  return { path, bytes };
}
