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
import {createComment} from '../frontend/packages/client/src/comment'
import {createSeedClient} from '../frontend/packages/client/src/client'
import {nobleKeyPairFromSeed} from '../frontend/packages/client/src/blobs'
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
const COMMENT_TEXT = 'A comment from the integration test'

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
  await createDocumentUpdate(env.web.baseUrl, FIXTURE_ACCOUNT, 'orphan-page', [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: ORPHAN_TITLE}]},
  ])
  await createDocumentUpdate(env.web.baseUrl, FIXTURE_ACCOUNT, 'blog/post-one', [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: BLOG_POST_TITLE}]},
    // A card inside a document, so the e2e can follow a link from a document
    // page onto another document page (each one a new screen on the stack).
    {
      type: 'ReplaceBlock',
      block: {
        type: 'Embed',
        id: 'postembed',
        text: '',
        annotations: [],
        link: `hm://${FIXTURE_ACCOUNT_ID}/orphan-page`,
        attributes: {view: 'Card'},
      },
    },
    {type: 'MoveBlocks', parent: '', blocks: ['postembed']},
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

  // Post a real comment on the blog post so the Discussions tab has content.
  {
    const client = createSeedClient(env.web.baseUrl)
    const blogId = {
      id: `hm://${FIXTURE_ACCOUNT_ID}/blog/post-one`,
      uid: FIXTURE_ACCOUNT_ID,
      path: ['blog', 'post-one'],
      version: null,
      blockRef: null,
      blockRange: null,
      hostname: null,
      scheme: null,
      latest: true,
    }
    const resource = await client.request('Resource', blogId)
    if (resource.type !== 'document') throw new Error('blog post missing before commenting')
    const signer = nobleKeyPairFromSeed(FIXTURE_ACCOUNT.keyPair.privateKey)
    const publishInput = await createComment(
      {
        docId: blogId,
        docVersion: resource.document.version,
        content: [
          {
            block: {type: 'Paragraph', id: 'c1', text: COMMENT_TEXT, annotations: [], attributes: {}},
            children: [],
          },
        ],
      },
      signer,
    )
    await client.publish(publishInput)
  }

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

// Connecting resolves the server's registered site and lands on that
// document's page - the same Document screen every other page uses.
async function connectToServer(page: Page, serverUrl: string): Promise<void> {
  await page.getByTestId('server-url-input').fill(serverUrl)
  await page.getByTestId('server-connect').click()
  await page.getByTestId('site-home').waitFor({timeout: 30_000})
}

/** The document title of the site home (bottom of the stack). */
function siteHomeTitle(page: Page) {
  return page.getByTestId('site-home').getByTestId('document-title')
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
      await expect.poll(async () => siteHomeTitle(page).textContent(), {timeout: 30_000}).toBe(FIXTURE_ACCOUNT_NAME)
      expect(await page.getByTestId('site-home').textContent()).toContain(FIXTURE_HOME_CONTENT.trim())
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
    'opens the document page when a card is tapped, and shows its discussions',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      // Tap the query-block card for the blog post
      const card = page.getByTestId('query-block-card-press').first()
      await card.waitFor({timeout: 30_000})
      await card.click()

      // A new document page is pushed on top of the site home, on the Content tab
      const doc = page.getByTestId('document-screen')
      await doc.waitFor({timeout: 30_000})
      await expect
        .poll(async () => doc.getByTestId('document-title').textContent(), {timeout: 30_000})
        .toBe(BLOG_POST_TITLE)

      // The Comments tab shows the comment posted in setup
      await doc.getByTestId('tab-comments').click()
      await doc.getByTestId('discussion-comment').first().waitFor({timeout: 30_000})
      expect(await doc.getByTestId('discussions-list').textContent()).toContain(COMMENT_TEXT)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'stacks a new screen for every link followed, so back returns to the previous document',
    async () => {
      const page = await openApp()
      await connectToServer(page, env.web.baseUrl)

      // Site home -> blog post
      await page.getByTestId('query-block-card-press').first().click()
      const firstDoc = page.getByTestId('document-screen').last()
      await expect
        .poll(async () => firstDoc.getByTestId('document-title').textContent(), {timeout: 30_000})
        .toBe(BLOG_POST_TITLE)

      // Blog post -> the document its embed card points at. This must PUSH a
      // second document screen; navigating to the already-mounted Document
      // route instead would swap this screen's params and lose the way back.
      await firstDoc.getByTestId('embed-card-press').first().click()
      await expect.poll(async () => page.getByTestId('document-screen').count(), {timeout: 30_000}).toBe(2)
      const secondDoc = page.getByTestId('document-screen').last()
      await expect
        .poll(async () => secondDoc.getByTestId('document-title').textContent(), {timeout: 30_000})
        .toBe(ORPHAN_TITLE)

      // The site home is still underneath both of them
      expect(await page.getByTestId('site-home').count()).toBe(1)
      await page.context().close()
    },
    TEST_TIMEOUT,
  )

  it(
    'shows a connection error for an unreachable server',
    async () => {
      const page = await openApp()
      // Nothing listens on this port: connecting resolves the site config, so
      // the failure surfaces on the server picker instead of a broken page.
      await page.getByTestId('server-url-input').fill('http://localhost:59999')
      await page.getByTestId('server-connect').click()
      await expect
        .poll(async () => page.getByTestId('connection-status').textContent(), {timeout: 30_000})
        .toContain('Failed to connect')
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
