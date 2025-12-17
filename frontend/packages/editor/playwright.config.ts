import {defineConfig, devices} from '@playwright/test'

/**
 * Playwright configuration for the @shm/editor E2E tests.
 * Run tests with: `yarn workspace @shm/editor test:e2e`
 */
export default defineConfig({
  testDir: './e2e/tests',
  // Match .e2e.ts test files
  testMatch: '**/*.e2e.ts',
  // Maximum time one test can run
  timeout: 30000,
  // Maximum time expect() assertions should wait
  expect: {
    timeout: 5000,
  },
  forbidOnly: !!process.env.CI,
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  // Run tests in parallel (4 workers in CI, all available locally)
  workers: process.env.CI ? 4 : undefined,
  // Reporter to use
  reporter: process.env.CI
    ? [['github']]
    : [['html', {outputFolder: 'e2e/playwright-report', open: 'never'}]],
  // Shared settings for all projects
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: 'http://localhost:5180',
    // Collect trace when retrying a failed test
    trace: 'on-first-retry',
    // Capture screenshot on failure
    screenshot: 'only-on-failure',
  },
  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Grant clipboard permissions for copy/paste tests
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    // Uncomment to add more browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
  // Run the dev server before starting the tests
  webServer: {
    command: 'npx vite --config e2e/vite.config.ts',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  // Output directory for test artifacts
  outputDir: 'e2e/test-results',
})
