/**
 * Vault data model, CBOR+gzip serialization, and vault.json envelope access.
 *
 * The vault is the encrypted store for Hypermedia identity accounts, shared by
 * the daemon (Go, backend/storage/vault), the vault web app, and CLI tools.
 * This module is isomorphic (browser/Node/Bun): it has no filesystem or OS
 * keychain access — see `vault-local.ts` for the Node-only local-vault loader.
 *
 * Byte-compatible with:
 * - Go: backend/storage/vault (state.go CBOR atlas, file.go envelope, vault.go crypto)
 * - TS: vault/src/frontend/vault.ts + crypto.ts (the original implementation this was hoisted from)
 */

import * as dagCBOR from '@ipld/dag-cbor'
import {ed25519} from '@noble/curves/ed25519.js'
import * as cborg from 'cborg'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import './base64'
import {decrypt} from './encryption'

/** Current vault schema version. Bump on every incompatible schema change. */
export const VAULT_VERSION = 2

// Work around dag-cbor rejecting `undefined` values.
// See: https://github.com/ipld/js-dag-cbor/issues/57.
const cborEncodeOpts = {
  ...dagCBOR.encodeOptions,
  typeEncoders: {
    ...dagCBOR.encodeOptions.typeEncoders,
    undefined: () => null,
  },
} satisfies typeof dagCBOR.encodeOptions

const stateExtraKey = Symbol('vault-state-extra')
const accountExtraKey = Symbol('vault-account-extra')
const delegationExtraKey = Symbol('vault-delegation-extra')
const capabilityExtraKey = Symbol('vault-capability-extra')
const accountNamePattern = /^[A-Za-z0-9_-]+$/

// Ed25519 multicodec prefix (varint-encoded 0xed = [0xed, 0x01]).
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

/** A principal: multicodec prefix + raw Ed25519 public key. */
export type Principal = Uint8Array

/** Build a Principal from a raw 32-byte Ed25519 public key. */
export function principalFromPublicKey(publicKey: Uint8Array): Principal {
  const principal = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + publicKey.length)
  principal.set(ED25519_MULTICODEC_PREFIX, 0)
  principal.set(publicKey, ED25519_MULTICODEC_PREFIX.length)
  return principal
}

/** Encode a Principal to its base58btc multibase string (starts with 'z'). */
export function principalToString(principal: Principal): string {
  return base58btc.encode(principal)
}

/** Derive the account ID (base58btc principal string) from a 32-byte Ed25519 seed. */
export function accountIdFromSeed(seed: Uint8Array): string {
  return principalToString(principalFromPublicKey(new Uint8Array(ed25519.getPublicKey(seed))))
}

/**
 * Minimal capability metadata stored per delegation.
 * The raw CBOR blob bytes live in the external blockstore, keyed by cid.
 */
export interface CapabilityMeta {
  /** CID (content address) of the capability blob in the blockstore. */
  cid: CID
  /** Delegate principal (packed Ed25519 public key) that received the rights. */
  delegate: Principal
}

/** A single Hypermedia account stored in the vault. */
export interface Account {
  /** Optional private key label used for daemon key-name lookups. */
  name?: string
  /** The 32-byte Ed25519 seed to reconstruct the key pair. */
  seed: Uint8Array
  /** Account creation timestamp. */
  createTime: number
  /** Allowed cross-device web application sessions. */
  delegations: DelegatedSession[]
}

/** Record of a delegation issued to a third-party site's session key. */
export interface DelegatedSession {
  /** The origin (client_id) the delegation was issued to, e.g. "https://example.com". */
  clientId: string
  /** Type of device that requested the session. */
  deviceType?: 'desktop' | 'mobile' | 'tablet'
  /** Minimal capability metadata (full blob bytes are stored externally). */
  capability: CapabilityMeta
  /** Unix timestamp ms when the delegation was created. */
  createTime: number
}

/** Top-level vault state. The actual encrypted data. */
export interface State {
  /**
   * Schema version for future migrations.
   * Do not confuse with version for concurrency control which is stored in the database separately.
   */
  version: 2
  /** Optional notification server override for delegated sessions and UI display. */
  notificationServerUrl?: string
  /** Tombstones for deleted accounts, keyed by canonical account name. */
  deletedAccounts?: Record<string, number>
  /** List of Hypermedia accounts. */
  accounts: Account[]
}

