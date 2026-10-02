/**
 * Hosting login with the remote vault's email prevalidation (e2e)
 *
 * A person who is connected to a remote vault has already proven their email
 * to the vault server, so the Seed hosting service lets them in without its
 * own email link. This runs the whole chain against real servers:
 *
 *   site daemon <- web app (publishes the signing key at /hm/api/config, and
 *                  is the gateway where the hosting service creates sites)
 *               <- vault server (signs {email, signer, host} with that key)
 *   device daemon (plays the desktop app's daemon; connected to the vault)
 *   hosting service (separate repository, with its own embedded Postgres)
 *
 * The test plays the person in the browser (vault registration and the
 * consent step of Vault Connect) and the desktop app, which only moves the
 * prevalidation from its daemon to the hosting service.
 *
 * Skipped when the hosting service checkout is not available (see
 * integration/host-server.ts).
 *
 * Prerequisites: daemon binary built (plz-out/bin/backend) and `bun` on PATH.
 */

import {createPromiseClient} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {hkdf} from '@noble/hashes/hkdf.js'
import {sha256} from '@noble/hashes/sha2.js'
import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {encrypt} from '../frontend/packages/client/src/encryption'
import {serializeState, type State} from '../frontend/packages/client/src/vault'
import {Daemon, Networking} from '../frontend/packages/shared/src/client'
import {VaultConnectionStatus} from '../frontend/packages/shared/src/client/.generated/daemon/v1alpha/daemon_pb'
import {
  findHostDir,
  setupTestEnv,
  spawnDaemon,
  startHostServer,
  startVaultServer,
  type DaemonInstance,
  type HostServerInstance,
  type TestEnv,
  type VaultServerInstance,
} from './integration'

const TEST_TIMEOUT = 300_000

// Ports: must not collide with any other suite in tests/ (see mobile-vault.integration.test.ts).
const WEB_PORT = 3404
const SITE_DAEMON_HTTP_PORT = 59331
const SITE_DAEMON_GRPC_PORT = 59332
const SITE_DAEMON_P2P_PORT = 59333
const DEVICE_DAEMON_HTTP_PORT = 59341
const DEVICE_DAEMON_GRPC_PORT = 59342
const DEVICE_DAEMON_P2P_PORT = 59343
const VAULT_PORT = 3502
const HOST_PORT = 5591
const HOST_POSTGRES_PORT = 5491

const GATEWAY_ADMIN_SECRET = 'host-vault-login-gateway-secret'
const SECRET_AUTH_INFO = 'seed-hypermedia-vault-secret-authentication'

const utf8 = (value: string) => new TextEncoder().encode(value)

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

type HostLoginResponse = {status: string; sessionToken?: string; email?: string; message?: string}

let env: TestEnv
let vault: VaultServerInstance
let host: HostServerInstance
let deviceDaemon: DaemonInstance
let deviceDaemonDir: string
let device: ReturnType<typeof createPromiseClient<typeof Daemon>>
let deviceNetworking: ReturnType<typeof createPromiseClient<typeof Networking>>

let vaultCookie = ''
let sessionToken = ''
const email = `host-login-${Date.now()}@example.com`
const dek = randomBytes(64)

