import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri 在开发模式下按 tauri.conf.json 的 devUrl 访问开发服务器，端口和主机必须固定。
const DEV_HOST = '127.0.0.1';
const DEV_PORT = 5173;

export default defineConfig({
  plugins: [react()],
  // 打包后由 Tauri 从自定义协议加载，用相对路径最稳妥。
  base: './',
  // 不清屏，方便在 tauri dev 里看到 Rust 侧的报错。
  clearScreen: false,
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