type UnknownFields = Record<string, unknown>
type InternalState = State & {[stateExtraKey]?: UnknownFields}
type InternalAccount = Account & {[accountExtraKey]?: UnknownFields}
type InternalDelegation = DelegatedSession & {[delegationExtraKey]?: UnknownFields}
type InternalCapability = CapabilityMeta & {[capabilityExtraKey]?: UnknownFields}

/** Create an empty vault. */
export function createEmpty(): State {
  return {version: VAULT_VERSION, accounts: []}
}

/** Serialize vault data: CBOR encode → gzip compress. Returns compressed bytes. */
export async function serialize(data: State): Promise<Uint8Array> {
  const encodedCb = cborg.encode(encodeState(data as InternalState), cborEncodeOpts)
  return compress(new Uint8Array(encodedCb))
}

/** Deserialize vault data: gzip decompress → CBOR decode. Throws if version mismatches. */
export async function deserialize(compressed: Uint8Array): Promise<State> {
  const decodedCb = await decompress(compressed)
  const decoded = dagCBOR.decode(decodedCb) as Record<string, unknown>

  if (decoded.version !== VAULT_VERSION) {
    throw new Error(
      `Vault schema version mismatch: stored version is ${decoded.version}, but this client expects version ${VAULT_VERSION}. ` +
        'The vault data is incompatible with this version of the application.',
    )
  }

  return decodeState(decoded)
}

/** Ensure account name compatibility for older vault records that have no label. */
export function getAccountName(account: Pick<Account, 'name' | 'seed'>): string {
  const normalized = typeof account.name === 'string' ? account.name.trim() : ''
  if (normalized && accountNamePattern.test(normalized)) {
    return normalized
  }

  return accountIdFromSeed(account.seed)
}

function normalizeAccount(account: InternalAccount): InternalAccount {
  return {
    ...account,
    name: getAccountName(account),
  }
}

function accountWinsByTiebreak(current: InternalAccount, candidate: InternalAccount): boolean {
  if (candidate.createTime > current.createTime) return true
  if (candidate.createTime < current.createTime) return false
  return accountIdFromSeed(candidate.seed).localeCompare(accountIdFromSeed(current.seed)) > 0
}

function normalizeAccounts(accounts: InternalAccount[]): InternalAccount[] {
  const deduped = new Map<string, InternalAccount>()
  const order: string[] = []

  for (const rawAccount of accounts) {
    const account = normalizeAccount(rawAccount)
    const name = account.name!
    const existing = deduped.get(name)
    if (!existing) {
      order.push(name)
      deduped.set(name, account)
      continue
    }
    if (accountWinsByTiebreak(existing, account)) {
      deduped.set(name, account)
    }
  }

  return order.map((name) => deduped.get(name)!)
}

function decodeState(decoded: Record<string, unknown>): State {
  const accounts = normalizeAccounts(
    Array.isArray(decoded.accounts)
      ? decoded.accounts.map((account) => decodeAccount(account as Record<string, unknown>) as InternalAccount)
      : [],
  )

  const restored: InternalState = {
    version: VAULT_VERSION,
    accounts,
  }
  if (typeof decoded.notificationServerUrl === 'string') {
    restored.notificationServerUrl = decoded.notificationServerUrl
  }
  if (isDeletedAccounts(decoded.deletedAccounts)) {
    restored.deletedAccounts = {...decoded.deletedAccounts}
  }
  restored[stateExtraKey] = omitKnown(decoded, ['version', 'notificationServerUrl', 'deletedAccounts', 'accounts'])
  return restored
}

function decodeAccount(decoded: Record<string, unknown>): Account {
  const account: InternalAccount = {
    name: typeof decoded.name === 'string' ? decoded.name : undefined,
    seed: new Uint8Array(decoded.seed as Uint8Array),
    createTime: Number(decoded.createTime ?? 0),
    delegations: Array.isArray(decoded.delegations)
      ? decoded.delegations.map((delegation) => decodeDelegation(delegation as Record<string, unknown>))
      : [],
  }
  account[accountExtraKey] = omitKnown(decoded, ['name', 'seed', 'createTime', 'delegations'])
  return normalizeAccount(account)
}

