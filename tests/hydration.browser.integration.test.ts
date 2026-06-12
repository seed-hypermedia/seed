/**
 * Browser-based Hydration Test
 *
 * Uses Playwright to test actual client-side hydration.
 * This catches issues like:
 * - Invalid hook calls from broken HOC exports
 * - Hydration mismatches between server and client
 * - Runtime errors during React initialization
 *
 * Run `pnpm test:install-browsers` first to install Chromium.
 */

import {chromium, type Browser} from 'playwright'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {setupTestEnv, type TestEnv} from './integration'

const TEST_TIMEOUT = 120_000

let env: TestEnv
let browser: Browser

beforeAll(async () => {
  env = await setupTestEnv({
    webPort: 3400,
    daemonHttpPort: 59101,
    daemonGrpcPort: 59102,
    daemonP2pPort: 59103,
    skipBuild: process.env.SKIP_BUILD === 'true',
  })

  try {
    browser = await chromium.launch({headless: true})
  } catch (error) {
    await env.cleanup()
    throw new Error(
      `Playwright Chromium could not be launched. Run \`pnpm test:install-browsers\` from tests/ before running browser integration tests.\n${error}`,
    )
  }
}, TEST_TIMEOUT)

afterAll(async () => {
  await browser?.close()
  await env?.cleanup()
})

describe('Browser Hydration', () => {
  it(
    'loads the client bundle and hydrates without runtime errors',
    async () => {
      const context = await browser.newContext()
      const page = await context.newPage()
      const consoleErrors: string[] = []
      const pageErrors: Error[] = []

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      page.on('pageerror', (error) => {
        pageErrors.push(error)
      })

      try {
        const response = await page.goto(`${env.web.baseUrl}/`, {
          waitUntil: 'domcontentloaded',
        })

        expect(response?.status()).toBeLessThan(500)
        await page.waitForLoadState('networkidle')

        try {
          await page.waitForFunction(() => {
            return document.documentElement.dataset.seedHydrated === 'true'
          })
        } catch (error) {
          throw new Error(
            `Client hydration marker was not set. Runtime errors:\n${pageErrors
              .map((pageError) => pageError.stack ?? pageError.message)
              .join('\n')}\nConsole errors:\n${consoleErrors.join('\n')}\n${error}`,
          )
        }

        const errorBoundaryVisible = await page.evaluate(() => {
          const pageText = document.body?.textContent ?? document.documentElement?.textContent ?? ''
          return pageText.includes("Uh oh, it's not you, it's us")
        })

        const hydrationConsoleErrors = consoleErrors.filter((message) => {
          return /Invalid hook call|Hydration failed|error while hydrating|Minified React error|Hooks can only be called inside|Cannot read properties of (null|undefined)/i.test(
            message,
          )
        })

        expect(errorBoundaryVisible, 'Error boundary should not be visible').toBe(false)

        expect(
          pageErrors.map((error) => error.stack ?? error.message),
          `Runtime page errors:\n${pageErrors.map((error) => error.stack ?? error.message).join('\n')}`,
        ).toHaveLength(0)

        expect(hydrationConsoleErrors, `Hydration console errors:\n${hydrationConsoleErrors.join('\n')}`).toHaveLength(
          0,
        )
      } finally {
        await context.close()
      }
    },
    TEST_TIMEOUT,
  )
})
