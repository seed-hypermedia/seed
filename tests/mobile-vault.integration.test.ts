/**
 * Mobile Remote Vault Connect e2e test (web build)
 *
 * Drives the Expo/react-native-web build of the mobile app with Playwright
 * against a real local stack:
 *
 *   daemon (seed-daemon binary) <- web app (serves /api) <- mobile app (browser)
 *                                  vault server (bun)    <- mobile app + this test
 *
 * The test itself plays TWO protocol roles with byte-level fidelity:
 * - the WEB ACTOR (browser at the vault site): registers a user, seeds the
 *   encrypted vault, and plays the consent step of the connect ceremony
 *   (secret credential + XChaCha20 payload into the one-time mailbox);
 * - the VERIFIER: decrypts what the mobile device uploads with the web
 *   actor's own DEK, proving a cross-actor versioned round-trip.
 *
 * SDK access is via RELATIVE imports into frontend/packages/client/src (the
 * tests package deliberately has no dependency on @seed-hypermedia/client).
 * Only the Go-parity codec (serializeState/deserializeState) is used — never
 * the legacy name-deduping serialize/deserialize.
 *
 * testID contract (implementation plan §6): vault-url-input,
 * vault-connect-start, vault-connect-url, vault-status, identity-${accountId},
 * create-identity-name-input, create-identity-submit, identity-publish-profile,
 * publish-status. Additional selectors this test relies on (navigation /
 * error-surface points the plan describes without naming testIDs):
 * - testID "open-vault": HomeScreen entry point to the Vault screen
 * - testID "vault-create-identity": VaultScreen button opening CreateIdentityScreen
 * - visible text "Invalid vault URL" after starting a connection with a
 *   malformed URL (the normalizeVaultOriginURL error message)
 * - visible text "Failed to decrypt vault connect payload." when the ceremony
 *   payload cannot be decrypted (src/vault/connect.ts error, rendered as
 *   lastConnectError)
 * - a button matching /try again/i on the connect screen for the fresh-mint retry
 * Desktop-parity additions (profile editing + .seedkey export/import):
 * - profile editor: profile-name-input, profile-save, profile-save-status,
 *   profile-icon-preview, and the hidden DOM file input
 *   data-testid="profile-icon-input" (driven with setInputFiles)
 * - export: identity-export, identity-export-confirm, identity-export-payload
 * - import: vault-import-seedkey, seedkey-input, seedkey-submit, seedkey-error
 *
 * Prerequisites: daemon binary built (plz-out/bin/backend), `npm install` run
 * in frontend/apps/mobile, `bun` on PATH (vault server), and Chromium
 * installed (pnpm test:install-browsers).
 */

import {hkdf} from '@noble/hashes/hkdf.js'
import {sha256} from '@noble/hashes/sha2.js'
import {chromium, type Browser, type BrowserContext, type Page} from 'playwright'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {createSeedClient} from '../frontend/packages/client/src/client'
import {decrypt, encrypt} from '../frontend/packages/client/src/encryption'
import {accountIdFromSeed, deserializeState, serializeState, type State} from '../frontend/packages/client/src/vault'
import {setupTestEnv, startExpoWeb, startVaultServer, type ExpoWebInstance, type TestEnv} from './integration'
import type {VaultServerInstance} from './integration'

const TEST_TIMEOUT = 300_000

// Ports: must not collide with any other suite in tests/ (mobile-web uses web
// 3401 / daemon 59301-3 / expo 8199; ssr 3399/59001-3; hydration 3400/59101-3;
// register-key 59201-3).
const WEB_PORT = 3403
const DAEMON_HTTP_PORT = 59321
const DAEMON_GRPC_PORT = 59322
const DAEMON_P2P_PORT = 59323
const EXPO_PORT = 8399
const VAULT_PORT = 3501

// HKDF info string for secret-credential auth keys (Go deriveVaultSecretAuthKey,
// client vault.ts deriveSecretCredentialAuthKey).
const SECRET_AUTH_INFO = 'seed-hypermedia-vault-secret-authentication'

