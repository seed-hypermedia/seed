/**
 * Vault state merge — a line-for-line port of the Go implementation in
 * backend/storage/vault/vault.go (normalizeState/mergeNormalizedStates/
 * statesEqual and helpers, vault.go:2387-2790).
 *
 * Byte-compatibility with Go is the prime directive here: the merge is what
 * keeps every device's vault convergent, and any divergence makes devices
 * oscillate or silently lose identities. Notable Go semantics preserved:
 *
 * - Accounts are keyed by PRINCIPAL (base58 account ID derived from the seed),
 *   never by display name. Two accounts may share a display name.
 * - ALL string comparisons are byte-wise (Go's `<`/`>` on strings), NEVER
 *   locale-aware: base58 principals are mixed-case and ICU collation orders
 *   them differently than Go does.
 * - Tombstones kill an account only when `tombstone >= latestLiveCreateTime`
 *   (and > 0); otherwise the tombstone is deleted (resurrection).
 * - Unknown CBOR fields (Go's `Extra`) merge as remote's overlaid by local's,
 *   and participate in equality via dag-cbor byte comparison.
 *
 * Merge decisions are logged through the `log` callback (default: console.log
 * with the same 🔑 VAULT-MERGE marker the Go daemon uses) — this path has
 * burned the team before, keep it loud and greppable.
 */

import * as dagCBOR from '@ipld/dag-cbor'
import * as cborg from 'cborg'
import './base64'
import {
  accountIdFromSeed,
  getUnknownFields,
  setUnknownFields,
  VAULT_VERSION,
  type Account,
  type CapabilityMeta,
  type DelegatedSession,
  type State,
} from './vault'

// Same dag-cbor options as vault.ts (work around dag-cbor rejecting `undefined`).
const cborEncodeOpts = {
  ...dagCBOR.encodeOptions,
  typeEncoders: {
    ...dagCBOR.encodeOptions.typeEncoders,
    undefined: () => null,
  },
} satisfies typeof dagCBOR.encodeOptions

// Mirrors Go's localKeyNameFormat (backend/storage/vault/file.go).
const localKeyNameFormat = /^[a-zA-Z0-9_-]+$/
const ED25519_SEED_SIZE = 32

/** Loud, greppable marker matching Go's vaultMergeLogPrefix. */
export const VAULT_MERGE_LOG_PREFIX = '🔑 VAULT-MERGE'

export type VaultMergeLogger = (message: string, fields?: Record<string, unknown>) => void

const defaultLog: VaultMergeLogger = (message, fields) => {
  if (fields === undefined) {
    console.log(`${VAULT_MERGE_LOG_PREFIX} ${message}`)
  } else {
    console.log(`${VAULT_MERGE_LOG_PREFIX} ${message}`, fields)
  }
}

export type NormalizedAccount = {principal: string; account: Account}

export type NormalizedState = {
  notificationServerUrl: string
  /** Accounts keyed by principal (base58 account ID). */
  accounts: Map<string, NormalizedAccount>
  /** Tombstones keyed by principal. */
  deletedAccounts: Record<string, number>
  /** Unknown top-level CBOR fields (Go State.Extra), preserved through the merge. */
  extra: Record<string, unknown>
}

/**
 * Normalize a state for merging: key accounts by principal, resolve duplicate
 * principals, normalize display names (merge-time only) and dedupe delegations
 * by capability CID. Throws on invalid (non-32-byte) seeds, like Go errors.
 * `source` labels error messages ('local' or 'remote').
 */
export function normalizeState(state: State, source: string): NormalizedState {
  const normalized: NormalizedState = {
    notificationServerUrl: state.notificationServerUrl ?? '',
    accounts: new Map(),
    deletedAccounts: {...(state.deletedAccounts ?? {})},
    extra: {...getUnknownFields(state)},
  }

  state.accounts.forEach((account, idx) => {
    if (account.seed.length !== ED25519_SEED_SIZE) {
      throw new Error(
        `${source} account ${idx} has invalid seed length: got ${account.seed.length}, expected ${ED25519_SEED_SIZE}`,
      )
    }

    const principal = accountIdFromSeed(account.seed)
    let normalizedDelegations: DelegatedSession[]
    try {
      normalizedDelegations = normalizeDelegations(account.delegations)
    } catch (err) {
      throw new Error(`${source} account ${idx} has invalid delegations: ${(err as Error).message}`)
    }

    const nextAccount: Account = {
      name: normalizeKeyName(account.name, principal),
      seed: new Uint8Array(account.seed),
      createTime: account.createTime,
      delegations: normalizedDelegations,
    }
    setUnknownFields(nextAccount, getUnknownFields(account))
    const next: NormalizedAccount = {principal, account: nextAccount}

    const existing = normalized.accounts.get(principal)
    if (!existing) {
      normalized.accounts.set(principal, next)
      return
    }
    normalized.accounts.set(principal, mergeDuplicateAccount(existing, next))
  })

  return normalized
}

