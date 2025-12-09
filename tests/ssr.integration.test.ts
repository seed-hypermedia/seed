/**
 * SSR Integration Test
 *
 * Tests that the web app properly server-renders pages with hydrated data.
 * This test:
 * 1. Starts a daemon with test fixtures
 * 2. Builds and starts the web app
 * 3. Makes HTTP requests to verify SSR is working correctly
 * 4. Tests client-side hydration works without errors
 */

import * as cheerio from 'cheerio'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {setupTestEnv, TestEnv} from './integration'

// Increase test timeout for integration tests
const TEST_TIMEOUT = 120_000 // 2 minutes

// Single shared environment for all tests
let env: TestEnv

beforeAll(async () => {
  env = await setupTestEnv({
    // Set to true for faster iteration during development
    skipBuild: process.env.SKIP_BUILD === 'true',
  })
}, TEST_TIMEOUT)

afterAll(() => {
  env?.cleanup()
})

describe('SSR Integration', () => {
  it(
    'should respond to health check',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      expect(response.status).toBeLessThan(500)
    },
    TEST_TIMEOUT,
  )

  it(
    'should server-render the home page with HTML content',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      const html = await response.text()
      expect(response.status).toBe(200)

      // Verify we get HTML back
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('</html>')
    },
    TEST_TIMEOUT,
  )

  it(
    'should server-render document content from test fixtures',
    async () => {
      // Use a bot user-agent to get fully-rendered SSR HTML (not streamed)
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        },
      })
      const html = await response.text()
      const $ = cheerio.load(html)

      // Look for a span with exact text content "asdfg" from our test database
      // This verifies that the document content is being server-rendered
      const spans = $('span').filter((_, el) => $(el).text().trim() === 'asdfg')

      expect(
        spans.length,
        'Expected to find a <span> with text "asdfg" in server-rendered HTML',
      ).toBeGreaterThan(0)
    },
    TEST_TIMEOUT,
  )

  it(
    'should include dehydrated state in the HTML',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      const html = await response.text()

      // Check for React Query dehydrated state
      // This is typically embedded as JSON in a script tag
      // The exact format depends on how Remix serializes loader data
      expect(html).toContain('dehydratedState')
    },
    TEST_TIMEOUT,
  )

  it(
    'should return proper content-type header',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      const contentType = response.headers.get('content-type')
      expect(contentType).toContain('text/html')
    },
    TEST_TIMEOUT,
  )

  it(
    'should not have JavaScript errors in the initial HTML',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      const html = await response.text()

      // Check that we don't have obvious error markers in the HTML
      expect(html).not.toContain('Error:')
      expect(html).not.toContain('throw new Error')
    },
    TEST_TIMEOUT,
  )
})

describe('SSR API Integration', () => {
  it(
    'should respond to daemon health check',
    async () => {
      const response = await fetch(
        `http://localhost:${env.daemon.config.httpPort}/debug/version`,
      )
      expect(response.ok).toBe(true)
      const version = await response.text()
      expect(version).toBeTruthy()
    },
    TEST_TIMEOUT,
  )
})

describe('Client Hydration Readiness', () => {
  it(
    'should not have React error boundaries triggered during SSR',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`, {
        headers: {
          'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        },
      })
      const html = await response.text()

      // Check for React error boundary content that indicates SSR failure
      // These patterns appear when React catches errors during rendering
      expect(html).not.toContain('Invalid hook call')
      expect(html).not.toContain('Minified React error')
      expect(html).not.toContain('Cannot read properties of null')
      expect(html).not.toContain('Hooks can only be called inside')

      // Check that the error boundary UI isn't showing
      // Our error boundary shows "🤕" emoji and this text
      expect(html).not.toContain("Uh oh, it's not you, it's us")
    },
    TEST_TIMEOUT,
  )

  it(
    'should have valid React hydration script setup',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      const html = await response.text()
      const $ = cheerio.load(html)

      // Verify React hydration scripts are present
      const scripts = $('script').toArray()
      const hasModuleScripts = scripts.some((script) => {
        const type = $(script).attr('type')
        return type === 'module'
      })

      expect(hasModuleScripts, 'Expected module scripts for React hydration').toBe(true)

      // Verify window.ENV is set before other scripts
      const envScript = $('script').filter((_, el) => {
        const content = $(el).html() || ''
        return content.includes('window.ENV')
      })
      expect(envScript.length, 'Expected window.ENV script to be present').toBeGreaterThan(0)
    },
    TEST_TIMEOUT,
  )

  it(
    'should export a valid React component from root',
    async () => {
      const response = await fetch(`${env.web.baseUrl}/`)
      const html = await response.text()

      // The page should render content, not just an error
      // A broken HOC export would cause the page to fail to render
      expect(response.status).toBe(200)

      // Should have actual content rendered (not empty body)
      const $ = cheerio.load(html)
      const bodyContent = $('body').html() || ''
      expect(bodyContent.length).toBeGreaterThan(100)

      // Should have the Providers wrapper rendered (indicates App component worked)
      // The providers wrap content in specific elements we can check for
      expect(html).toContain('class=')
    },
    TEST_TIMEOUT,
  )
})