const utf8 = (value: string) => new TextEncoder().encode(value)

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function b64urlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function extractConnectToken(connectUrl: string): string {
  const match = connectUrl.match(/[#&]token=([A-Za-z0-9_-]+)/)
  if (!match) throw new Error(`No token fragment in connect URL: ${connectUrl}`)
  return match[1]
}

/** Minimal cookie jar for the web actor's vault-server session. */
class CookieJar {
  #cookies = new Map<string, string>()

  storeFrom(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';')
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!value) this.#cookies.delete(name)
      else this.#cookies.set(name, value)
    }
  }

  header(): string {
    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  get size(): number {
    return this.#cookies.size
  }
}

let env: TestEnv
let vault: VaultServerInstance
let expo: ExpoWebInstance
let browser: Browser

const jar = new CookieJar()
const webActorEmail = `web-actor-${Date.now()}@example.com`
// The vault DEK the web actor generates at registration. 64 bytes like the
// vault web frontend (XChaCha20 keying uses the first 32).
const dek = randomBytes(64)
const webSeed = randomBytes(32)
const webAccountId = accountIdFromSeed(webSeed)

let userId: string
/** Server version right after the web actor's seeding write. */
let postSeedVersion: number
let mobileContext: BrowserContext
let mobilePage: Page
let mobileAccountId: string
/** Second device: fresh context used for the .seedkey import round-trip. */
let importContext: BrowserContext
let importPage: Page

// A 1x1 RGB PNG built by hand (signature + IHDR + IDAT + IEND with valid
// CRCs) and verified against the web app's sharp pipeline — tiny but a fully
// valid image for the /hm/api/image loader.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwmjULAAKwAX+P+7cHAAAAAElFTkSuQmCC',
  'base64',
)

/** Authenticated JSON call against the vault server as the web actor. */
async function vaultApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<{status: number; json: Record<string, any>}> {
  const response = await fetch(`${vault.baseUrl}/vault/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      ...(jar.size ? {Cookie: jar.header()} : {}),
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  })
  jar.storeFrom(response)
  const json = (await response.json()) as Record<string, any>
  return {status: response.status, json}
}

async function vaultApiOk(method: string, path: string, body?: unknown): Promise<Record<string, any>> {
  const {status, json} = await vaultApi(method, path, body)
  if (status < 200 || status >= 300) {
    throw new Error(`${method} /vault/api${path} failed: ${status} ${JSON.stringify(json)}`)
  }
  return json
}

/** GET the vault as the web actor and decrypt the state with the test's DEK. */
async function fetchDecryptedServerVault(): Promise<{version: number; state: State | null}> {
  const json = await vaultApiOk('GET', '/vault')
  if (!json.encryptedData) return {version: json.version, state: null}
  const state = await deserializeState(await decrypt(b64urlDecode(json.encryptedData), dek))
  return {version: json.version, state}
}

beforeAll(async () => {
  env = await setupTestEnv({
    webPort: WEB_PORT,
    daemonHttpPort: DAEMON_HTTP_PORT,
    daemonGrpcPort: DAEMON_GRPC_PORT,
    daemonP2pPort: DAEMON_P2P_PORT,
    skipBuild: process.env.SKIP_BUILD === 'true',
  })

  try {
    vault = await startVaultServer({port: VAULT_PORT, backendHttpPort: DAEMON_HTTP_PORT})
    await vault.waitForReady()
  } catch (error) {
    await env.cleanup()
    throw error
  }

  try {
    expo = await startExpoWeb({port: EXPO_PORT})
    await expo.waitForReady()
    await expo.prewarmBundle()
  } catch (error) {
    await vault.kill()
    await env.cleanup()
    throw error
  }

  try {
    browser = await chromium.launch({headless: true})
  } catch (error) {
    await expo.kill()
    await vault.kill()
    await env.cleanup()
    throw new Error(
      `Playwright Chromium could not be launched. Run \`pnpm test:install-browsers\` from tests/ first.\n${error}`,
    )
  }
}, TEST_TIMEOUT)

