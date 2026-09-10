import { defineConfig, devices } from '@playwright/test'

const recordVideo = process.env.PLAYWRIGHT_VIDEO === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:1422',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: recordVideo ? 'on' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:1422',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})