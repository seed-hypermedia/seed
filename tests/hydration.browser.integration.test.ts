/**
 * Browser-based Hydration Test
 *
 * Uses Playwright to test actual client-side hydration.
 * This catches issues like:
 * - Invalid hook calls from broken HOC exports
 * - Hydration mismatches between server and client
 * - Runtime errors during React initialization
 *
 * Run `yarn test:install-browsers` first to install Chromium.
 * Tests are skipped if browser cannot be launched (CI without browsers).
 */

import {chromium, Browser} from 'playwright'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {setupTestEnv, TestEnv} from './integration'

const TEST_TIMEOUT = 120_000

let env: TestEnv
let browser: Browser | null = null
let browserError: Error | null = null

beforeAll(async () => {
  env = await setupTestEnv({
    skipBuild: process.env.SKIP_BUILD === 'true',
  })

  try {
    browser = await chromium.launch({headless: true})
  } catch (error) {
    browserError = error as Error
    console.warn(
      'Playwright browser could not be launched. Skipping browser tests.',
      error,
    )
  }
}, TEST_TIMEOUT)

afterAll(async () => {
  await browser?.close()
  await env?.cleanup()
})

describe('Browser Hydration', () => {
  it(
    'should hydrate without React hook errors',
    async () => {
      if (!browser) {
        console.log('Skipping: browser not available')
        return
      }

      const context = await browser.newContext()
      const page = await context.newPage()

      // Collect console errors
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      // Collect page errors (uncaught exceptions)
      const pageErrors: Error[] = []
      page.on('pageerror', (error) => {
        pageErrors.push(error)
      })

      // Navigate and wait for hydration
      await page.goto(`${env.web.baseUrl}/`, {waitUntil: 'networkidle'})

      // Wait a moment for React to fully hydrate
      await page.waitForTimeout(2000)

      // Check for React hook errors which indicate hydration failures
      const hookErrors = consoleErrors.filter(
        (err) =>
          err.includes('Invalid hook call') ||
          err.includes('Minified React error #321') ||
          err.includes('error while hydrating') ||
          err.includes('Hydration failed') ||
          err.includes('Cannot read properties of null'),
      )

      const hookPageErrors = pageErrors.filter(
        (err) =>
          err.message.includes('Invalid hook call') ||
          err.message.includes('useState') ||
          err.message.includes('Minified React error') ||
          err.message.includes('Cannot read properties of null'),
      )

      expect(
        hookErrors,
        `React hook errors in console:\n${hookErrors.join('\n')}`,
      ).toHaveLength(0)

      expect(
        hookPageErrors,
        `React page errors:\n${hookPageErrors.map((e) => e.message).join('\n')}`,
      ).toHaveLength(0)

      await context.close()
    },
    TEST_TIMEOUT,
  )

  it(
    'should have interactive page after hydration',
    async () => {
      if (!browser) {
        console.log('Skipping: browser not available')
        return
      }

      const context = await browser.newContext()
      const page = await context.newPage()

      await page.goto(`${env.web.baseUrl}/`, {waitUntil: 'networkidle'})

      // Wait for hydration
      await page.waitForTimeout(2000)

      // Check that the page is interactive by verifying React has mounted
      // After hydration, React attaches event handlers and the page becomes interactive
      const isHydrated = await page.evaluate(() => {
        // Check if React has hydrated by looking for React internal properties
        // on DOM elements (React attaches __reactFiber$ keys after hydration)
        const body = document.body
        const hasReactFiber = Object.keys(body).some(
          (key) =>
            key.startsWith('__reactFiber$') || key.startsWith('__reactProps$'),
        )
        return hasReactFiber
      })

      expect(isHydrated, 'Expected React to have hydrated the page').toBe(true)

      await context.close()
    },
    TEST_TIMEOUT,
  )

  it(
    'should not show error boundary UI',
    async () => {
      if (!browser) {
        console.log('Skipping: browser not available')
        return
      }

      const context = await browser.newContext()
      const page = await context.newPage()

      await page.goto(`${env.web.baseUrl}/`, {waitUntil: 'networkidle'})

      // Wait for hydration
      await page.waitForTimeout(2000)

      // Check that error boundary UI is not showing
      const errorBoundaryVisible = await page.evaluate(() => {
        return document.body.textContent?.includes(
          "Uh oh, it's not you, it's us",
        )
      })

      expect(
        errorBoundaryVisible,
        'Error boundary should not be visible',
      ).toBe(false)

      await context.close()
    },
    TEST_TIMEOUT,
  )
})