afterAll(async () => {
  await importContext?.close().catch(() => {})
  await mobileContext?.close().catch(() => {})
  await browser?.close()
  await expo?.kill()
  await vault?.kill()
  await env?.cleanup()
})

/** Opens the app in a fresh browser context (fresh localStorage = fresh vault). */
async function openApp(): Promise<{context: BrowserContext; page: Page}> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(expo.baseUrl, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('server-url-input').waitFor({timeout: 60_000})
  return {context, page}
}

async function connectToServer(page: Page, serverUrl: string): Promise<void> {
  await page.getByTestId('server-url-input').fill(serverUrl)
  await page.getByTestId('server-connect').click()
  await expect
    .poll(async () => page.getByTestId('connection-status').textContent(), {timeout: 30_000})
    .toBe('Connected')
}

async function openVaultScreen(page: Page): Promise<void> {
  await page.getByTestId('open-vault').click()
  await page.getByTestId('vault-url-input').waitFor({timeout: 30_000})
}

/**
 * Plays the browser actor's consent step (vault/src/frontend/store.ts
 * handleVaultConnectApproval): mint a device secret credential, then post the
 * encrypted connection payload into the one-time mailbox under
 * connectId = b64url(sha256(token bytes)).
 */
async function playConsentStep(token: string): Promise<{credentialId: string; secret: Uint8Array}> {
  const secret = randomBytes(32)
  const authKey = hkdf(sha256, secret, undefined, utf8(SECRET_AUTH_INFO), 32)
  const credentialResult = await vaultApiOk('POST', '/credentials/secret', {
    authKey: b64url(authKey),
    wrappedDEK: b64url(await encrypt(dek, secret)),
  })
  const credentialId = credentialResult.credentialId as string
  expect(credentialId).toBeTruthy()

  const tokenBytes = b64urlDecode(token)
  const payloadJson = JSON.stringify({
    vaultUrl: vault.vaultUrl,
    userId,
    credentialId,
    secret: b64url(secret),
  })
  await vaultApiOk('POST', '/vault-connect', {
    connectId: b64url(sha256(tokenBytes)),
    payload: b64url(await encrypt(utf8(payloadJson), tokenBytes)),
  })
  return {credentialId, secret}
}

