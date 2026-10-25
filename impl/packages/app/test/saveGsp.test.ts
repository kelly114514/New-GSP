import { afterEach, describe, expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { chooseGspSavePath, writeGspFile } from '../src/platform/saveGsp';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('原生保存适配器', () => {
  it('仅.gsp过滤器并传入最近路径，取消返回null', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.mocked(save).mockResolvedValueOnce(null);
    expect(await chooseGspSavePath('C:\\saved\\last.gsp')).toBeNull();
    expect(save).toHaveBeenCalledWith({
      title: '另存为', defaultPath: 'C:\\saved\\last.gsp', filters: [{ name: '几何画板文件', extensions: ['gsp'] }],
    });
  });
  it('精确写入所选路径与快照字节，传播写失败', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('写失败'));
    await expect(writeGspFile('C:\\saved\\selected.gsp', bytes)).rejects.toThrow('写失败');
    expect(writeFile).toHaveBeenCalledWith('C:\\saved\\selected.gsp', bytes);
  });
  it('浏览器预览提供中文可恢复错误', async () => {
    vi.stubGlobal('window', {});
    await expect(chooseGspSavePath('test.gsp')).rejects.toThrow('浏览器预览不支持原生另存为');
    expect(save).not.toHaveBeenCalled();
  });
});