/** JSON call against the vault server as the person in the browser. */
async function vaultApi(method: string, apiPath: string, body?: unknown): Promise<Record<string, any>> {
  const response = await fetch(`${vault.baseUrl}/vault/api${apiPath}`, {
    method,
    headers: {
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      ...(vaultCookie ? {Cookie: vaultCookie} : {}),
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  })
  const cookies = response.headers.getSetCookie().map((header) => header.split(';')[0])
  if (cookies.length) vaultCookie = cookies.join('; ')
  const json = (await response.json()) as Record<string, any>
  if (!response.ok) throw new Error(`${method} /vault/api${apiPath} failed: ${response.status} ${JSON.stringify(json)}`)
  return json
}

/** What the desktop app sends to the hosting service instead of asking for an email. */
async function hostVaultLogin(prevalidation: {
  email: string
  signer: Uint8Array
  host: string
  sig: Uint8Array
}): Promise<HostLoginResponse> {
  const response = await fetch(`${host.baseUrl}/api/auth/vault`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      email: prevalidation.email,
      signer: b64url(prevalidation.signer),
      host: prevalidation.host,
      sig: b64url(prevalidation.sig),
    }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as HostLoginResponse
}

describe.skipIf(!findHostDir())('Hosting login with vault email prevalidation e2e', () => {
  beforeAll(async () => {
    env = await setupTestEnv({
      webPort: WEB_PORT,
      daemonHttpPort: SITE_DAEMON_HTTP_PORT,
      daemonGrpcPort: SITE_DAEMON_GRPC_PORT,
      daemonP2pPort: SITE_DAEMON_P2P_PORT,
      skipBuild: process.env.SKIP_BUILD === 'true',
      gatewayAdminSecret: GATEWAY_ADMIN_SECRET,
    })

    vault = await startVaultServer({
      port: VAULT_PORT,
      backendHttpPort: SITE_DAEMON_HTTP_PORT,
      webBaseUrl: env.web.baseUrl,
    })
    await vault.waitForReady()

    deviceDaemonDir = mkdtempSync(path.join(tmpdir(), 'seed-integration-device-daemon-'))
    deviceDaemon = await spawnDaemon({
      httpPort: DEVICE_DAEMON_HTTP_PORT,
      grpcPort: DEVICE_DAEMON_GRPC_PORT,
      p2pPort: DEVICE_DAEMON_P2P_PORT,
      dataDir: deviceDaemonDir,
      vaultKeyStore: true,
    })
    await deviceDaemon.waitForReady()
    const deviceTransport = createGrpcWebTransport({
      baseUrl: `http://localhost:${DEVICE_DAEMON_HTTP_PORT}`,
      httpVersion: '1.1',
    })
    device = createPromiseClient(Daemon, deviceTransport)
    deviceNetworking = createPromiseClient(Networking, deviceTransport)

    host = await startHostServer({
      port: HOST_PORT,
      postgresPort: HOST_POSTGRES_PORT,
      trustedPrevalidators: [vault.baseUrl],
      gateway: {baseUrl: env.web.baseUrl, adminSecret: GATEWAY_ADMIN_SECRET},
    })
    await host.waitForReady()
  }, TEST_TIMEOUT)

  afterAll(async () => {
    await host?.kill()
    await deviceDaemon?.kill()
    await vault?.kill()
    await env?.cleanup()
    if (deviceDaemonDir) rmSync(deviceDaemonDir, {recursive: true, force: true})
  })

  it(
    'has no prevalidation before the device is connected to a vault',
    async () => {
      await expect(device.getVaultEmailPrevalidation({})).rejects.toThrow(/not connected/)
    },
    TEST_TIMEOUT,
  )

  it(
    'connects the device daemon to the vault of a registered person',
    async () => {
      await vaultApi('POST', '/register/start', {email})
      const code = await vault.waitForVerificationCode(email)
      const verified = await vaultApi('POST', '/register/verify', {code})
      expect(verified.verified).toBe(true)

      const fresh = await vaultApi('GET', '/vault')
      const state: State = {version: 2, accounts: []}
      await vaultApi('POST', '/vault', {
        encryptedData: b64url(await encrypt(await serializeState(state), dek)),
        version: fresh.version,
      })

      const connection = await device.startVaultConnection({vaultUrl: vault.vaultUrl})
      expect(connection.connectToken).toBeTruthy()

      // The consent step of the browser (vault/src/frontend/store.ts handleVaultConnectApproval).
      const secret = randomBytes(32)
      const credential = await vaultApi('POST', '/credentials/secret', {
        authKey: b64url(hkdf(sha256, secret, undefined, utf8(SECRET_AUTH_INFO), 32)),
        wrappedDEK: b64url(await encrypt(dek, secret)),
      })
      const tokenBytes = new Uint8Array(Buffer.from(connection.connectToken, 'base64url'))
      const payload = JSON.stringify({
        vaultUrl: vault.vaultUrl,
        userId: verified.userId,
        credentialId: credential.credentialId,
        secret: b64url(secret),
      })
      await vaultApi('POST', '/vault-connect', {
        connectId: b64url(sha256(tokenBytes)),
        payload: b64url(await encrypt(utf8(payload), tokenBytes)),
      })

      await expect
        .poll(
          async () => {
            const status = await device.getVaultStatus({})
            if (status.lastConnectError) throw new Error(status.lastConnectError)
            return status.connectionStatus
          },
          {timeout: 60_000, interval: 1_000},
        )
        .toBe(VaultConnectionStatus.CONNECTED)
    },
    TEST_TIMEOUT,
  )

  it(
    'logs in to the hosting service without the email step',
    async () => {
      const prevalidation = await device.getVaultEmailPrevalidation({})
      expect(prevalidation.email).toBe(email)
      expect(prevalidation.host).toBe(vault.baseUrl)

      const login = await hostVaultLogin(prevalidation)
      expect(login).toMatchObject({status: 'success', email})
      expect(login.sessionToken).toBeTruthy()

      sessionToken = login.sessionToken!
    },
    TEST_TIMEOUT,
  )

  it(
    'puts a site on a free subdomain with that session',
    async () => {
      const subdomain = `vaultlogin${Date.now()}`
      const response = await fetch(`${host.baseUrl}/api/sites`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}`},
        body: JSON.stringify({subdomain}),
      })
      expect(response.status).toBe(200)
      const site = (await response.json()) as {
        subdomain: string
        host: string
        registrationSecret: string
        setupUrl: string
      }
      expect(site.subdomain).toBe(subdomain)
      expect(site.registrationSecret).toBeTruthy()
      // Sites of the gateway are subdomains of it, on the same scheme and port.
      expect(site.host).toBe(`http://${subdomain}.localhost:${WEB_PORT}`)
      expect(site.setupUrl).toBe(`${site.host}/hm/register?secret=${site.registrationSecret}`)

      // The gateway now serves the subdomain, waiting for the person's account to register.
      const siteConfig = await fetch(`${site.host}/hm/api/config`)
      expect(siteConfig.status).toBe(200)
      expect(((await siteConfig.json()) as {registeredAccountUid?: string}).registeredAccountUid).toBeUndefined()

      // What the desktop app does with the setup URL (useSiteRegistration): register its daemon as the source.
      const key = await device.registerKey({mnemonic: (await device.genMnemonic({})).mnemonic, name: 'main'})
      const deviceInfo = await device.getInfo({})
      const peerInfo = await deviceNetworking.getPeerInfo({deviceId: deviceInfo.peerId})
      const registration = await fetch(`${site.host}/hm/api/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          registrationSecret: site.registrationSecret,
          accountUid: key.accountId,
          peerId: deviceInfo.peerId,
          addrs: peerInfo.addrs,
        }),
      })
      expect(await registration.json()).toEqual({message: 'Success'})
      const registered = (await (await fetch(`${site.host}/hm/api/config`)).json()) as {registeredAccountUid?: string}
      expect(registered.registeredAccountUid).toBe(key.accountId)

      const sites = await fetch(`${host.baseUrl}/api/sites`, {headers: {Authorization: `Bearer ${sessionToken}`}})
      expect(sites.status).toBe(200)
      expect(((await sites.json()) as {name: string}[]).map((s) => s.name)).toEqual([subdomain])
    },
    TEST_TIMEOUT,
  )

  it(
    'asks for the email step once the account exists',
    async () => {
      // The prevalidation never expires, so it must not open an existing account.
      const prevalidation = await device.getVaultEmailPrevalidation({})
      const login = await hostVaultLogin(prevalidation)
      expect(login).toEqual({status: 'error', message: 'Email validation required.'})
    },
    TEST_TIMEOUT,
  )

  it(
    'logs in with a code sent by email, as someone without a vault does',
    async () => {
      const codeEmail = `code-login-${Date.now()}@example.com`
      const start = await fetch(`${host.baseUrl}/api/auth/code/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: codeEmail}),
      })
      expect(start.status).toBe(200)
      const pending = (await start.json()) as {status: string; binding: string; expireTime: number}
      expect(pending.status).toBe('code-sent')
      const code = await host.waitForLoginCode(codeEmail)

      const verifyWith = async (attempt: {code: string; binding: string}) => {
        const response = await fetch(`${host.baseUrl}/api/auth/code/verify`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email: codeEmail, ...attempt}),
        })
        return {status: response.status, body: (await response.json()) as HostLoginResponse}
      }
      const wrongCode = await verifyWith({code: code === '0000' ? '0001' : '0000', binding: pending.binding})
      expect(wrongCode).toEqual({status: 400, body: {message: 'Incorrect code.'}})
      const wrongBinding = await verifyWith({code, binding: 'someone-else'})
      expect(wrongBinding.status).toBe(400)

      const login = await verifyWith({code, binding: pending.binding})
      expect(login.body).toMatchObject({status: 'success', email: codeEmail})
      const sites = await fetch(`${host.baseUrl}/api/sites`, {
        headers: {Authorization: `Bearer ${login.body.sessionToken}`},
      })
      expect(sites.status).toBe(200)

      // A code is single use.
      const reuse = await verifyWith({code, binding: pending.binding})
      expect(reuse.status).toBe(400)
    },
    TEST_TIMEOUT,
  )

  it(
    'rejects a prevalidation for an email the vault did not sign',
    async () => {
      const prevalidation = await device.getVaultEmailPrevalidation({})
      const login = await hostVaultLogin({
        email: `someone-else-${Date.now()}@example.com`,
        signer: prevalidation.signer,
        host: prevalidation.host,
        sig: prevalidation.sig,
      })
      expect(login).toEqual({status: 'error', message: 'Invalid email prevalidation.'})
    },
    TEST_TIMEOUT,
  )

  it(
    'rejects a prevalidation from a vault the hosting service does not trust',
    async () => {
      const prevalidation = await device.getVaultEmailPrevalidation({})
      const login = await hostVaultLogin({
        email: prevalidation.email,
        signer: prevalidation.signer,
        host: env.web.baseUrl,
        sig: prevalidation.sig,
      })
      expect(login).toEqual({status: 'error', message: 'Invalid email prevalidation.'})
    },
    TEST_TIMEOUT,
  )
})
