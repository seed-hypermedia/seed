/**
 * Vault data model and CBOR+compression serialization.
 * Defines the structured format for storing Hypermedia identity accounts.
 */

import type {Principal} from '@shm/shared/blobs'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {CID} from 'multiformats/cid'

/** Current vault schema version. Bump on every incompatible schema change. */
export const VAULT_VERSION = 2

const stateExtraKey = Symbol('vault-state-extra')
const accountExtraKey = Symbol('vault-account-extra')
const delegationExtraKey = Symbol('vault-delegation-extra')
const capabilityExtraKey = Symbol('vault-capability-extra')
const accountNamePattern = /^[A-Za-z0-9_-]+$/

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
  const encodedCb = cbor.encode(encodeState(data as InternalState))
  return compress(new Uint8Array(encodedCb))
}

/** Deserialize vault data: gzip decompress → CBOR decode. Throws if version mismatches. */
export async function deserialize(compressed: Uint8Array): Promise<State> {
  const decodedCb = await decompress(compressed)
  const decoded = cbor.decode(decodedCb) as Record<string, unknown>

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

  const keyPair = blobs.nobleKeyPairFromSeed(account.seed)
  return blobs.principalToString(keyPair.principal)
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
  return (
    blobs
      .principalToString(blobs.nobleKeyPairFromSeed(candidate.seed).principal)
      .localeCompare(blobs.principalToString(blobs.nobleKeyPairFromSeed(current.seed).principal)) > 0
  )
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
