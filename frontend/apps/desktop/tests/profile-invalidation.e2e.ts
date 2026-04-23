/**
 * E2E test: Profile invalidation via activity polling.
 *
 * Verifies that when a document with @mentions loads and the referenced
 * profiles sync from the network, the mention text resolves to a name
 * automatically (no manual refresh needed).
 *
 * Prerequisites:
 *   1. Run `./dev run-desktop` at least once so that `.vite/build/main.js` exists.
 *      (Or run `pnpm --filter @shm/desktop dev` and then stop it.)
 *   2. Set TEST_DOCUMENT_URL to a document URL containing @mentions.
 *
 * Usage:
 *   TEST_DOCUMENT_URL="https://eric-dev.dev.hyper.media/z6DwBmA9uvsQK3" \
 *     pnpm --filter @shm/desktop e2e -- --grep "profile invalidation"
 */
import {test, expect} from '@playwright/test'
import {_electron as electron} from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const MAIN_JS = path.join(DESKTOP_ROOT, '.vite', 'build', 'main.js')
const ELECTRON_BIN = path.join(DESKTOP_ROOT, '..', '..', '..', 'node_modules', '.bin', 'electron')

/** The URL of a document with @mentions to test against. */
const TEST_DOC_URL = process.env.TEST_DOCUMENT_URL || ''

/** Fresh temp directory for app data so each run starts clean. */
function makeTempAppData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-e2e-'))
  return dir
}

test.describe('profile invalidation', () => {
  test.skip(!TEST_DOC_URL, 'Set TEST_DOCUMENT_URL env var to run this test')
  test.skip(!fs.existsSync(MAIN_JS), 'Build the app first: ./dev run-desktop (then stop it)')

  test('mention names resolve after profile sync without refresh', async () => {
    test.setTimeout(120_000) // Syncing can take a while

    const appDataDir = makeTempAppData()

    const app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DESKTOP_APPDATA: appDataDir,
      },
    })

    try {
      const page = await app.firstWindow()

      // Wait for the daemon to become ready (the main content area appears)
      await page.waitForSelector('[data-testid="main-content"], #root', {timeout: 30_000})

      // Give daemon a moment to start
      await page.waitForTimeout(3_000)

      // Open omnibar with Cmd+K
      await page.keyboard.press('Meta+k')
      await page.waitForTimeout(500)

      // Type the document URL into the omnibar
      await page.keyboard.type(TEST_DOC_URL, {delay: 20})
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')

      // Wait for the document to load (look for the document content area)
      await page.waitForTimeout(5_000)

      // Now wait for mention tokens to appear (they render as .mention-text elements)
      const mentionSelector = '.mention-text'
      await page.waitForSelector(mentionSelector, {timeout: 90_000})

      // Collect mention texts
      const mentions = await page.$$eval(mentionSelector, (els) =>
        els.map((el) => (el as HTMLElement).textContent?.trim() || ''),
      )

      console.log('[E2E] Found mentions:', mentions)

      // Assert that at least one mention resolved to something other than
      // a raw account UID (z6Mk...) or "ERROR"
      const resolvedMentions = mentions.filter(
        (m) => m && !m.startsWith('z6Mk') && !m.startsWith('hm://') && m !== 'ERROR',
      )

      expect(resolvedMentions.length).toBeGreaterThan(0)
      console.log('[E2E] Resolved mentions:', resolvedMentions)
    } finally {
      // Clean up
      await app.close()
      fs.rmSync(appDataDir, {recursive: true, force: true})
    }
  })
})