/** Semantic state equality, matching Go's statesEqual (never compares serialized bytes). */
export function statesEqual(left: State, right: State): boolean {
  return normalizedStatesEqual(normalizeState(left, 'local'), normalizeState(right, 'remote'))
}

/**
 * Merge two states, matching Go's mergeStates convenience path:
 * normalize both sides, then mergeNormalizedStates.
 */
export function mergeStates(
  local: State,
  remote: State,
  localVersion: number,
  remoteVersion: number,
  log: VaultMergeLogger = defaultLog,
): {merged: State; changedFromLocal: boolean} {
  return mergeNormalizedStates(
    normalizeState(local, 'local'),
    normalizeState(remote, 'remote'),
    localVersion,
    remoteVersion,
    log,
  )
}

/**
 * The merge algorithm itself (Go mergeNormalizedStates). `changedFromLocal`
 * reports whether the merged result differs semantically from `local` — the
 * caller uses it to decide whether the local vault needs rewriting.
 */
export function mergeNormalizedStates(
  local: NormalizedState,
  remote: NormalizedState,
  localVersion: number,
  remoteVersion: number,
  log: VaultMergeLogger = defaultLog,
): {merged: State; changedFromLocal: boolean} {
  const mergedDeleted: Record<string, number> = {...local.deletedAccounts}
  for (const [accountID, deleteTime] of Object.entries(remote.deletedAccounts)) {
    if ((mergedDeleted[accountID] ?? 0) < deleteTime) {
      mergedDeleted[accountID] = deleteTime
    }
  }

  const merged: State = {
    version: VAULT_VERSION,
    accounts: [],
  }
  const notificationServerUrl = chooseMergedNotificationServerURL(
    local.notificationServerUrl,
    remote.notificationServerUrl,
    localVersion,
    remoteVersion,
  )
  if (notificationServerUrl) {
    merged.notificationServerUrl = notificationServerUrl
  }
  setUnknownFields(merged, {...remote.extra, ...local.extra})

  const accountIDs = new Set<string>([
    ...local.accounts.keys(),
    ...remote.accounts.keys(),
    ...Object.keys(mergedDeleted),
  ])
  const accountIDsList = [...accountIDs].sort(compareStringsBytewise)

  for (const accountID of accountIDsList) {
    const localAccount = local.accounts.get(accountID)
    const remoteAccount = remote.accounts.get(accountID)
    const localTombstone = local.deletedAccounts[accountID] ?? 0
    const remoteTombstone = remote.deletedAccounts[accountID] ?? 0
    const winningTombstone = Math.max(localTombstone, remoteTombstone)
    let latestLiveCreateTime = 0
    if (localAccount && localAccount.account.createTime > latestLiveCreateTime) {
      latestLiveCreateTime = localAccount.account.createTime
    }
    if (remoteAccount && remoteAccount.account.createTime > latestLiveCreateTime) {
      latestLiveCreateTime = remoteAccount.account.createTime
    }
    if (winningTombstone >= latestLiveCreateTime && winningTombstone > 0) {
      mergedDeleted[accountID] = winningTombstone
      log('account deleted by tombstone', {accountID, winningTombstone, latestLiveCreateTime})
      continue
    }

    delete mergedDeleted[accountID]
    if (!localAccount && !remoteAccount) continue

    let next: Account
    if (localAccount && remoteAccount) {
      if (bytesEqual(localAccount.account.seed, remoteAccount.account.seed)) {
        next = mergeMatchingAccounts(localAccount.account, remoteAccount.account)
      } else if (accountWinsByTiebreak(localAccount, remoteAccount)) {
        log('divergent key material for principal: REMOTE account won the tiebreak', {accountID})
        next = remoteAccount.account
      } else {
        log('divergent key material for principal: LOCAL account won the tiebreak', {accountID})
        next = localAccount.account
      }
    } else if (localAccount) {
      next = localAccount.account
    } else {
      next = remoteAccount!.account
    }

    merged.accounts.push(next)
  }

  merged.accounts.sort((a, b) => {
    const nameDiff = compareStringsBytewise(a.name ?? '', b.name ?? '')
    if (nameDiff !== 0) return nameDiff
    return compareStringsBytewise(accountIdFromSeed(a.seed), accountIdFromSeed(b.seed))
  })

  if (Object.keys(mergedDeleted).length > 0) {
    merged.deletedAccounts = mergedDeleted
  }

  const mergedNormalized = normalizeState(merged, 'local')
  const changedFromLocal = !normalizedStatesEqual(local, mergedNormalized)

  log('mergeNormalizedStates result (local ⊕ remote → merged)', {
    localVersion,
    remoteVersion,
    changedLocalVault: changedFromLocal,
    localIdentityCount: local.accounts.size,
    remoteIdentityCount: remote.accounts.size,
    mergedIdentityCount: merged.accounts.length,
    mergedIdentities: merged.accounts.map((account) => `${account.name ?? ''} (${accountIdFromSeed(account.seed)})`),
    mergedTombstones: Object.keys(mergedDeleted).sort(compareStringsBytewise),
  })

  return {merged, changedFromLocal}
}

