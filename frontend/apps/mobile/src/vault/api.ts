/**
 * HTTP client for the remote vault service, mirroring the Go device's remote
 * calls (backend/storage/vault/vault.go getRemote/saveRemoteSnapshot/
 * fetchVaultConnectPayload/deleteRemoteSecretCredential).
 *
 * The mobile app only ever uses bearer auth (`credentialId:b64url(authKey)`)
 * plus the unauthenticated one-time mailbox read — never session cookies.
 */

import {b64url, deriveSecretCredentialAuthKey} from './crypto'

const REQUEST_TIMEOUT_MS = 5_000

export class VaultApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'VaultApiError'
    this.status = status
  }
}

/** The optimistic-concurrency 409 from POST /vault/api/vault. */
export class VaultWriteConflictError extends VaultApiError {
  constructor(message = 'remote vault write conflict') {
    super(message, 409)
    this.name = 'VaultWriteConflictError'
  }
}

/** One credential entry in a GET /vault response. */
export type VaultCredential = {
  kind: string
  credentialId?: string
  /** base64url XChaCha20-Poly1305 wrapping of the DEK under the credential secret. */
  wrappedDEK?: string
  salt?: string
}

export type GetVaultResult = {
  /** base64url ciphertext of the vault state; absent when the vault is empty. */
  encryptedData?: string
  version: number
  credentials: VaultCredential[]
  unchanged: boolean
}

/** Build the bearer auth token: `credentialId:b64url(HKDF(secret, secret-auth-info))`. */
export function buildBearerAuth(credentialId: string, secret: Uint8Array): string {
  const normalized = credentialId.trim()
  if (!normalized) {
    throw new Error('Remote vault credential ID is required.')
  }
  return `${normalized}:${b64url.encode(deriveSecretCredentialAuthKey(secret))}`
}

/** Join a normalized vault base URL and an endpoint path (Go resolveDaemonEndpointURL). */
export function resolveVaultEndpoint(vaultUrl: string, endpointPath: string): string {
  return `${vaultUrl.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`
}

async function vaultFetch(
  url: string,
  init: {method?: string; bearer?: string; body?: unknown} = {},
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {}
    if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    return await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? {body: JSON.stringify(init.body)} : {}),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function errorFromResponse(response: Response, context: string): Promise<VaultApiError> {
  let message = ''
  try {
    const body = (await response.json()) as {error?: string}
    if (body && typeof body.error === 'string') message = body.error
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  return new VaultApiError(message || `${context}: unexpected status ${response.status}`, response.status)
}

/** GET /vault/api/vault — the encrypted vault snapshot. */
export async function getVault(vaultUrl: string, bearer: string, knownVersion?: number): Promise<GetVaultResult> {
  let endpoint = resolveVaultEndpoint(vaultUrl, 'api/vault')
  if (knownVersion !== undefined && knownVersion > 0) {
    endpoint += `?knownVersion=${knownVersion}`
  }
  const response = await vaultFetch(endpoint, {bearer})
  if (!response.ok) {
    throw await errorFromResponse(response, 'remote vault fetch failed')
  }
  const body = (await response.json()) as {
    encryptedData?: string
    version?: number
    credentials?: VaultCredential[]
    unchanged?: boolean
  }
  if (body.unchanged) {
    return {
      version: knownVersion !== undefined && knownVersion > 0 ? knownVersion : 0,
      credentials: body.credentials ?? [],
      unchanged: true,
    }
  }
  return {
    encryptedData: body.encryptedData,
    version: typeof body.version === 'number' ? body.version : 0,
    credentials: body.credentials ?? [],
    unchanged: false,
  }
}

/**
 * POST /vault/api/vault — upload the encrypted state.
 * `version` is the EXPECTED CURRENT server version; the server bumps it.
 * A mismatch is a 409, surfaced as VaultWriteConflictError.
 */
export async function saveVault(
  vaultUrl: string,
  bearer: string,
  request: {encryptedData: string; version: number},
): Promise<void> {
  const response = await vaultFetch(resolveVaultEndpoint(vaultUrl, 'api/vault'), {
    method: 'POST',
    bearer,
    body: request,
  })
  if (response.status === 409) {
    throw new VaultWriteConflictError()
  }
  if (!response.ok) {
    throw await errorFromResponse(response, 'remote vault save failed')
  }
  const body = (await response.json()) as {success?: boolean}
  if (!body.success) {
    throw new VaultApiError('Remote vault save response did not report success.', response.status)
  }
}

/** GET /vault/api/vault-connect/:id — one-time mailbox read (unauthenticated). */
export async function getVaultConnect(
  vaultUrl: string,
  connectId: string,
): Promise<{found: boolean; payload?: string}> {
  const response = await vaultFetch(
    resolveVaultEndpoint(vaultUrl, `api/vault-connect/${encodeURIComponent(connectId)}`),
  )
  if (response.status === 404) {
    return {found: false}
  }
  if (!response.ok) {
    throw await errorFromResponse(response, 'vault connect fetch failed')
  }
  const body = (await response.json()) as {found?: boolean; payload?: string}
  if (!body.found || typeof body.payload !== 'string') {
    return {found: false}
  }
  return {found: true, payload: body.payload}
}

/** DELETE /vault/api/credentials/secret/:id — bearer must belong to :id. */
export async function deleteSecretCredential(vaultUrl: string, bearer: string, credentialId: string): Promise<void> {
  const response = await vaultFetch(
    resolveVaultEndpoint(vaultUrl, `api/credentials/secret/${encodeURIComponent(credentialId)}`),
    {method: 'DELETE', bearer},
  )
  if (!response.ok) {
    throw await errorFromResponse(response, 'remote credential deletion failed')
  }
}

/** Find the secret credential with the given ID (Go findCredential semantics). */
export function findSecretCredential(credentials: VaultCredential[], credentialId: string): VaultCredential {
  if (!credentialId) {
    throw new Error('Remote vault credential ID is required.')
  }
  for (const credential of credentials) {
    if (credential.kind !== 'secret') continue
    if (credential.credentialId !== credentialId) continue
    if (!credential.wrappedDEK || !credential.wrappedDEK.trim()) {
      throw new Error(`Remote vault credential "${credentialId}" is missing wrapped DEK.`)
    }
    return credential
  }
  throw new Error(`Remote vault response is missing secret credential "${credentialId}".`)
}
