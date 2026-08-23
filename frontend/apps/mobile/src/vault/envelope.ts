/**
 * The persisted vault envelope, byte-compatible with the Go daemon's
 * vault.json codec (backend/storage/vault/file.go).
 *
 * The shared client `parseVaultEnvelope` drops the remote sync-version fields
 * (localVersion/remoteVersion/…), which the device role needs, so mobile keeps
 * its own envelope codec. Encoding rules mirror Go's encoding/json:
 * - `encryptedData`/`wrappedDEK` ([]byte) → standard base64 WITH padding
 * - credential `wrappedDEK` is an opaque string (base64url, produced remotely)
 * - `credentials`/`remote` and all numeric/string remote fields are omitempty
 * - `remote.lastSyncTime` is unix SECONDS
 */

import {b64std} from './crypto'

/** A DEK-wrapping credential entry (Go vault.Credential). */
export type EnvelopeCredential = {
  kind: string
  credentialId: string
  /** base64url (no padding) XChaCha20-Poly1305 wrapping of the DEK. */
  wrappedDEK: string
}

/** Remote connection + sync metadata (Go vault.RemoteState). */
export type RemoteSyncState = {
  vaultUrl: string
  userId: string
  credentialId: string
  localVersion: number
  remoteVersion: number
  syncedLocalVersion: number
  /** Unix SECONDS (Go vault.go:1520). */
  lastSyncTime: number
  lastSyncError: string
}

/** Parsed vault envelope (Go vault.Envelope). */
export type VaultEnvelope = {
  /** XChaCha20-Poly1305(gzip(cbor(State)), DEK), nonce prepended. */
  encryptedData: Uint8Array
  /** XChaCha20-Poly1305(DEK, KEK), nonce prepended. */
  wrappedDEK: Uint8Array
  credentials: EnvelopeCredential[]
  remote: RemoteSyncState | null
}

export function createRemoteSyncState(
  init: Partial<RemoteSyncState> & Pick<RemoteSyncState, 'vaultUrl' | 'userId' | 'credentialId'>,
): RemoteSyncState {
  return {
    localVersion: 0,
    remoteVersion: 0,
    syncedLocalVersion: 0,
    lastSyncTime: 0,
    lastSyncError: '',
    ...init,
  }
}

function validateEnvelope(envelope: VaultEnvelope): void {
  if (envelope.encryptedData.length === 0) {
    throw new Error('Vault encrypted data must not be empty.')
  }
  if (envelope.wrappedDEK.length === 0) {
    throw new Error('Vault wrapped DEK must not be empty.')
  }
  if (envelope.remote && !envelope.remote.vaultUrl) {
    throw new Error('Remote vault URL is required.')
  }
  if (envelope.remote && !envelope.remote.userId) {
    throw new Error('Remote vault user ID is required.')
  }
}

/** Serialize an envelope to JSON in Go field order with omitempty semantics. */
export function serializeEnvelope(envelope: VaultEnvelope): string {
  validateEnvelope(envelope)

  const out: Record<string, unknown> = {
    encryptedData: b64std.encode(envelope.encryptedData),
    wrappedDEK: b64std.encode(envelope.wrappedDEK),
  }
  if (envelope.credentials.length > 0) {
    out.credentials = envelope.credentials.map((credential) => ({
      kind: credential.kind,
      credentialId: credential.credentialId,
      wrappedDEK: credential.wrappedDEK,
    }))
  }
  if (envelope.remote) {
    const remote: Record<string, unknown> = {
      vaultUrl: envelope.remote.vaultUrl,
      userId: envelope.remote.userId,
      credentialId: envelope.remote.credentialId,
    }
    if (envelope.remote.localVersion !== 0) remote.localVersion = envelope.remote.localVersion
    if (envelope.remote.remoteVersion !== 0) remote.remoteVersion = envelope.remote.remoteVersion
    if (envelope.remote.syncedLocalVersion !== 0) remote.syncedLocalVersion = envelope.remote.syncedLocalVersion
    if (envelope.remote.lastSyncTime !== 0) remote.lastSyncTime = envelope.remote.lastSyncTime
    if (envelope.remote.lastSyncError !== '') remote.lastSyncError = envelope.remote.lastSyncError
    out.remote = remote
  }

  return JSON.stringify(out, null, 2)
}

/** Parse a vault envelope JSON string, validating like Go file.go. */
export function parseEnvelope(json: string): VaultEnvelope {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Failed to decode vault envelope: not valid JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Failed to decode vault envelope: expected a JSON object.')
  }

  const envelope: VaultEnvelope = {
    encryptedData: decodeBytesField(raw.encryptedData, 'encryptedData'),
    wrappedDEK: decodeBytesField(raw.wrappedDEK, 'wrappedDEK'),
    credentials: [],
    remote: null,
  }

  if (Array.isArray(raw.credentials)) {
    envelope.credentials = raw.credentials.map((entry: Record<string, unknown>) => ({
      kind: String(entry.kind ?? ''),
      credentialId: String(entry.credentialId ?? ''),
      wrappedDEK: String(entry.wrappedDEK ?? ''),
    }))
  }

  const rawRemote = raw.remote as Record<string, unknown> | undefined
  if (rawRemote && typeof rawRemote === 'object') {
    envelope.remote = {
      vaultUrl: String(rawRemote.vaultUrl ?? ''),
      userId: String(rawRemote.userId ?? ''),
      credentialId: String(rawRemote.credentialId ?? ''),
      localVersion: numberField(rawRemote.localVersion),
      remoteVersion: numberField(rawRemote.remoteVersion),
      syncedLocalVersion: numberField(rawRemote.syncedLocalVersion),
      lastSyncTime: numberField(rawRemote.lastSyncTime),
      lastSyncError: String(rawRemote.lastSyncError ?? ''),
    }
  }

  validateEnvelope(envelope)
  return envelope
}

function decodeBytesField(value: unknown, field: string): Uint8Array {
  if (value == null) return new Uint8Array(0)
  if (typeof value !== 'string') {
    throw new Error(`Failed to decode vault envelope: "${field}" must be a base64 string.`)
  }
  try {
    return b64std.decode(value)
  } catch {
    throw new Error(`Failed to decode vault envelope: "${field}" is not valid base64.`)
  }
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