// ─── Internal helpers (each maps 1:1 to a Go function) ───────────────────────

function normalizedStatesEqual(left: NormalizedState, right: NormalizedState): boolean {
  if (left.notificationServerUrl !== right.notificationServerUrl) return false
  if (!equalDeletedAccounts(left.deletedAccounts, right.deletedAccounts)) return false
  if (!cborValuesEqual(left.extra, right.extra)) return false
  if (left.accounts.size !== right.accounts.size) return false

  for (const [principal, leftAccount] of left.accounts) {
    const rightAccount = right.accounts.get(principal)
    if (!rightAccount) return false
    // Go compares marshaled key pairs; Ed25519 keys are fully determined by
    // the seed, so seed byte-equality is the same predicate.
    if (!bytesEqual(leftAccount.account.seed, rightAccount.account.seed)) return false
    if (!cborValuesEqual(accountToEncodable(leftAccount.account), accountToEncodable(rightAccount.account))) {
      return false
    }
  }

  return true
}

/** Go accountWinsByTiebreak: does `candidate` win over `current`? */
function accountWinsByTiebreak(current: NormalizedAccount, candidate: NormalizedAccount): boolean {
  if (candidate.account.createTime > current.account.createTime) return true
  if (candidate.account.createTime < current.account.createTime) return false
  const principalDiff = compareStringsBytewise(candidate.principal, current.principal)
  if (principalDiff > 0) return true
  if (principalDiff < 0) return false
  return compareStringsBytewise(candidate.account.name ?? '', current.account.name ?? '') > 0
}

/** Go mergeDuplicateAccount: resolve two accounts sharing a principal within one state. */
function mergeDuplicateAccount(existing: NormalizedAccount, candidate: NormalizedAccount): NormalizedAccount {
  if (bytesEqual(existing.account.seed, candidate.account.seed)) {
    const mergedDelegations = normalizeDelegations([...existing.account.delegations, ...candidate.account.delegations])
    if (accountWinsByTiebreak(existing, candidate)) {
      candidate.account.delegations = mergedDelegations
      return candidate
    }
    existing.account.delegations = mergedDelegations
    return existing
  }

  if (accountWinsByTiebreak(existing, candidate)) return candidate
  return existing
}

/** Go mergeMatchingAccounts: same principal + same key bytes on both sides. */
function mergeMatchingAccounts(local: Account, remote: Account): Account {
  const mergedDelegations = normalizeDelegations([...local.delegations, ...remote.delegations])

  const merged: Account = {
    name: local.name || remote.name,
    seed: local.seed.length > 0 ? new Uint8Array(local.seed) : remote.seed,
    createTime: Math.max(local.createTime, remote.createTime),
    delegations: mergedDelegations,
  }
  setUnknownFields(merged, {...getUnknownFields(remote), ...getUnknownFields(local)})
  return merged
}

/** Go normalizeRemoteDelegations: dedupe by capability CID, tiebreak, sort by CID key. */
function normalizeDelegations(delegations: DelegatedSession[] | undefined): DelegatedSession[] {
  if (!delegations || delegations.length === 0) return []

  const byCID = new Map<string, DelegatedSession>()
  delegations.forEach((delegation, idx) => {
    let cidKey: string
    try {
      cidKey = delegationCapabilityCIDKey(delegation)
    } catch (err) {
      throw new Error(`delegation ${idx}: ${(err as Error).message}`)
    }

    const existing = byCID.get(cidKey)
    if (!existing || delegationWinsByTiebreak(existing, delegation)) {
      byCID.set(cidKey, delegation)
    }
  })

  const keys = [...byCID.keys()].sort(compareStringsBytewise)
  return keys.map((key) => byCID.get(key)!)
}

