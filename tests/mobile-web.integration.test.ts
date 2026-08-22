/**
 * Mobile app e2e test (web build)
 *
 * Drives the Expo/react-native-web build of the mobile app with Playwright
 * against a real local hypermedia stack:
 *
 *   daemon (seed-daemon binary) <- web app (serves /api) <- mobile app (browser)
 *
 * Covers:
 * - Server selection and live connectivity check (ListAccounts via
 *   @seed-hypermedia/client against the local web server)
 * - Connection error state for an unreachable server
 * - Mnemonic entry, validation errors, and account derivation: the account ID
 *   derived in the browser must match the Go daemon's derivation for the same
 *   deterministic mnemonic
 *
 * Prerequisites: daemon binary built (plz-out/bin/backend), `npm install` run
 * in frontend/apps/mobile, and Chromium installed (pnpm test:install-browsers).
 */

import {chromium, type Browser, type Page} from 'playwright'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {setupTestEnv, startExpoWeb, type ExpoWebInstance, type TestEnv} from './integration'

const TEST_TIMEOUT = 300_000

// Deterministic mnemonic shared with register-key.integration.test.ts and the
// Go implementation - DO NOT CHANGE
const TEST_MNEMONIC = 'parrot midnight lion defense ski senior trouble slice chase spot history awkward'
const EXPECTED_ACCOUNT_ID = 'z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8'

let env: TestEnv
let expo: ExpoWebInstance
let browser: Browser

beforeAll(async () => {
  env = await setupTestEnv({
    webPort: 3401,
    daemonHttpPort: 59301,
    daemonGrpcPort: 59302,
    daemonP2pPort: 59303,
    skipBuild: process.env.SKIP_BUILD === 'true',
  })

  try {
    expo = await startExpoWeb({port: 8199})
    await expo.waitForReady()
    await expo.prewarmBundle()
  } catch (error) {
    await env.cleanup()
    throw error
  }

  try {
    browser = await chromium.launch({headless: true})
  } catch (error) {
    await expo.kill()
    await env.cleanup()
    throw new Error(
      `Playwright Chromium could not be launched. Run \`pnpm test:install-browsers\` from tests/ first.\n${error}`,
    )
  }
}, TEST_TIMEOUT)

afterAll(async () => {
  await browser?.close()
  await expo?.kill()
  await env?.cleanup()
})

/** Opens the app in a fresh browser context (fresh localStorage). */
async function openApp(): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(expo.baseUrl, {waitUntil: 'domcontentloaded'})
  // The server select screen is the initial route
  await page.getByTestId('server-url-input').waitFor({timeout: 60_000})
  return page
}

async function connectToServer(page: Page, serverUrl: string): Promise<void> {
  await page.getByTestId('server-url-input').fill(serverUrl)
  await page.getByTestId('server-connect').click()
  await page.getByTestId('connection-status').waitFor({timeout: 30_000})
}

describe('Mobile app (web) e2e', () => {
  it(
    'connects to the local hypermedia server and reports Connected',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)
      await expect
        .poll(async () => page.getByTestId('connection-status').textContent(), {timeout: 30_000})
        .toBe('Connected')
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'shows a connection error for an unreachable server',
    async () => {
      const page = await openApp()
      // Nothing listens on this port
      await connectToServer(page, 'http://localhost:59999')
      await expect
        .poll(async () => page.getByTestId('connection-status').textContent(), {timeout: 30_000})
        .toBe('Connection error')
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'derives the same account ID as the Go implementation from a mnemonic',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      await page.getByTestId('setup-account').click()
      // Pasting the full mnemonic into the first input fills all 12 fields
      await page.getByTestId('mnemonic-word-0').waitFor({timeout: 30_000})
      await page.getByTestId('mnemonic-word-0').fill(TEST_MNEMONIC)
      await expect.poll(async () => page.getByTestId('mnemonic-word-11').inputValue()).toBe('awkward')

      await page.getByTestId('mnemonic-continue').click()
      await page.getByTestId('account-id').waitFor({timeout: 30_000})
      expect(await page.getByTestId('account-id').textContent()).toBe(EXPECTED_ACCOUNT_ID)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'rejects a mnemonic with an invalid checksum',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      await page.getByTestId('setup-account').click()
      await page.getByTestId('mnemonic-word-0').waitFor({timeout: 30_000})
      // Valid BIP39 words, but the checksum in the 12th word is wrong
      const badMnemonic = TEST_MNEMONIC.split(' ').slice(0, 11).join(' ') + ' abandon'
      await page.getByTestId('mnemonic-word-0').fill(badMnemonic)
      await expect.poll(async () => page.getByTestId('mnemonic-word-11').inputValue()).toBe('abandon')

      await page.getByTestId('mnemonic-continue').click()
      await page.getByTestId('mnemonic-error').waitFor({timeout: 30_000})
      expect(await page.getByTestId('mnemonic-error').textContent()).toContain('checksum')
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'generates a valid random mnemonic that derives an account',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      await page.getByTestId('setup-account').click()
      await page.getByTestId('mnemonic-random').waitFor({timeout: 30_000})
      await page.getByTestId('mnemonic-random').click()
      await expect.poll(async () => page.getByTestId('mnemonic-word-11').inputValue()).not.toBe('')

      await page.getByTestId('mnemonic-continue').click()
      await page.getByTestId('account-id').waitFor({timeout: 30_000})
      // Random account, but always a base58btc-multibase Ed25519 key
      expect(await page.getByTestId('account-id').textContent()).toMatch(/^z6Mk/)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )
})
