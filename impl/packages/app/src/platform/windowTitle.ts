import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * 设置原生窗口标题（需要 capabilities 里的 core:window:allow-set-title）。
 * 在普通浏览器里没有 Tauri 窗口，调用失败时静默忽略；document.title 由调用方另行设置。
 */
export async function setWindowTitle(title: string): Promise<void> {
  try {
    await getCurrentWindow().setTitle(title);
  } catch {
    // 不在 Tauri 窗口里（例如 npm run dev:web）
  }
}
