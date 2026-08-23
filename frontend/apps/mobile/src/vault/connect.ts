/**
 * The Vault Connect ceremony (device side), ported from
 * backend/storage/vault/vault.go StartConnection/PollConnection/
 * HandleConnection/finishConnection.
 *
 * Protocol shape (verified against vault/src/frontend/store.ts, the browser
 * actor): the device mints a 32-byte token; `connectId = b64url(sha256(token
 * bytes))`; the browser posts `b64url(XChaCha20(JSON payload, token bytes))`
 * to the mailbox; the token itself only ever travels in the URL fragment.
 */

import {
  deleteSecretCredential,
  findSecretCredential,
  getVault,
  saveVault,
  VaultWriteConflictError,
  buildBearerAuth,
  type VaultCredential,
} from './api'
import {b64url, decrypt, encrypt, randomBytes, sha256, VAULT_SECRET_SIZE} from './crypto'
import type {EnvelopeCredential} from './envelope'
import {createEmpty, deserializeState, mergeStates, serializeState, statesEqual, type State} from './state-codec'

/** TTL of a pending connection token (Go connectionTokenTTL). */
export const CONNECTION_TOKEN_TTL_MS = 15 * 60 * 1000

/** Mailbox poll cadence (Go defaultPollInterval). */
export const CONNECT_POLL_INTERVAL_MS = 2_000

/** Error message surfaced when the pending token times out. */
export const CONNECT_TOKEN_EXPIRED_ERROR = 'connection token expired'

/**
 * Normalize a vault origin URL — verbatim desktop rules
 * (frontend/apps/desktop/src/utils/vault-connection.ts): http/https only, no
 * query/hash/userinfo, path `/` → ``, trailing slashes stripped.
 */
