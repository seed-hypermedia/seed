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
import {createDocumentUpdate} from '../frontend/apps/cli/src/test/account-helpers'
import {FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_ID} from '../frontend/apps/cli/src/test/fixture-seed'
import {FIXTURE_ACCOUNT_NAME, FIXTURE_HIERARCHY_TITLE, FIXTURE_HOME_CONTENT} from '../test-fixtures/minimal-fixtures'
import {setupTestEnv, startExpoWeb, type ExpoWebInstance, type TestEnv} from './integration'

const TEST_TIMEOUT = 300_000

// Deterministic mnemonic shared with register-key.integration.test.ts and the
// Go implementation - DO NOT CHANGE
const TEST_MNEMONIC = 'parrot midnight lion defense ski senior trouble slice chase spot history awkward'
const EXPECTED_ACCOUNT_ID = 'z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8'
const BLOG_POST_TITLE = 'Blog Post One'
const ORPHAN_TITLE = 'Orphan Page'

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

  // Compose the fixture home so all three content features are exercised:
  // - a Query block over /blog (NOT self-targeting, so the unreferenced
  //   section stays active) rendering child docs as cards
  // - an Embed card referencing the hierarchy doc
  // - an orphan child doc referenced by nothing -> unreferenced children
  await createDocumentUpdate(env.web.baseUrl, FIXTURE_ACCOUNT, 'blog/post-one', [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: BLOG_POST_TITLE}]},
  ])
  await createDocumentUpdate(env.web.baseUrl, FIXTURE_ACCOUNT, 'orphan-page', [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: ORPHAN_TITLE}]},
  ])
  await createDocumentUpdate(env.web.baseUrl, FIXTURE_ACCOUNT, '', [
    {
      type: 'ReplaceBlock',
      block: {
        type: 'Query',
        id: 'homequery',
        text: '',
        annotations: [],
        attributes: {
          style: 'Card',
          columnCount: 1,
          banner: false,
          query: {
            includes: [{space: FIXTURE_ACCOUNT_ID, path: '/blog', mode: 'Children'}],
            sort: [{term: 'UpdateTime', reverse: false}],
            limit: 10,
          },
        },
      },
    },
    {
      type: 'ReplaceBlock',
      block: {
        type: 'Embed',
        id: 'homeembed',
        text: '',
        annotations: [],
        link: `hm://${FIXTURE_ACCOUNT_ID}/hierarchy-test`,
        attributes: {view: 'Card'},
      },
    },
    {type: 'MoveBlocks', parent: '', blocks: ['homequery', 'homeembed']},
  ])

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

// Connecting lands directly on the server's home document page.
async function connectToServer(page: Page, serverUrl: string): Promise<void> {
  await page.getByTestId('server-url-input').fill(serverUrl)
  await page.getByTestId('server-connect').click()
  await page.getByTestId('home-doc-title').waitFor({timeout: 30_000})
}

/** Open the sidebar and tap one of its entries. */
async function sidebarNavigate(page: Page, entryTestId: string): Promise<void> {
  await page.getByTestId('open-sidebar').click()
  await page.getByTestId(entryTestId).click()
}

describe('Mobile app (web) e2e', () => {
  it(
    'loads the home page of the selected server',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      // The home document is resolved via /hm/api/config -> registeredAccountUid
      await expect
        .poll(async () => page.getByTestId('home-doc-title').textContent(), {timeout: 30_000})
        .toBe(FIXTURE_ACCOUNT_NAME)
      expect(await page.getByTestId('home-doc-content').textContent()).toContain(FIXTURE_HOME_CONTENT.trim())
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'renders query block results as cards on the home page',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      // The Query block lists the space's children; the hierarchy fixture
      // document is a direct child and must appear as a card
      const card = page.getByTestId('query-block-card').first()
      await card.waitFor({timeout: 30_000})
      await expect
        .poll(async () => page.getByTestId('query-block-cards').textContent(), {timeout: 30_000})
        .toContain(BLOG_POST_TITLE)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'renders embed blocks as document cards',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)
      const embed = page.getByTestId('embed-card').first()
      await embed.waitFor({timeout: 30_000})
      expect(await embed.textContent()).toContain(FIXTURE_HIERARCHY_TITLE)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'lists unreferenced child documents below the content',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)
      const section = page.getByTestId('unreferenced-children')
      await section.waitFor({timeout: 30_000})
      const text = await section.textContent()
      // The orphan is unreferenced; the hierarchy doc is embedded above and
      // must NOT repeat here.
      expect(text).toContain(ORPHAN_TITLE)
      expect(text).not.toContain(FIXTURE_HIERARCHY_TITLE)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'shows a connection error for an unreachable server',
    async () => {
      const page = await openApp()
      // Nothing listens on this port; the home page shows the error state
      await page.getByTestId('server-url-input').fill('http://localhost:59999')
      await page.getByTestId('server-connect').click()
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

      await sidebarNavigate(page, 'sidebar-import-identity')
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

      await sidebarNavigate(page, 'sidebar-import-identity')
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

      await sidebarNavigate(page, 'sidebar-import-identity')
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
