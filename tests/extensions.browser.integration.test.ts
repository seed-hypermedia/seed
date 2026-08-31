/**
 * Browser test for the extension system (docs/extensions/design.md §9,
 * docs/extensions/testing.md).
 *
 * Against a real daemon + web server started from fixture data, this test:
 *   1. publishes the `hello-signer` example as an extension document under the
 *      fixture site account (the same steps `seed-cli extension publish` runs),
 *   2. installs it on the site home document at mount `hello` (as
 *      `seed-cli extension install` does, pinned to the published version),
 *   3. drives headless Chromium through the mounted page in site-native form
 *      (`/hello`) and gateway form (`/hm/<uid>/hello`), checking the sandboxed
 *      iframe, the `hello` handshake, `storage.set`, `sign.data` without a
 *      signed-in user, and the `?extdev=` developer override.
 *
 * Run `pnpm test:install-browsers` first to install Chromium. The example must
 * be built (`pnpm --filter @seed-extensions/hello-signer build`); when the
 * build output is missing the test builds it.
 */

import {execSync} from 'child_process'
import {existsSync} from 'fs'
import path from 'path'
import {chromium, type Browser, type BrowserContext, type Frame, type Page} from 'playwright'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_ID} from '../frontend/apps/cli/src/test/fixture-seed'
import {
  buildInstallRecord,
  finalizeManifest,
  installRecordAttributes,
  readExtensionPackage,
} from '../frontend/apps/cli/src/utils/extension'
import {diffAttributes, setAttributesOp, signAndPublishChange} from '../frontend/apps/cli/src/utils/publish'
import {createSignerFromKey} from '../frontend/apps/cli/src/utils/signer'
import {createSeedClient, fileToIpfsBlobs, resolveEditableDocument, unpackHmId} from '../frontend/packages/client/src'
import {EXTENSION_DEV_QUERY_PARAM} from '../frontend/packages/client/src/extensions'
import {setupTestEnv, type TestEnv} from './integration'

const TEST_TIMEOUT = 180_000
const SETUP_TIMEOUT = 600_000

/** Sandbox flags the host must use; `allow-same-origin` must never appear (design §6). */
const EXPECTED_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads'

const MOUNT = 'hello'
/** Where the extension document lives; distinct from the mount so the install does not shadow it. */
const EXTENSION_DOC_PATH = '/extensions/hello-signer'
const EXTENSION_ID = `hm://${FIXTURE_ACCOUNT_ID}${EXTENSION_DOC_PATH}`
/** A URL nothing listens on: the dev-override iframe must point at it, it does not need to load. */
const DEV_URL = 'http://127.0.0.1:1/'

const REPO_ROOT = path.resolve(__dirname, '..')
const HELLO_SIGNER_DIR = path.join(REPO_ROOT, 'extensions/examples/hello-signer')

let env: TestEnv
let browser: Browser
let extensionVersion: string
let entryCid: string

const IFRAME = '[data-testid="extension-iframe"]'
const DEV_BANNER = '[data-testid="extension-dev-banner"]'
const SIGN_DIALOG = '[data-testid="extension-sign-confirm"]'

function ensureHelloSignerBuilt(): string {
  const entry = path.join(HELLO_SIGNER_DIR, 'dist', 'index.html')
  if (!existsSync(entry)) {
    console.log('[Extensions] hello-signer dist missing, building it...')
    execSync('pnpm --filter @seed-extensions/hello-signer build', {cwd: REPO_ROOT, stdio: 'inherit'})
  }
  if (!existsSync(entry)) throw new Error(`hello-signer build output not found at ${entry}`)
  return entry
}

/**
 * Publish the example as an extension document, mirroring `extension publish`:
 * chunk the entry HTML into IPFS blocks, validate the manifest with the entry
 * CID, and write name/summary/seedExtension as nested metadata attributes.
 */
