/**
 * Client-side auth session management.
 * Handles the auth flow with a Seed Hypermedia Vault, storing sessions in local IDB.
 */

import * as base64 from '@shm/shared/base64'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
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
  PARAM_STATE,
  PARAM_TS,
  validateClientId,
  validateRedirectUri,
} from '@shm/shared/hmauth'
import {type DBSessionRecord, deleteAuthSession, getAuthSession, putAuthSession} from './local-db'

const AUTH_STATE_BYTES = 16

function generateAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(AUTH_STATE_BYTES))
  return base64.encode(bytes)
}

async function signDelegationProof(privateKey: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
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
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data as Uint8Array<ArrayBuffer>)
  writer.close()
  return collectStream(ds.readable)
}

/**
 * Generate a non-extractable Ed25519 session key pair using the Web Crypto API.
 */
export async function generateSessionKey(): Promise<{
  keyPair: CryptoKeyPair
  publicKeyRaw: Uint8Array
  principal: string
}> {
  const keyPair = (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const rawExport = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyRaw = new Uint8Array(rawExport)
  const principal = blobs.principalToString(blobs.principalFromEd25519(publicKeyRaw))
  return {keyPair, publicKeyRaw, principal}
}

/**
 * Start the authentication flow by generating a session key and storing it.
 *
 * 1. Generates a non-extractable Ed25519 key pair.
 * 2. Stores it in IndexedDB keyed by the Vault URL.
 * 3. Returns the Vault URL (with delegation params) for the caller to navigate to.
 */
export async function startAuth(config: HypermediaAuthConfig): Promise<string> {
  const clientId = config.clientId ?? window.location.origin
  const redirectUri = config.redirectUri ?? `${window.location.origin}${window.location.pathname}`
  validateClientId(clientId)
  validateRedirectUri(redirectUri, clientId)

  const session = await generateSessionKey()
  const authState = generateAuthState()
  const authStartTime = Date.now()

  const record: DBSessionRecord = {
    keyPair: session.keyPair,
    publicKeyRaw: session.publicKeyRaw,
    principal: session.principal,
    vaultUrl: config.vaultUrl,
    createTime: Date.now(),
    authState,
    authStartTime,
  }

  await putAuthSession(config.vaultUrl, record)

  const url = new URL(config.vaultUrl)
  url.search = ''
  url.hash = ''
  url.searchParams.set(PARAM_CLIENT_ID, clientId)
  url.searchParams.set(PARAM_REDIRECT_URI, redirectUri)
  url.searchParams.set(PARAM_SESSION_KEY, session.principal)
  url.searchParams.set(PARAM_STATE, authState)
  url.searchParams.set(PARAM_TS, String(authStartTime))
  if (config.email) {
    url.searchParams.set(PARAM_EMAIL, config.email)
  }
  const signedUrl = url.toString()
  const proofPayload = new TextEncoder().encode(signedUrl)
  const proofSig = await signDelegationProof(session.keyPair.privateKey, proofPayload)
  const proof = base64.encode(proofSig)
  const delimiter = signedUrl.includes('?') ? '&' : '?'
  return `${signedUrl}${delimiter}${PARAM_PROOF}=${encodeURIComponent(proof)}`
}

/**
 * Handle the callback after the Vault redirects back with delegation results.
 *
 * Returns null if no delegation parameters are present.
 * Throws if an `error` parameter is present.
 */
export async function handleCallback(config?: Partial<HypermediaAuthConfig>): Promise<AuthResult | null> {
  const url = new URL(window.location.href)
  const dataParam = url.searchParams.get(PARAM_DATA)
  const stateParam = url.searchParams.get(PARAM_STATE)
  const error = url.searchParams.get(PARAM_ERROR)

  if (!dataParam && !error) {
    return null
  }

  const vaultUrl = config?.vaultUrl
  if (!vaultUrl) {
    throw new Error('vaultUrl is required to retrieve the stored session')
  }

  if (!stateParam) {
    throw new Error('Missing callback state')
  }

  const record = await getAuthSession(vaultUrl)
  if (!record) {
    throw new Error('No stored session found for this vault. Was startAuth() called first?')
  }
  if (!record.authState) {
    throw new Error('No pending auth state found for this vault. Was startAuth() called first?')
  }
  if (record.authState !== stateParam) {
    throw new Error('Invalid callback state')
  }

  if (error) {
    await putAuthSession(vaultUrl, {
      ...record,
      authState: null,
      authStartTime: null,
    })
    throw new Error(`Delegation error: ${error}`)
  }
  if (!dataParam) {
    throw new Error('Missing callback data')
  }

  const session: StoredSession = {
    keyPair: record.keyPair,
    publicKeyRaw: record.publicKeyRaw,
    principal: record.principal,
    vaultUrl: record.vaultUrl,
    createdAt: record.createTime,
  }

  // Decode callback data: base64url → gzip decompress → CBOR decode.
  const compressed = base64.decode(dataParam)
  const decodedCbor = await decompress(compressed)
  const callbackData = cbor.decode<CallbackData>(decodedCbor)
  let notifyServerUrl: string | undefined
  if (callbackData.notifyServerUrl && typeof callbackData.notifyServerUrl === 'string') {
    try {
      new URL(callbackData.notifyServerUrl)
      notifyServerUrl = callbackData.notifyServerUrl
    } catch {
      console.warn(`Invalid notify server URL in callback data: ${callbackData.notifyServerUrl}`)
    }
  }

  // Re-encode the decoded blobs to verify CID integrity.
  const capability = blobs.encode(callbackData.capability)
  if (capability.cid.toString() !== callbackData.capabilityCid.toString()) {
    throw new Error('Capability CID mismatch: data was corrupted in transit')
  }

  // Verify signatures.
  if (!blobs.verify(callbackData.capability)) {
    throw new Error('Invalid capability signature')
  }

  // Cross-blob coherence checks.
  const expectedDelegate = blobs.principalFromString(session.principal)
  if (!blobs.principalEqual(callbackData.capability.delegate, expectedDelegate)) {
    throw new Error('Capability delegate does not match local session key')
  }
  if (!blobs.principalEqual(callbackData.account, callbackData.capability.signer)) {
    throw new Error('Callback account does not match capability signer')
  }

  await putAuthSession(vaultUrl, {
    ...record,
    authState: null,
    authStartTime: null,
  })

  return {
    accountPrincipal: blobs.principalToString(callbackData.account),
    capability,
    session,
    notifyServerUrl,
  }
}

/**
 * Retrieve a stored session from IndexedDB for a given Vault URL.
 */
export async function getSession(vaultUrl: string): Promise<StoredSession | null> {
  const record = await getAuthSession(vaultUrl)
  if (!record) return null
  return {
    keyPair: record.keyPair,
    publicKeyRaw: record.publicKeyRaw,
    principal: record.principal,
    vaultUrl: record.vaultUrl,
    createdAt: record.createTime,
  }
}

/**
 * Sign data using the session's non-extractable private key.
 */
export async function signWithSession(session: StoredSession, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign(
    'Ed25519' as unknown as AlgorithmIdentifier,
    session.keyPair.privateKey,
    data as ArrayBufferView<ArrayBuffer>,
  )
  return new Uint8Array(sig)
}

/**
 * Remove a stored session from IndexedDB for a given Vault URL.
 */
export async function clearSession(vaultUrl: string): Promise<void> {
  await deleteAuthSession(vaultUrl)
}
