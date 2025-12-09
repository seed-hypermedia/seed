/**
 * SSR Integration Test
 *
 * Tests that the web app properly server-renders pages with hydrated data.
 * This test:
 * 1. Starts a daemon with test fixtures
 * 2. Builds and starts the web app
 * 3. Makes HTTP requests to verify SSR is working correctly
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