async function publishHelloSigner(serverUrl: string): Promise<{version: string; entryCid: string}> {
  const pkg = readExtensionPackage(HELLO_SIGNER_DIR)
  const entry = await fileToIpfsBlobs(pkg.entryBytes)
  const manifest = finalizeManifest(pkg.manifestRaw, entry.cid)
  const metadata = {
    name: pkg.name,
    ...(manifest.description ? {summary: manifest.description} : {}),
    seedExtension: manifest,
  }
  const client = createSeedClient(serverUrl)
  const signer = createSignerFromKey(FIXTURE_ACCOUNT.keyPair)
  const {version} = await signAndPublishChange({
    client,
    signer,
    space: FIXTURE_ACCOUNT_ID,
    path: EXTENSION_DOC_PATH,
    ops: [setAttributesOp(diffAttributes([], metadata, undefined))],
    blobs: entry.blobs.map((b) => ({data: b.data, cid: b.cid})),
  })
  return {version, entryCid: entry.cid}
}

/** Install the extension on the fixture site's home document, pinned, mirroring `extension install`. */
async function installHelloSigner(serverUrl: string, version: string): Promise<void> {
  const client = createSeedClient(serverUrl)
  const signer = createSignerFromKey(FIXTURE_ACCOUNT.keyPair)
  const homeId = unpackHmId(`hm://${FIXTURE_ACCOUNT_ID}`)
  if (!homeId) throw new Error('Invalid fixture account id')
  const base = await resolveEditableDocument(client, homeId)
  const record = buildInstallRecord({ext: EXTENSION_ID, version})
  await signAndPublishChange({
    client,
    signer,
    space: FIXTURE_ACCOUNT_ID,
    path: '',
    ops: [setAttributesOp(installRecordAttributes(MOUNT, record, undefined))],
    base: base.state,
  })
}

/** Poll the web server's resource API until the home document carries the install record. */
async function waitForInstallVisible(serverUrl: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${serverUrl}/hm/api/resource/${FIXTURE_ACCOUNT_ID}`)
      if (res.ok) {
        const body = (await res.json()) as {json?: any}
        const resource = body.json ?? body
        last = resource
        const record = resource?.document?.metadata?.extensions?.[MOUNT]
        if (record && typeof record === 'object') return record as Record<string, unknown>
      }
    } catch (error) {
      last = error
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`Install record for /${MOUNT} never appeared on the home document. Last: ${JSON.stringify(last)}`)
}

type PageErrors = {consoleErrors: string[]; pageErrors: Error[]}

function trackErrors(page: Page): PageErrors {
  const errors: PageErrors = {consoleErrors: [], pageErrors: []}
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.consoleErrors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.pageErrors.push(error))
  return errors
}

function describeErrors(errors: PageErrors): string {
  return `Runtime errors:\n${errors.pageErrors
    .map((e) => e.stack ?? e.message)
    .join('\n')}\nConsole errors:\n${errors.consoleErrors.join('\n')}`
}

async function openPage(context: BrowserContext, url: string) {
  const page = await context.newPage()
  const errors = trackErrors(page)
  const response = await page.goto(url, {waitUntil: 'domcontentloaded'})
  return {page, errors, response}
}

/** Wait for the sandboxed extension iframe and return its element handle plus the attributes under test. */
async function waitForExtensionIframe(page: Page, errors: PageErrors) {
  try {
    await page.waitForSelector(IFRAME, {state: 'attached', timeout: 60_000})
  } catch (error) {
    throw new Error(`Extension iframe never rendered.\n${describeErrors(errors)}\n${error}`)
  }
  const iframe = page.locator(IFRAME).first()
  const sandbox = await iframe.getAttribute('sandbox')
  const srcdoc = await iframe.getAttribute('srcdoc')
  const src = await iframe.getAttribute('src')
  return {iframe, sandbox, srcdoc, src}
}

/** The frame the extension runs in (found through the iframe element, not by URL, since `srcdoc` frames share `about:srcdoc`). */
async function extensionFrame(page: Page): Promise<Frame> {
  const handle = await page.$(IFRAME)
  if (!handle) throw new Error('Extension iframe element not found')
  const frame = await handle.contentFrame()
  if (!frame) throw new Error('Extension iframe has no content frame')
  return frame
}

/** Resolve once the frame's visible text (case-insensitive) contains `needle`. */
async function waitForFrameText(frame: Frame, needle: string, errors: PageErrors, timeout = 60_000) {
  try {
    await frame.waitForFunction(
      (text) => (document.body?.innerText ?? '').toLowerCase().includes(text.toLowerCase()),
      needle,
      {timeout, polling: 250},
    )
  } catch (error) {
    let bodyText = '(unavailable)'
    try {
      bodyText = await frame.evaluate(() => document.body?.innerText ?? '')
    } catch {}
    throw new Error(
      `Frame text never contained "${needle}".\nFrame text:\n${bodyText}\n${describeErrors(errors)}\n${error}`,
    )
  }
}

async function frameText(frame: Frame): Promise<string> {
  return frame.evaluate(() => document.body?.innerText ?? '')
}

beforeAll(async () => {
  ensureHelloSignerBuilt()

  env = await setupTestEnv({
    webPort: 3410,
    daemonHttpPort: 59111,
    daemonGrpcPort: 59112,
    daemonP2pPort: 59113,
    skipBuild: process.env.SKIP_BUILD === 'true',
  })

  try {
    const published = await publishHelloSigner(env.web.baseUrl)
    extensionVersion = published.version
    entryCid = published.entryCid
    console.log(`[Extensions] Published ${EXTENSION_ID} version ${extensionVersion} (entry ${entryCid})`)
    await installHelloSigner(env.web.baseUrl, extensionVersion)
    const record = await waitForInstallVisible(env.web.baseUrl)
    console.log(`[Extensions] Installed at /${MOUNT}: ${JSON.stringify(record)}`)
    expect(record).toEqual({ext: EXTENSION_ID, version: extensionVersion})
  } catch (error) {
    await env.cleanup()
    throw error
  }

  try {
    browser = await chromium.launch({headless: true})
  } catch (error) {
    await env.cleanup()
    throw new Error(
      `Playwright Chromium could not be launched. Run \`pnpm test:install-browsers\` from tests/ before running browser integration tests.\n${error}`,
    )
  }
}, SETUP_TIMEOUT)