/** Go delegationWinsByTiebreak: does `candidate` win over `current`? */
function delegationWinsByTiebreak(current: DelegatedSession, candidate: DelegatedSession): boolean {
  if (candidate.createTime > current.createTime) return true
  if (candidate.createTime < current.createTime) return false
  const clientDiff = compareStringsBytewise(candidate.clientId, current.clientId)
  if (clientDiff > 0) return true
  if (clientDiff < 0) return false
  return compareStringsBytewise(candidate.deviceType ?? '', current.deviceType ?? '') > 0
}

/**
 * Go delegationCapabilityCIDKey: base64url (no padding) of the dag-cbor
 * encoding of the capability CID (tag 42 + 0x00 multibase prefix — identical
 * bytes to Go's cbornode.DumpObject(cid)).
 */
function delegationCapabilityCIDKey(delegation: DelegatedSession): string {
  const cid = delegation.capability?.cid
  if (!cid) {
    throw new Error('delegation capability CID is missing')
  }
  return (dagCBOR.encode(cid) as Uint8Array).toBase64({alphabet: 'base64url', omitPadding: true})
}

/** Go chooseMergedNotificationServerURL: higher version wins; tie → local if set or remote empty. */
function chooseMergedNotificationServerURL(
  local: string,
  remote: string,
  localVersion: number,
  remoteVersion: number,
): string {
  if (remoteVersion > localVersion) return remote
  if (localVersion > remoteVersion) return local
  if (local !== '' || remote === '') return local
  return remote
}

/** Go normalizeKeyName: trimmed name if it matches the key-name format, else the principal. */
function normalizeKeyName(name: string | undefined, principal: string): string {
  const normalized = (name ?? '').trim()
  if (normalized === '' || !localKeyNameFormat.test(normalized)) return principal
  return normalized
}

function equalDeletedAccounts(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left)
  if (leftEntries.length !== Object.keys(right).length) return false
  for (const [name, leftValue] of leftEntries) {
    if (right[name] !== leftValue) return false
  }
  return true
}

/** Go cborValuesEqual: compare by canonical CBOR encoding bytes; false on encode failure. */
function cborValuesEqual(left: unknown, right: unknown): boolean {
  let leftEncoded: Uint8Array
  let rightEncoded: Uint8Array
  try {
    leftEncoded = cborg.encode(left, cborEncodeOpts)
    rightEncoded = cborg.encode(right, cborEncodeOpts)
  } catch {
    return false
  }
  return bytesEqual(leftEncoded, rightEncoded)
}

// Encodable (plain-map) forms mirroring Go's atlas encodePayload*Map functions,
// used only for CBOR-byte equality: known fields plus unknown extras, with
// omitempty semantics for name/deviceType. NOT the codec — no name filling.

function accountToEncodable(account: Account): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...getUnknownFields(account),
    seed: account.seed,
    createTime: account.createTime,
    delegations: account.delegations.map((delegation) => delegationToEncodable(delegation)),
  }
  if (account.name) out.name = account.name
  return out
}

function delegationToEncodable(delegation: DelegatedSession): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...getUnknownFields(delegation),
    clientId: delegation.clientId,
    capability: capabilityToEncodable(delegation.capability),
    createTime: delegation.createTime,
  }
  if (delegation.deviceType) out.deviceType = delegation.deviceType
  return out
}

function capabilityToEncodable(capability: CapabilityMeta): Record<string, unknown> {
  return {
    ...getUnknownFields(capability),
    cid: capability.cid,
    delegate: capability.delegate,
  }
}

const utf8Encoder = new TextEncoder()

/**
 * Byte-wise UTF-8 string comparison, matching Go's `<`/`>` on strings.
 * NEVER localeCompare: base58 principals are mixed-case and ICU collation
 * disagrees with Go's byte order.
 */
function compareStringsBytewise(a: string, b: string): number {
  const aBytes = utf8Encoder.encode(a)
  const bBytes = utf8Encoder.encode(b)
  const len = Math.min(aBytes.length, bBytes.length)
  for (let i = 0; i < len; i++) {
    const diff = aBytes[i]! - bBytes[i]!
    if (diff !== 0) return diff
  }
  return aBytes.length - bBytes.length
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
