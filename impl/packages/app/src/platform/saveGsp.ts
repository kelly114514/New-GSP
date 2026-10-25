import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/** No static filesystem scope: the native dialog grants access to its selected file only. */
export function chooseGspSavePath(defaultPath: string): Promise<string | null> {
  if (!('__TAURI_INTERNALS__' in window)) {
    return Promise.reject(new Error('浏览器预览不支持原生另存为，请在桌面应用中操作'));
  }
  return save({ title: '另存为', defaultPath, filters: [{ name: '几何画板文件', extensions: ['gsp'] }] });
}

export function writeGspFile(path: string, bytes: Uint8Array): Promise<void> {
  return writeFile(path, bytes);
}
