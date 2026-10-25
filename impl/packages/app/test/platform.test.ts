import { describe, expect, it } from 'vitest';
import { openGspFile } from '../src/platform/openGsp';
import { chooseGspSavePath, writeGspFile } from '../src/platform/saveGsp';

// 测试在 Node 里跑，没有 Tauri 窗口，等同于浏览器预览。
describe('浏览器预览里的文件操作', () => {
  it('打开、另存为、写出都给出中文错误而不是崩溃', async () => {
    await expect(openGspFile()).rejects.toThrow('浏览器预览不支持打开本地文件');
    await expect(chooseGspSavePath(null)).rejects.toThrow('浏览器预览不支持另存为');
    await expect(writeGspFile('C:\\a.gsp', new Uint8Array())).rejects.toThrow('浏览器预览不支持写出本地文件');
  });
});