describe('Mobile Remote Vault Connect e2e', () => {
  it(
    'registers the web actor and seeds the vault',
    async () => {
      await vaultApiOk('POST', '/register/start', {email: webActorEmail})
      const code = await vault.waitForVerificationCode(webActorEmail)
      const verified = await vaultApiOk('POST', '/register/verify', {code})
      expect(verified.verified).toBe(true)
      expect(verified.userId).toBeTruthy()
      userId = verified.userId

      // Fresh users start at version 1 (users.version DEFAULT 1). The version
      // field of the seeding POST must echo the server's CURRENT version.
      const fresh = await vaultApiOk('GET', '/vault')
      expect(fresh.version).toBe(1)
      expect(fresh.encryptedData).toBeUndefined()

      const state: State = {
        version: 2,
        accounts: [{name: 'web-identity', seed: webSeed, createTime: Date.now(), delegations: []}],
      }
      await vaultApiOk('POST', '/vault', {
        encryptedData: b64url(await encrypt(await serializeState(state), dek)),
        version: fresh.version,
      })

      const seeded = await fetchDecryptedServerVault()
      expect(seeded.version).toBe(fresh.version + 1)
      expect(seeded.state).not.toBeNull()
      expect(seeded.state!.accounts).toHaveLength(1)
      expect(seeded.state!.accounts[0].name).toBe('web-identity')
      expect(hex(seeded.state!.accounts[0].seed)).toBe(hex(webSeed))
      postSeedVersion = seeded.version
    },
    TEST_TIMEOUT,
  )

  it(
    'connects the mobile device via the vault-connect ceremony',
    async () => {
      const opened = await openApp()
      mobileContext = opened.context
      mobilePage = opened.page
      await connectToServer(mobilePage, env.web.baseUrl)
      await openVaultScreen(mobilePage)

      await mobilePage.getByTestId('vault-url-input').fill(vault.vaultUrl)
      await mobilePage.getByTestId('vault-connect-start').click()

      // The connect URL is always rendered as selectable text; the one-time
      // token rides only in the URL fragment.
      await mobilePage.getByTestId('vault-connect-url').waitFor({timeout: 30_000})
      const connectUrl = (await mobilePage.getByTestId('vault-connect-url').textContent()) ?? ''
      expect(connectUrl).toContain(`${vault.vaultUrl}/connect#`)
      const token = extractConnectToken(connectUrl)

      await playConsentStep(token)

      // The device polls the mailbox every 2s, then adopts the remote DEK and
      // merges in the remote state: the web identity must appear on mobile.
      await mobilePage.getByTestId(`identity-${webAccountId}`).waitFor({timeout: 60_000})

      // Connect uploads nothing: the empty local vault merges to exactly the
      // remote state, so the server version is unchanged.
      const afterConnect = await vaultApiOk('GET', '/vault')
      expect(afterConnect.version).toBe(postSeedVersion)
    },
    TEST_TIMEOUT,
  )

  it(
    'creates a mobile identity and syncs it to the server',
    async () => {
      await mobilePage.getByTestId('vault-create-identity').click()
      await mobilePage.getByTestId('create-identity-name-input').waitFor({timeout: 30_000})
      await mobilePage.getByTestId('create-identity-name-input').fill('mobile-identity')
      await mobilePage.getByTestId('create-identity-submit').click()

      // Assert on decrypted CONTENT and a strictly increased version — never a
      // hardcoded version number. The web actor's own DEK must decrypt what
      // the mobile device uploaded (the device adopted the remote DEK).
      await expect
        .poll(
          async () => {
            const {version, state} = await fetchDecryptedServerVault()
            if (!state || version <= postSeedVersion) return null
            return state.accounts
              .map((account) => account.name)
              .sort()
              .join(',')
          },
          {timeout: 120_000, interval: 2_000},
        )
        .toBe('mobile-identity,web-identity')

      const {version, state} = await fetchDecryptedServerVault()
      expect(version).toBeGreaterThan(postSeedVersion)
      const webAccount = state!.accounts.find((account) => account.name === 'web-identity')
      const mobileAccount = state!.accounts.find((account) => account.name === 'mobile-identity')
      expect(webAccount).toBeDefined()
      expect(mobileAccount).toBeDefined()
      // Seeds intact through the mobile merge → serialize → encrypt round-trip.
      expect(hex(webAccount!.seed)).toBe(hex(webSeed))
      expect(mobileAccount!.seed).toHaveLength(32)
      mobileAccountId = accountIdFromSeed(mobileAccount!.seed)

      // The new identity is also listed on the mobile Vault screen.
      await mobilePage.getByTestId(`identity-${mobileAccountId}`).waitFor({timeout: 30_000})
    },
    TEST_TIMEOUT,
  )

  it(
    'publishes a profile as the mobile identity',
    async () => {
      await mobilePage.getByTestId(`identity-${mobileAccountId}`).click()
      await mobilePage.getByTestId('identity-publish-profile').waitFor({timeout: 30_000})
      await mobilePage.getByTestId('identity-publish-profile').click()
      await mobilePage.getByTestId('publish-status').waitFor({timeout: 60_000})

      // The authoritative assertion: the seed web server accepted a real
      // signed genesis + change + version ref for the new account.
      const client = createSeedClient(env.web.baseUrl)
      await expect
        .poll(
          async () => {
            const account = await client.request('Account', mobileAccountId).catch(() => null)
            return account?.type === 'account' ? account.metadata?.name : undefined
          },
          {timeout: 60_000, interval: 2_000},
        )
        .toBe('mobile-identity')

      const resource = await client.request('Resource', {
        id: `hm://${mobileAccountId}`,
        uid: mobileAccountId,
        path: null,
        version: null,
        blockRef: null,
        blockRange: null,
        hostname: null,
        scheme: null,
      })
      expect(resource.type).toBe('document')
      if (resource.type === 'document') {
        expect(resource.document.metadata?.name).toBe('mobile-identity')
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'updates the profile name and icon on the existing home document',
    async () => {
      // Still on the Identity screen from the previous test. This exercises
      // the EXISTING-doc path: resolveDocumentState → SetAttributes change on
      // top of the current heads (deps + depth), never a fresh genesis.
      await mobilePage.getByTestId('profile-name-input').fill('Mobile Renamed')

      // The icon rides through the hidden DOM file input (web platform path);
      // the picked image registers by rendering a local preview.
      await mobilePage
        .locator('[data-testid="profile-icon-input"]')
        .setInputFiles({name: 'icon.png', mimeType: 'image/png', buffer: TINY_PNG})
      await mobilePage.getByTestId('profile-icon-preview').waitFor({timeout: 15_000})

      await mobilePage.getByTestId('profile-save').click()
      await expect
        .poll(
          async () =>
            mobilePage
              .getByTestId('profile-save-status')
              .textContent()
              .catch(() => null),
          {timeout: 60_000, interval: 500},
        )
        .toBe('Profile updated')

      // Authoritative server-side assertion: the home document metadata now
      // carries the new name AND an ipfs:// icon, with the icon blobs uploaded
      // in the same client.publish call (no daemon key involved anywhere).
      const client = createSeedClient(env.web.baseUrl)
      let iconValue = ''
      await expect
        .poll(
          async () => {
            const resource = await client
              .request('Resource', {
                id: `hm://${mobileAccountId}`,
                uid: mobileAccountId,
                path: null,
                version: null,
                blockRef: null,
                blockRange: null,
                hostname: null,
                scheme: null,
              })
              .catch(() => null)
            if (resource?.type !== 'document') return null
            iconValue = resource.document.metadata?.icon ?? ''
            return resource.document.metadata?.name
          },
          {timeout: 60_000, interval: 2_000},
        )
        .toBe('Mobile Renamed')

      expect(iconValue).toMatch(/^ipfs:\/\/./)
      const iconCid = iconValue.slice('ipfs://'.length)

      // The uploaded blob is served back through the web server.
      await expect
        .poll(
          async () => {
            const image = await fetch(`${env.web.baseUrl}/hm/api/image/${iconCid}`)
            if (image.status === 200) return 200
            const file = await fetch(`${env.web.baseUrl}/hm/api/file/${iconCid}`)
            return file.status === 200 ? 200 : `image=${image.status} file=${file.status}`
          },
          {timeout: 30_000, interval: 1_000},
        )
        .toBe(200)
    },
    TEST_TIMEOUT,
  )

  it(
    'exports a desktop-format .seedkey and imports it into a fresh vault',
    async () => {
      // Reveal the export on the identity screen (still open): the reveal is
      // gated behind an explicit unencrypted-private-key confirmation.
      await mobilePage.getByTestId('identity-export').click()
      await mobilePage.getByTestId('identity-export-confirm').click()
      await mobilePage.getByTestId('identity-export-payload').waitFor({timeout: 15_000})
      const payload = (await mobilePage.getByTestId('identity-export-payload').textContent()) ?? ''

      // Desktop-parity shape (daemon.go createExportedKeyFile): exactly
      // {createTime, publicKey, keyB64} with an RFC3339 createTime, the
      // base58 principal, and an UNPADDED base64url 32-byte seed that
      // re-derives the same principal.
      const parsed = JSON.parse(payload) as Record<string, string>
      expect(Object.keys(parsed).sort()).toEqual(['createTime', 'keyB64', 'publicKey'])
      expect(Number.isNaN(Date.parse(parsed.createTime))).toBe(false)
      expect(parsed.publicKey).toBe(mobileAccountId)
      expect(parsed.keyB64).not.toContain('=')
      const exportedSeed = b64urlDecode(parsed.keyB64)
      expect(exportedSeed).toHaveLength(32)
      expect(accountIdFromSeed(exportedSeed)).toBe(mobileAccountId)

      // A fresh browser context = a fresh local vault. Importing the pasted
      // payload must materialize the SAME account id from the key bytes alone.
      const opened = await openApp()
      importContext = opened.context
      importPage = opened.page
      await connectToServer(importPage, env.web.baseUrl)
      await openVaultScreen(importPage)
      await importPage.getByTestId('vault-import-seedkey').click()
      await importPage.getByTestId('seedkey-input').fill(payload)
      await importPage.getByTestId('seedkey-submit').click()
      await importPage.getByTestId(`identity-${mobileAccountId}`).waitFor({timeout: 30_000})
    },
    TEST_TIMEOUT,
  )

  it(
    'rejects mangled and password-protected seedkey payloads',
    async () => {
      // The import box closed itself after the successful import — reopen it.
      await importPage.getByTestId('vault-import-seedkey').click()

      await importPage.getByTestId('seedkey-input').fill('this is not a seedkey')
      await importPage.getByTestId('seedkey-submit').click()
      await importPage.getByTestId('seedkey-error').waitFor({timeout: 15_000})
      expect(await importPage.getByTestId('seedkey-error').textContent()).toBe('Invalid key file: not valid JSON.')

      // Typing clears the error; a password-protected desktop export (an
      // "encryption" field) gets the explicit not-supported message — Argon2id
      // is out of reach on Hermes, so this must fail loudly, not mysteriously.
      await importPage
        .getByTestId('seedkey-input')
        .fill(JSON.stringify({encryption: {mode: 'argon2id'}, keyB64: 'AAAA'}))
      await importPage.getByTestId('seedkey-submit').click()
      await expect
        .poll(
          async () =>
            importPage
              .getByTestId('seedkey-error')
              .textContent()
              .catch(() => null),
          {timeout: 15_000, interval: 250},
        )
        .toBe('Password-protected key exports are not supported yet.')
    },
    TEST_TIMEOUT,
  )

  it(
    'surfaces connect errors and mints a fresh token on retry',
    async () => {
      const {context, page} = await openApp()
      try {
        await connectToServer(page, env.web.baseUrl)
        await openVaultScreen(page)

        // A garbage vault URL fails validation before anything is minted.
        await page.getByTestId('vault-url-input').fill('not-a-valid-url')
        await page.getByTestId('vault-connect-start').click()
        await page
          .getByText(/invalid vault url/i)
          .first()
          .waitFor({timeout: 15_000})

        // Real URL, but an undecryptable mailbox payload: the one-time payload
        // is consumed, the failure surfaces as lastConnectError, and recovery
        // requires a fresh mint.
        await page.getByTestId('vault-url-input').fill(vault.vaultUrl)
        await page.getByTestId('vault-connect-start').click()
        await page.getByTestId('vault-connect-url').waitFor({timeout: 30_000})
        const firstConnectUrl = (await page.getByTestId('vault-connect-url').textContent()) ?? ''
        const firstToken = extractConnectToken(firstConnectUrl)

        await vaultApiOk('POST', '/vault-connect', {
          connectId: b64url(sha256(b64urlDecode(firstToken))),
          // Encrypted under the wrong key: the device cannot decrypt it.
          payload: b64url(await encrypt(utf8('{"garbage":true}'), randomBytes(32))),
        })
        // The hidden VaultScreen underneath also renders lastConnectError, so
        // target the connect screen's testID rather than a bare text match.
        await page.getByTestId('vault-connect-error').waitFor({timeout: 30_000})
        expect(await page.getByTestId('vault-connect-error').textContent()).toBe(
          'Failed to decrypt vault connect payload.',
        )

        // Try again mints a FRESH token (the old payload was one-time).
        await page
          .getByText(/try again/i)
          .first()
          .click()
        await expect
          .poll(
            async () => {
              const text =
                (await page
                  .getByTestId('vault-connect-url')
                  .textContent()
                  .catch(() => null)) ?? ''
              return text.includes('#') ? extractConnectToken(text) : null
            },
            {timeout: 30_000, interval: 500},
          )
          .not.toBe(firstToken)
      } finally {
        await context.close()
      }
    },
    TEST_TIMEOUT,
  )
})
