import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { unsupportedInBrowser } from './openGsp';

/**
 * 弹出系统“另存为”对话框，只允许选 .gsp。用户取消时返回 null。
 * 需要 capabilities 里的 dialog:allow-save；选中的路径由插件临时加入 fs 范围。
 */
export async function chooseGspSavePath(defaultPath: string | null): Promise<string | null> {
  if (!isTauri()) throw unsupportedInBrowser('另存为');
  return save({
    filters: [{ name: '几何画板文件', extensions: ['gsp'] }],
    ...(defaultPath === null ? {} : { defaultPath }),
  });
}

/** 把字节写到对话框选中的路径。需要 capabilities 里的 fs:allow-write-file。 */
export async function writeGspFile(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri()) throw unsupportedInBrowser('写出本地文件');
  await writeFile(path, bytes);
}