afterAll(async () => {
  await browser?.close()
  await env?.cleanup()
})

describe('Extension pages in the browser', () => {
  it(
    'serves the published entry HTML by CID',
    async () => {
      const res = await fetch(`${env.web.baseUrl}/hm/api/file/${entryCid}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('<script')
      expect(html).toContain('Hello Signer')
    },
    TEST_TIMEOUT,
  )

  it(
    'mounts the extension at /hello in a sandboxed iframe and completes the hello handshake',
    async () => {
      const context = await browser.newContext()
      try {
        const url = `${env.web.baseUrl}/${MOUNT}`

        // SSR: the document is served (200) with the mount's title, before any client code runs.
        const ssr = await fetch(url)
        expect(ssr.status).toBe(200)
        const ssrHtml = await ssr.text()
        const title = /<title[^>]*>([^<]*)<\/title>/i.exec(ssrHtml)?.[1] ?? ''
        expect(title.toLowerCase(), `SSR <title> was "${title}"`).toContain('hello')

        const {page, errors, response} = await openPage(context, url)
        expect(response?.status()).toBe(200)

        // The iframe appears after hydration with exactly the expected sandbox flags and srcdoc content.
        const {sandbox, srcdoc, src} = await waitForExtensionIframe(page, errors)
        expect(sandbox).toBe(EXPECTED_SANDBOX)
        expect(sandbox).not.toContain('allow-same-origin')
        expect(srcdoc, 'published entry must load through srcdoc').toBeTruthy()
        expect(srcdoc).toContain('Hello Signer')
        expect(src).toBeNull()

        // `hello` completed: hello-signer renders its "Context (live)" panel with the context JSON.
        const frame = await extensionFrame(page)
        await waitForFrameText(frame, 'context (live)', errors)
        await waitForFrameText(frame, EXTENSION_ID, errors)
        const text = await frameText(frame)
        expect(text).toContain('Not signed in')
        expect(text).toContain(`"extensionVersion": "${extensionVersion}"`)
        expect(text).toContain(`"mountPath": "${MOUNT}"`)
        expect(text).toContain('"platform": "web"')
        expect(text).toContain('"dev": false')
        expect(text).toContain('RESPONSE hello')

        // storage.set round-trips through the host (no user needed).
        await frame.getByRole('button', {name: 'Increment stored counter'}).click()
        await waitForFrameText(frame, 'RESPONSE storage.set', errors)
        await waitForFrameText(frame, 'counter: 1', errors)

        // sign.data without a signed-in user fails with not_signed_in and never opens the host dialog.
        await frame.getByRole('button', {name: 'Sign this text'}).click()
        await waitForFrameText(frame, 'ERROR sign.data', errors)
        // hello-signer renders `not_signed_in` as this sentence (src/errors.ts).
        await waitForFrameText(frame, 'Sign in to the site first', errors)
        expect(await page.locator(SIGN_DIALOG).count(), 'no sign confirmation dialog for an anonymous viewer').toBe(0)
        expect(await frameText(frame)).not.toContain('signature=')

        expect(
          errors.pageErrors.map((e) => e.stack ?? e.message),
          describeErrors(errors),
        ).toHaveLength(0)
      } finally {
        await context.close()
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'mounts the same extension on the gateway path /hm/<uid>/hello',
    async () => {
      const context = await browser.newContext()
      try {
        const url = `${env.web.baseUrl}/hm/${FIXTURE_ACCOUNT_ID}/${MOUNT}`
        const {page, errors, response} = await openPage(context, url)
        expect(response?.status()).toBe(200)

        const {sandbox, srcdoc, src} = await waitForExtensionIframe(page, errors)
        expect(sandbox).toBe(EXPECTED_SANDBOX)
        expect(srcdoc).toBeTruthy()
        expect(src).toBeNull()

        const frame = await extensionFrame(page)
        await waitForFrameText(frame, 'context (live)', errors)
        await waitForFrameText(frame, EXTENSION_ID, errors)
        expect(await frameText(frame)).toContain(`"mountPath": "${MOUNT}"`)

        expect(
          errors.pageErrors.map((e) => e.stack ?? e.message),
          describeErrors(errors),
        ).toHaveLength(0)
      } finally {
        await context.close()
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'honours ?extdev= as a developer override and ?extdev=off clears it',
    async () => {
      const context = await browser.newContext()
      try {
        const base = `${env.web.baseUrl}/${MOUNT}`

        // Set the override: the iframe points at the dev URL (still sandboxed) and the banner shows.
        const withDev = await openPage(context, `${base}?${EXTENSION_DEV_QUERY_PARAM}=${encodeURIComponent(DEV_URL)}`)
        expect(withDev.response?.status()).toBe(200)
        await withDev.page.waitForSelector(DEV_BANNER, {state: 'attached', timeout: 60_000})
        expect(await withDev.page.locator(DEV_BANNER).innerText()).toContain(DEV_URL)
        const dev = await waitForExtensionIframe(withDev.page, withDev.errors)
        expect(dev.src).toBe(DEV_URL)
        expect(dev.srcdoc).toBeNull()
        expect(dev.sandbox).toBe(EXPECTED_SANDBOX)
        // The host consumes the parameter from the URL.
        await withDev.page.waitForFunction(
          (param) => !new URL(window.location.href).searchParams.has(param),
          EXTENSION_DEV_QUERY_PARAM,
          {timeout: 30_000},
        )
        await withDev.page.close()

        // The override persists in this browser context across loads.
        const again = await openPage(context, base)
        await again.page.waitForSelector(DEV_BANNER, {state: 'attached', timeout: 60_000})
        expect((await waitForExtensionIframe(again.page, again.errors)).src).toBe(DEV_URL)
        await again.page.close()

        // Clear it: the banner disappears and the published entry loads through srcdoc again.
        const cleared = await openPage(context, `${base}?${EXTENSION_DEV_QUERY_PARAM}=off`)
        const published = await waitForExtensionIframe(cleared.page, cleared.errors)
        expect(published.src).toBeNull()
        expect(published.srcdoc).toBeTruthy()
        expect(await cleared.page.locator(DEV_BANNER).count()).toBe(0)
        const frame = await extensionFrame(cleared.page)
        await waitForFrameText(frame, 'context (live)', cleared.errors)
        expect(await frameText(frame)).toContain('"dev": false')
        expect(
          cleared.errors.pageErrors.map((e) => e.stack ?? e.message),
          describeErrors(cleared.errors),
        ).toHaveLength(0)
      } finally {
        await context.close()
      }
    },
    TEST_TIMEOUT,
  )
})