function decodeDelegation(decoded: Record<string, unknown>): DelegatedSession {
  const delegation: InternalDelegation = {
    clientId: String(decoded.clientId ?? ''),
    deviceType:
      typeof decoded.deviceType === 'string' ? (decoded.deviceType as DelegatedSession['deviceType']) : undefined,
    capability: decodeCapability(decoded.capability as Record<string, unknown>),
    createTime: Number(decoded.createTime ?? 0),
  }
  delegation[delegationExtraKey] = omitKnown(decoded, ['clientId', 'deviceType', 'capability', 'createTime'])
  return delegation
}

function decodeCapability(decoded: Record<string, unknown>): CapabilityMeta {
  const capability: InternalCapability = {
    cid: decoded.cid as CID,
    delegate: decoded.delegate as Principal,
  }
  capability[capabilityExtraKey] = omitKnown(decoded, ['cid', 'delegate'])
  return capability
}

function encodeState(data: InternalState): Record<string, unknown> {
  const encoded: Record<string, unknown> = {
    ...data[stateExtraKey],
    version: VAULT_VERSION,
    accounts: normalizeAccounts(data.accounts as InternalAccount[]).map((account) => encodeAccount(account)),
  }
  if (data.notificationServerUrl) {
    encoded.notificationServerUrl = data.notificationServerUrl
  }
  if (data.deletedAccounts && Object.keys(data.deletedAccounts).length > 0) {
    encoded.deletedAccounts = data.deletedAccounts
  }
  return encoded
}

function encodeAccount(account: InternalAccount): Record<string, unknown> {
  const normalizedAccount = normalizeAccount(account)
  const encoded: Record<string, unknown> = {
    ...normalizedAccount[accountExtraKey],
    seed: normalizedAccount.seed,
    createTime: normalizedAccount.createTime,
    delegations: normalizedAccount.delegations.map((delegation) => encodeDelegation(delegation as InternalDelegation)),
  }
  encoded.name = normalizedAccount.name
  return encoded
}

function encodeDelegation(delegation: InternalDelegation): Record<string, unknown> {
  const encoded: Record<string, unknown> = {
    ...delegation[delegationExtraKey],
    clientId: delegation.clientId,
    capability: encodeCapability(delegation.capability as InternalCapability),
    createTime: delegation.createTime,
  }
  if (delegation.deviceType) {
    encoded.deviceType = delegation.deviceType
  }
  return encoded
}

function encodeCapability(capability: InternalCapability): Record<string, unknown> {
  return {
    ...capability[capabilityExtraKey],
    cid: capability.cid,
    delegate: capability.delegate,
  }
}

function omitKnown(decoded: Record<string, unknown>, keys: string[]): UnknownFields {
  const extras: UnknownFields = {}
  for (const [key, value] of Object.entries(decoded)) {
    if (keys.includes(key)) continue
    extras[key] = value
  }
  return extras
}

function isDeletedAccounts(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'number')
}

/** Compress data using gzip. */
async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data as any)
  writer.close()
  return collectStream(cs.readable)
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data as any)
  writer.close()
  return collectStream(ds.readable)
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

// ─── HKDF key derivation (shared with the vault server/web app) ──────────────

/**
 * Derive a 256-bit key from the root key using HKDF-SHA256.
 */
export async function deriveHKDFKey(rootKey: Uint8Array, info: string): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', rootKey.buffer as ArrayBuffer, {name: 'HKDF'}, false, [
    'deriveBits',
  ])

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    256,
  )

  return new Uint8Array(derived)
}

/**
 * Derive the vault encryption key from the root key.
 */
export async function deriveEncryptionKey(rootKey: Uint8Array): Promise<Uint8Array> {
  return deriveHKDFKey(rootKey, 'seed-hypermedia-vault-encryption')
}

/**
 * Derive the password authentication key from the root key.
 */
export async function deriveAuthKey(rootKey: Uint8Array): Promise<Uint8Array> {
  return deriveHKDFKey(rootKey, 'seed-hypermedia-vault-authentication')
}

/**
 * Derive the authentication key for a secret credential from its KEK.
 */
export async function deriveSecretCredentialAuthKey(secret: Uint8Array): Promise<Uint8Array> {
  return deriveHKDFKey(secret, 'seed-hypermedia-vault-secret-authentication')
}

