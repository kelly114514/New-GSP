import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.e2e.ts', outputDir: './test-results/playwright',
  use: {baseURL:'http://127.0.0.1:5173',headless:true,viewport:{width:1000,height:700},launchOptions:{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:30000},
});