export function normalizeVaultOriginURL(rawUrl: string, fieldName = 'vault URL'): string {
  let parsedURL: URL
  try {
    parsedURL = new URL(rawUrl.trim())
  } catch {
    throw new Error(`Invalid ${fieldName}`)
  }

  if (parsedURL.protocol !== 'https:' && parsedURL.protocol !== 'http:') {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (!parsedURL.host || parsedURL.username || parsedURL.password) {
    throw new Error(`Invalid ${fieldName}`)
  }
  if (parsedURL.search || parsedURL.hash) {
    throw new Error(`Invalid ${fieldName}`)
  }

  const normalizedPath = parsedURL.pathname === '/' ? '' : parsedURL.pathname.replace(/\/+$/, '')
  return `${parsedURL.protocol}//${parsedURL.host}${normalizedPath}`
}

/** Build the browser-facing connect URL; the token rides ONLY in the fragment. */
export function buildVaultConnectionURL(vaultUrl: string, connectToken: string, siteName?: string): string {
  const vaultOrigin = normalizeVaultOriginURL(vaultUrl)
  const connectionURL = new URL(vaultOrigin)
  connectionURL.pathname =
    connectionURL.pathname && connectionURL.pathname !== '/' ? `${connectionURL.pathname}/connect` : '/connect'
  const fragmentParams = new URLSearchParams({token: connectToken})
  if (siteName) fragmentParams.set('siteName', siteName)
  connectionURL.hash = fragmentParams.toString()
  return connectionURL.toString()
}

export type PendingConnection = {
  /** Normalized remote vault origin URL. */
  vaultUrl: string
  /** b64url of the 32 raw token bytes. */
  token: string
  tokenBytes: Uint8Array
  /** b64url(sha256(tokenBytes)) — the mailbox key. */
  connectId: string
  connectUrl: string
  /** Unix ms. */
  expireTime: number
}

/** Mint a fresh pending connection (held in memory only — Go parity). */
export function mintPendingConnection(vaultUrl: string, siteName?: string): PendingConnection {
  const normalizedUrl = normalizeVaultOriginURL(vaultUrl)
  const tokenBytes = randomBytes(32)
  const token = b64url.encode(tokenBytes)
  return {
    vaultUrl: normalizedUrl,
    token,
    tokenBytes,
    connectId: b64url.encode(sha256(tokenBytes)),
    connectUrl: buildVaultConnectionURL(normalizedUrl, token, siteName),
    expireTime: Date.now() + CONNECTION_TOKEN_TTL_MS,
  }
}

export type ConnectPayload = {
  vaultUrl: string
  userId: string
  credentialId: string
  /** b64url of the 32-byte device credential secret. */
  secret: string
}

/** Decrypt and validate a mailbox payload with the token bytes. */
export async function decodeConnectPayload(encryptedPayload: string, tokenBytes: Uint8Array): Promise<ConnectPayload> {
  const ciphertext = b64url.decode(encryptedPayload)
  let plaintext: Uint8Array
  try {
    plaintext = await decrypt(ciphertext, tokenBytes)
  } catch {
    throw new Error('Failed to decrypt vault connect payload.')
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new Error('Failed to decode vault connect payload.')
  }
  const vaultUrl = typeof payload.vaultUrl === 'string' ? payload.vaultUrl : ''
  const userId = typeof payload.userId === 'string' ? payload.userId : ''
  const credentialId = typeof payload.credentialId === 'string' ? payload.credentialId : ''
  const secret = typeof payload.secret === 'string' ? payload.secret : ''
  if (!vaultUrl) throw new Error('Remote vault URL is required.')
  if (!userId) throw new Error('Remote vault user ID is required.')
  if (!credentialId) throw new Error('Remote credential ID is required.')
  const decodedSecret = b64url.decode(secret)
  if (decodedSecret.length !== VAULT_SECRET_SIZE) {
    throw new Error(`Invalid remote secret length: got ${decodedSecret.length} bytes`)
  }
  return {vaultUrl, userId, credentialId, secret}
}

export function credentialToEnvelope(credential: VaultCredential): EnvelopeCredential {
  return {
    kind: credential.kind,
    credentialId: credential.credentialId ?? '',
    wrappedDEK: credential.wrappedDEK ?? '',
  }
}

/** Union credential lists, deduped on (kind, credentialId, wrappedDEK) — Go mergeCredentialJSONs. */
export function mergeCredentialLists(
  existing: EnvelopeCredential[],
  incoming: EnvelopeCredential[],
): EnvelopeCredential[] {
  const seen = new Set<string>()
  const merged: EnvelopeCredential[] = []
  for (const credential of [...existing, ...incoming]) {
    const key = `${credential.kind}\x00${credential.credentialId}\x00${credential.wrappedDEK}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(credential)
  }
  return merged
}

export type FinishConnectionResult = {
  /** The remote vault's DEK — the device ADOPTS it (Go vault.go:2139-2163). */
  dek: Uint8Array
  /** Merged state now shared by device and remote. */
  state: State
  remoteVersion: number
  syncedLocalVersion: number
  /** Unix SECONDS. */
  lastSyncTime: number
  /** The device's own credential entry. */
  credential: EnvelopeCredential
  /** All remote credentials merged with ours, for the envelope. */
  credentials: EnvelopeCredential[]
  uploaded: boolean
}

const MERGE_LOG_PREFIX = '🔑 VAULT-MERGE'

/**
 * Complete the connection against the remote vault (Go finishConnection):
 * fetch → unwrap remote DEK → merge → upload iff the merge changed the remote
 * → return the adopted DEK + persisted-state inputs. Write conflicts retry the
 * whole attempt (≤3), refetching the remote each time.
 */
export async function finishConnection(opts: {
  vaultUrl: string
  userId: string
  credentialId: string
  secret: Uint8Array
  getLocalSnapshot: () => {state: State; localVersion: number}
  log?: (message: string) => void
}): Promise<FinishConnectionResult> {
  const log = opts.log ?? ((message: string) => console.log(`${MERGE_LOG_PREFIX} ${message}`))
  const maxAttempts = 3
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await finishConnectionAttempt(opts, log)
    } catch (error) {
      if (!(error instanceof VaultWriteConflictError)) throw error
      lastError = error
      log(`remote write conflict while finalizing, retrying (attempt ${attempt})`)
    }
  }
  throw lastError
}

async function finishConnectionAttempt(
  opts: {
    vaultUrl: string
    userId: string
    credentialId: string
    secret: Uint8Array
    getLocalSnapshot: () => {state: State; localVersion: number}
  },
  log: (message: string) => void,
): Promise<FinishConnectionResult> {
  const bearer = buildBearerAuth(opts.credentialId, opts.secret)
  const snapshot = await getVault(opts.vaultUrl, bearer)
  const credential = findSecretCredential(snapshot.credentials, opts.credentialId)

  let dek: Uint8Array
  try {
    dek = await decrypt(b64url.decode(credential.wrappedDEK!), opts.secret)
  } catch {
    throw new Error('Failed to decrypt wrapped DEK for the remote credential.')
  }

  let remoteState: State = createEmpty()
  if (!snapshot.unchanged && snapshot.encryptedData && snapshot.encryptedData.trim()) {
    remoteState = await deserializeState(await decrypt(b64url.decode(snapshot.encryptedData), dek))
  }

  const local = opts.getLocalSnapshot()
  log(
    `sign-in started: local identities=${local.state.accounts.length} remote identities=${remoteState.accounts.length} remoteVersion=${snapshot.version}`,
  )

  const {merged} = mergeStates(local.state, remoteState, local.localVersion, snapshot.version)

  let remoteVersion = snapshot.version
  let uploaded = false
  const needsUpload = !statesEqual(remoteState, merged)
  if (needsUpload) {
    const encryptedData = b64url.encode(await encrypt(await serializeState(merged), dek))
    await saveVault(opts.vaultUrl, bearer, {encryptedData, version: snapshot.version})
    remoteVersion = snapshot.version + 1
    uploaded = true
  }

  log(
    `merge complete: merged identities=${merged.accounts.length} uploadedLocalStateToRemote=${uploaded} remoteVersion=${remoteVersion}`,
  )

  const ownCredential = credentialToEnvelope(credential)
  return {
    dek,
    state: merged,
    remoteVersion,
    syncedLocalVersion: local.localVersion,
    lastSyncTime: Math.floor(Date.now() / 1000),
    credential: ownCredential,
    credentials: mergeCredentialLists(snapshot.credentials.map(credentialToEnvelope), [ownCredential]),
    uploaded,
  }
}

/** Best-effort cleanup of a superseded credential (Go cleanupOldRemoteCredential). */
export async function cleanupOldCredential(opts: {
  vaultUrl: string
  credentialId: string
  secret: Uint8Array
}): Promise<void> {
  try {
    const bearer = buildBearerAuth(opts.credentialId, opts.secret)
    await deleteSecretCredential(opts.vaultUrl, bearer, opts.credentialId)
  } catch {
    // Best effort — the old credential's server record may already be gone.
  }
}
