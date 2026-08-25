/**
 * Browser-side "Sign in with Seed" session management.
 *
 * Implements the client half of the Hypermedia Auth Protocol (see `./hmauth`):
 * a space generates a non-extractable Ed25519 session key, redirects the user to
 * their Vault to authorize it, and receives back a signed Capability delegating
 * the `AGENT` role to that session key. The account's own key never leaves the
 * Vault.
 *
 * Browser-only: requires WebCrypto Ed25519, IndexedDB (unless a custom store is
 * supplied), and `CompressionStream`/`DecompressionStream`. A secure context
 * (https, or localhost) is required for `crypto.subtle`.
 */

import * as base64 from './base64'
import * as blobs from './blobs'
import * as cbor from './cbor'
import type {HMSigner} from './hm-types'
import {
  type AuthResult,
  type CallbackData,
  type HypermediaAuthConfig,
  type StoredSession,
  PARAM_CLIENT_ID,
  PARAM_DATA,
  PARAM_EMAIL,
  PARAM_ERROR,
  PARAM_PROOF,
  PARAM_REDIRECT_URI,
  PARAM_SESSION_KEY,
  PARAM_SITE_NAME,
  PARAM_SPACE_NAME,
  PARAM_STATE,
  PARAM_TS,
  validateClientId,
  validateRedirectUri,
} from './hmauth'

const AUTH_STATE_BYTES = 16

/** A session record as persisted between the redirect out and the callback back. */
export interface AuthSessionRecord {
  keyPair: CryptoKeyPair
  publicKeyRaw: Uint8Array
  principal: string
  vaultUrl: string
  createTime: number
  /** Pending CSRF state, cleared once the callback is consumed. */
  authState: string | null
  authStartTime: number | null
}

/**
 * Persistence for pending and active sessions, keyed by vault URL.
 *
 * The default implementation uses IndexedDB, which is required to persist a
 * non-extractable `CryptoKey` across the redirect — `localStorage` cannot hold
 * one, and exporting the key would defeat the point.
 */
export interface AuthSessionStore {
  get(vaultUrl: string): Promise<AuthSessionRecord | null>
  put(vaultUrl: string, record: AuthSessionRecord): Promise<void>
  delete(vaultUrl: string): Promise<void>
}

const DB_NAME = 'seed-auth'
const DB_VERSION = 1
const STORE_NAME = 'sessions'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE_NAME, mode)
    const result = await promisifyRequest(fn(tx.objectStore(STORE_NAME)))
    return result
  } finally {
    db.close()
  }
}

/** The default IndexedDB-backed session store. */
export function indexedDBSessionStore(): AuthSessionStore {
  return {
    async get(vaultUrl) {
      const value = await withStore<AuthSessionRecord | undefined>('readonly', (store) => store.get(vaultUrl))
      return value ?? null
    },
    async put(vaultUrl, record) {
      await withStore('readwrite', (store) => store.put(record, vaultUrl))
    },
    async delete(vaultUrl) {
      await withStore('readwrite', (store) => store.delete(vaultUrl))
    },
  }
}

let defaultStore: AuthSessionStore | null = null

function resolveStore(store?: AuthSessionStore): AuthSessionStore {
  if (store) return store
  if (!defaultStore) defaultStore = indexedDBSessionStore()
  return defaultStore
}

/** Options accepted by every entry point in this module. */
export interface AuthOptions {
  /** Override where sessions are persisted. Defaults to IndexedDB. */
  store?: AuthSessionStore
}

function generateAuthState(): string {
  return base64.encode(crypto.getRandomValues(new Uint8Array(AUTH_STATE_BYTES)))
}

async function signWithKey(privateKey: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    'Ed25519' as unknown as AlgorithmIdentifier,
    privateKey,
    payload as ArrayBufferView<ArrayBuffer>,
  )
  return new Uint8Array(signature)
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip')
  const writer = stream.writable.getWriter()
  writer.write(data as Uint8Array<ArrayBuffer>)
  writer.close()
  return collectStream(stream.readable)
}