// ─── vault.json envelope (written by the daemon, backend/storage/vault) ──────

/** A DEK-wrapping credential stored in the envelope (e.g. a master password). */
export interface VaultCredentialRef {
  kind: string
  credentialId: string
  /** base64url (no padding) XChaCha20-Poly1305 wrapping of the DEK. */
  wrappedDEK: Uint8Array
}

/** Remote vault connection metadata stored in the envelope. */
export interface VaultRemoteRef {
  vaultUrl: string
  userId: string
  credentialId: string
}

/** Parsed contents of a `vault.json` file. */
export interface VaultEnvelope {
  /** XChaCha20-Poly1305(gzip(cbor(State)), DEK), nonce prepended. */
  encryptedData: Uint8Array
  /** XChaCha20-Poly1305(DEK, KEK), nonce prepended. */
  wrappedDEK: Uint8Array
  credentials: VaultCredentialRef[]
  remote: VaultRemoteRef | null
}

/**
 * Parse the JSON contents of a `vault.json` envelope file.
 * Mirrors the validation in backend/storage/vault/file.go.
 */
export function parseVaultEnvelope(json: string): VaultEnvelope {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Failed to decode vault envelope: not valid JSON.')
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Failed to decode vault envelope: expected a JSON object.')
  }

  const encryptedData = decodeStdBase64Field(raw.encryptedData, 'encryptedData')
  const wrappedDEK = decodeStdBase64Field(raw.wrappedDEK, 'wrappedDEK')
  if (encryptedData.length === 0) {
    throw new Error('Vault encrypted data must not be empty.')
  }
  if (wrappedDEK.length === 0) {
    throw new Error('Vault wrapped DEK must not be empty.')
  }

  const credentials: VaultCredentialRef[] = Array.isArray(raw.credentials)
    ? raw.credentials.map((entry: Record<string, unknown>) => ({
        kind: String(entry.kind ?? ''),
        credentialId: String(entry.credentialId ?? ''),
        wrappedDEK: Uint8Array.fromBase64(String(entry.wrappedDEK ?? ''), {alphabet: 'base64url'}),
      }))
    : []

  let remote: VaultRemoteRef | null = null
  const rawRemote = raw.remote as Record<string, unknown> | undefined
  if (rawRemote && typeof rawRemote === 'object') {
    if (typeof rawRemote.vaultUrl !== 'string' || rawRemote.vaultUrl === '') {
      throw new Error('Remote vault URL is required.')
    }
    if (typeof rawRemote.userId !== 'string' || rawRemote.userId === '') {
      throw new Error('Remote vault user ID is required.')
    }
    remote = {
      vaultUrl: rawRemote.vaultUrl,
      userId: rawRemote.userId,
      credentialId: typeof rawRemote.credentialId === 'string' ? rawRemote.credentialId : '',
    }
  }

  return {encryptedData, wrappedDEK, credentials, remote}
}

function decodeStdBase64Field(value: unknown, field: string): Uint8Array {
  if (value == null) return new Uint8Array(0)
  if (typeof value !== 'string') {
    throw new Error(`Failed to decode vault envelope: "${field}" must be a base64 string.`)
  }
  try {
    return Uint8Array.fromBase64(value, {alphabet: 'base64'})
  } catch {
    throw new Error(`Failed to decode vault envelope: "${field}" is not valid base64.`)
  }
}

/**
 * Unwrap the vault's data encryption key using the wrapping key (KEK).
 * The KEK is the local vault secret, or the remote credential secret for
 * remote-connected vaults.
 */
export async function unwrapDEK(envelope: VaultEnvelope, wrappingKey: Uint8Array): Promise<Uint8Array> {
  try {
    return await decrypt(envelope.wrappedDEK, wrappingKey)
  } catch {
    throw new Error('Failed to unwrap the vault data encryption key: wrong vault secret.')
  }
}

/**
 * Decrypt and decode the vault state from an envelope using the unwrapped DEK.
 */
export async function decryptVaultState(envelope: VaultEnvelope, dek: Uint8Array): Promise<State> {
  let compressed: Uint8Array
  try {
    compressed = await decrypt(envelope.encryptedData, dek)
  } catch {
    throw new Error('Failed to decrypt the vault payload: wrong data encryption key.')
  }
  return deserialize(compressed)
}
