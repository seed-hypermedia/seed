import {defineConfig, devices} from '@playwright/test'

/**
 * Playwright configuration for the @shm/ui schema-editor E2E tests.
 * Run tests with: `pnpm -F @shm/ui test:e2e`
 */
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.e2e.ts',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['github']] : [['html', {outputFolder: 'e2e/playwright-report', open: 'never'}]],
  use: {
    baseURL: 'http://localhost:5181',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
          ],
        },
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
  webServer: {
    command: 'npx vite --config e2e/vite.config.ts',
    url: 'http://localhost:5181',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  outputDir: 'e2e/test-results',
})
