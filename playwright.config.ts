import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // 选区连续性只在非整数 DPR 下才有信号（DPR=1 时逐层绘制也看不出缝），
      // 那条 spec 归 dpr125 project 专跑，别让它在这里空跑一遍。
      testIgnore: /selection-seam\.spec\.ts/,
    },
    {
      // Windows 125% 缩放：块 / 行边界落在分数设备像素上，是「选区缝隙 + 叠色」的
      // 唯一可复现条件（ADR-0065）。新增像素级 spec 请挂到这个 project 下。
      name: 'dpr125',
      testMatch: /selection-seam\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1.25 },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