/** Generate a non-extractable Ed25519 session key pair using WebCrypto. */
export async function generateSessionKey(): Promise<{
  keyPair: CryptoKeyPair
  publicKeyRaw: Uint8Array
  principal: string
}> {
  const keyPair = (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const principal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
  return {keyPair, publicKeyRaw, principal}
}

/**
 * Begin the sign-in flow.
 *
 * Generates a session key, persists it against `vaultUrl`, and returns the URL
 * to navigate the user to. Navigate with a full page load — the flow is
 * redirect-based and does not work from an iframe.
 */
export async function startAuth(config: HypermediaAuthConfig, options: AuthOptions = {}): Promise<string> {
  const clientId = config.clientId ?? window.location.origin
  const redirectUri = config.redirectUri ?? `${window.location.origin}${window.location.pathname}`
  validateClientId(clientId)
  validateRedirectUri(redirectUri, clientId)

  const session = await generateSessionKey()
  const authState = generateAuthState()
  const authStartTime = Date.now()

  await resolveStore(options.store).put(config.vaultUrl, {
    keyPair: session.keyPair,
    publicKeyRaw: session.publicKeyRaw,
    principal: session.principal,
    vaultUrl: config.vaultUrl,
    createTime: authStartTime,
    authState,
    authStartTime,
  })

  const url = new URL(config.vaultUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set(PARAM_CLIENT_ID, clientId)
  url.searchParams.set(PARAM_REDIRECT_URI, redirectUri)
  url.searchParams.set(PARAM_SESSION_KEY, session.principal)
  url.searchParams.set(PARAM_STATE, authState)
  url.searchParams.set(PARAM_TS, String(authStartTime))
  if (config.email) url.searchParams.set(PARAM_EMAIL, config.email)
  const spaceName = config.spaceName ?? config.siteName
  if (spaceName) {
    url.searchParams.set(PARAM_SPACE_NAME, spaceName)
    // Also sent under the pre-rename key so a vault on an older build still
    // shows the space name on its consent screen.
    url.searchParams.set(PARAM_SITE_NAME, spaceName)
  }

  // The proof signs the URL as it appears without the trailing `proof` param,
  // so it must be appended last and never reordered.
  const signedUrl = url.toString()
  const proof = base64.encode(await signWithKey(session.keyPair.privateKey, new TextEncoder().encode(signedUrl)))
  const delimiter = signedUrl.includes('?') ? '&' : '?'
  return `${signedUrl}${delimiter}${PARAM_PROOF}=${encodeURIComponent(proof)}`
}

/**
 * Consume the vault's callback on your `redirect_uri` page.
 *
 * Returns null when the current URL carries no delegation result, so it is safe
 * to call unconditionally on page load. Throws if the user denied the request or
 * if any validation fails.
 */
export async function handleCallback(
  config: Pick<HypermediaAuthConfig, 'vaultUrl'>,
  options: AuthOptions = {},
): Promise<AuthResult | null> {
  const url = new URL(window.location.href)
  const dataParam = url.searchParams.get(PARAM_DATA)
  const stateParam = url.searchParams.get(PARAM_STATE)
  const error = url.searchParams.get(PARAM_ERROR)

  if (!dataParam && !error) return null

  const vaultUrl = config?.vaultUrl
  if (!vaultUrl) throw new Error('vaultUrl is required to retrieve the stored session')
  if (!stateParam) throw new Error('Missing callback state')

  const store = resolveStore(options.store)
  const record = await store.get(vaultUrl)
  if (!record) throw new Error('No stored session found for this vault. Was startAuth() called first?')
  if (!record.authState) throw new Error('No pending auth state found for this vault. Was startAuth() called first?')
  if (record.authState !== stateParam) throw new Error('Invalid callback state')

  if (error) {
    await store.put(vaultUrl, {...record, authState: null, authStartTime: null})
    throw new Error(`Delegation error: ${error}`)
  }
  if (!dataParam) throw new Error('Missing callback data')

  const session: StoredSession = {
    keyPair: record.keyPair,
    publicKeyRaw: record.publicKeyRaw,
    principal: record.principal,
    vaultUrl: record.vaultUrl,
    createdAt: record.createTime,
  }

  // base64url -> gunzip -> DAG-CBOR.
  const callbackData = cbor.decode<CallbackData>(await decompress(base64.decode(dataParam)))

  let notifyServerUrl: string | undefined
  if (callbackData.notifyServerUrl && typeof callbackData.notifyServerUrl === 'string') {
    try {
      new URL(callbackData.notifyServerUrl)
      notifyServerUrl = callbackData.notifyServerUrl
    } catch {
      console.warn(`Invalid notify server URL in callback data: ${callbackData.notifyServerUrl}`)
    }
  }

  // Re-encode the decoded blobs to confirm nothing was altered in transit.
  const capability = blobs.encode(callbackData.capability)
  if (capability.cid.toString() !== callbackData.capabilityCid.toString()) {
    throw new Error('Capability CID mismatch: data was corrupted in transit')
  }
  let profile: blobs.Encoded<blobs.Profile> | undefined
  if (callbackData.profile || callbackData.profileCid) {
    if (!callbackData.profile || !callbackData.profileCid) {
      throw new Error('Profile callback data is incomplete')
    }
    profile = blobs.encode(callbackData.profile)
    if (profile.cid.toString() !== callbackData.profileCid.toString()) {
      throw new Error('Profile CID mismatch: data was corrupted in transit')
    }
  }

  if (!blobs.verify(callbackData.capability)) throw new Error('Invalid capability signature')
  if (callbackData.profile && !blobs.verify(callbackData.profile)) throw new Error('Invalid profile signature')

  // The capability must delegate to *our* key, and be self-consistently signed
  // by the account it claims to come from.
  const expectedDelegate = blobs.principalFromString(session.principal)
  if (!blobs.principalEqual(callbackData.capability.delegate, expectedDelegate)) {
    throw new Error('Capability delegate does not match local session key')
  }
  if (!blobs.principalEqual(callbackData.account, callbackData.capability.signer)) {
    throw new Error('Callback account does not match capability signer')
  }
  if (callbackData.profile && !blobs.principalEqual(callbackData.account, callbackData.profile.signer)) {
    throw new Error('Callback account does not match profile signer')
  }

  await store.put(vaultUrl, {...record, authState: null, authStartTime: null})

  return {
    accountPrincipal: blobs.principalToString(callbackData.account),
    capability,
    ...(profile ? {profile} : {}),
    session,
    notifyServerUrl,
  }
}

/** Retrieve the stored session for a vault URL, or null if not signed in. */
export async function getSession(vaultUrl: string, options: AuthOptions = {}): Promise<StoredSession | null> {
  const record = await resolveStore(options.store).get(vaultUrl)
  if (!record) return null
  return {
    keyPair: record.keyPair,
    publicKeyRaw: record.publicKeyRaw,
    principal: record.principal,
    vaultUrl: record.vaultUrl,
    createdAt: record.createTime,
  }
}

/** Sign arbitrary bytes with the session's non-extractable private key. */
export async function signWithSession(session: StoredSession, data: Uint8Array): Promise<Uint8Array> {
  return signWithKey(session.keyPair.privateKey, data)
}

/**
 * Adapt a session into an `HMSigner`, so it can be passed straight to
 * `createComment`, `createContact`, `publishDocument`, and the other blob
 * builders in this package.
 */
export function createSessionSigner(session: StoredSession): HMSigner {
  const principal = blobs.principalFromString(session.principal)
  return {
    getPublicKey: async () => principal,
    sign: async (data: Uint8Array) => signWithSession(session, data),
  }
}

/** Forget the stored session for a vault URL. */
export async function clearSession(vaultUrl: string, options: AuthOptions = {}): Promise<void> {
  await resolveStore(options.store).delete(vaultUrl)
}
