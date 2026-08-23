/**
 * Merge tests transcribed from backend/storage/vault/vault_test.go
 * (TestMergeNormalizedStates*), plus TS-specific guards:
 * - two accounts sharing a display name with distinct principals survive
 *   mergeStates → serializeState → deserializeState (the legacy deduping
 *   codec drops one — the exact identity-loss hazard the Go-parity codec
 *   exists to prevent),
 * - a regression pin that the legacy `serialize` output is unchanged.
 */

import {CID} from 'multiformats/cid'
import {describe, expect, test} from 'vitest'
import './base64'
import {
  mergeNormalizedStates,
  mergeStates,
  normalizeState,
  statesEqual,
  type NormalizedState,
  type VaultMergeLogger,
} from './vault-merge'
import * as vault from './vault'
import {getUnknownFields, setUnknownFields, type Account, type DelegatedSession, type State} from './vault'

// Quiet logger for tests; the default logger is console-loud on purpose.
const noLog: VaultMergeLogger = () => {}

const SEED_A = new Uint8Array(32).fill(3)
const SEED_B = new Uint8Array(32).fill(9)
const SEED_C = new Uint8Array(32).fill(17)

const CID_A = CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')
const CID_B = CID.parse('bafyreigx6wfu7t5m3zx6j6ppd4hf6m3r3r4l5xw2l7v6n3wz6n3g5z6x6e')

function makeState(accounts: Account[], rest: Partial<Omit<State, 'version' | 'accounts'>> = {}): State {
  return {version: 2, accounts, ...rest}
}

function account(
  name: string | undefined,
  seed: Uint8Array,
  createTime: number,
  delegations: DelegatedSession[] = [],
): Account {
  return {name, seed, createTime, delegations}
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data as never)
  writer.close()
  return collect(cs.readable)
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data as never)
  writer.close()
  return collect(ds.readable)
}

async function collect(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    total.set(chunk, offset)
    offset += chunk.length
  }
  return total
}

function toHex(data: Uint8Array): string {
  let hex = ''
  for (const byte of data) hex += byte.toString(16).padStart(2, '0')
  return hex
}

describe('mergeNormalizedStates (vault_test.go transcriptions)', () => {
  test('prefers newer notificationServerUrl', () => {
    const local = normalizeState(makeState([], {notificationServerUrl: 'https://notify.local.example.com'}), 'local')
    const remote = normalizeState(makeState([], {notificationServerUrl: 'https://notify.remote.example.com'}), 'remote')

    const {merged, changedFromLocal} = mergeNormalizedStates(local, remote, 1, 2, noLog)
    expect(changedFromLocal).toBe(true)
    expect(merged.notificationServerUrl).toBe('https://notify.remote.example.com')
  })

  test('notificationServerUrl matrix: local version wins, tie prefers local when set', () => {
    const localUrl = 'https://notify.local.example.com'
    const remoteUrl = 'https://notify.remote.example.com'
    const withUrl = (url?: string) => normalizeState(makeState([], url ? {notificationServerUrl: url} : {}), 'local')

    // Higher local version → local URL.
    expect(mergeNormalizedStates(withUrl(localUrl), withUrl(remoteUrl), 3, 2, noLog).merged.notificationServerUrl).toBe(
      localUrl,
    )
    // Tie, local set → local.
    expect(mergeNormalizedStates(withUrl(localUrl), withUrl(remoteUrl), 2, 2, noLog).merged.notificationServerUrl).toBe(
      localUrl,
    )
    // Tie, local empty, remote set → remote.
    expect(
      mergeNormalizedStates(withUrl(undefined), withUrl(remoteUrl), 2, 2, noLog).merged.notificationServerUrl,
    ).toBe(remoteUrl)
    // Tie, both empty → absent.
    expect(
      mergeNormalizedStates(withUrl(undefined), withUrl(undefined), 2, 2, noLog).merged.notificationServerUrl,
    ).toBeUndefined()
  })

  test('deduplicates accounts by principal', () => {
    const local = normalizeState(makeState([account('shared', SEED_A, 1)]), 'local')
    const remote = normalizeState(makeState([account('renamed', SEED_A, 2)]), 'remote')

    const {merged, changedFromLocal} = mergeNormalizedStates(local, remote, 1, 2, noLog)
    expect(changedFromLocal).toBe(true)
    expect(merged.accounts).toHaveLength(1)
    expect(merged.accounts[0]!.name).toBe('shared')
    expect(merged.accounts[0]!.seed).toEqual(SEED_A)
    expect(merged.accounts[0]!.createTime).toBe(2)
  })

  test('deletes renamed account by principal', () => {
    const accountId = vault.accountIdFromSeed(SEED_A)
    const local = normalizeState(makeState([account('renamed', SEED_A, 10)]), 'local')
    const remote = normalizeState(makeState([], {deletedAccounts: {[accountId]: 20}}), 'remote')

    const {merged, changedFromLocal} = mergeNormalizedStates(local, remote, 1, 2, noLog)
    expect(changedFromLocal).toBe(true)
    expect(merged.accounts).toHaveLength(0)
    expect(merged.deletedAccounts?.[accountId]).toBe(20)
  })

  test('an account created after the tombstone resurrects (tombstone deleted)', () => {
    const accountId = vault.accountIdFromSeed(SEED_A)
    const local = normalizeState(makeState([account('reborn', SEED_A, 30)]), 'local')
    const remote = normalizeState(makeState([], {deletedAccounts: {[accountId]: 20}}), 'remote')

    const {merged} = mergeNormalizedStates(local, remote, 1, 2, noLog)
    expect(merged.accounts).toHaveLength(1)
    expect(merged.accounts[0]!.name).toBe('reborn')
    expect(merged.deletedAccounts?.[accountId]).toBeUndefined()
  })

  test('keeps local account metadata across remote version bump', () => {
    const localAccount = account('renamed', SEED_A, 1)
    setUnknownFields(localAccount, {conflict: 'local', local: 'value'})
    const local = normalizeState(makeState([localAccount]), 'local')

    const staleRemote = account('stale-remote-name', SEED_A, 1)
    setUnknownFields(staleRemote, {conflict: 'remote', remote: 'value'})
    const remote = normalizeState(makeState([staleRemote, account('remote-only', SEED_B, 2)]), 'remote')

    const {merged, changedFromLocal} = mergeNormalizedStates(local, remote, 1, 2, noLog)
    expect(changedFromLocal).toBe(true)
    expect(merged.accounts).toHaveLength(2)
    expect(merged.accounts[0]!.name).toBe('remote-only')
    expect(merged.accounts[1]!.name).toBe('renamed')
    expect(merged.accounts[1]!.seed).toEqual(SEED_A)
    expect(merged.accounts[1]!.createTime).toBe(1)
    expect(getUnknownFields(merged.accounts[1]!)).toEqual({
      conflict: 'local',
      local: 'value',
      remote: 'value',
    })
  })

  test('merges matching account delegations by capability CID', () => {
    const delegate = new Uint8Array([0xed, 1, 2, 3])
    const local = normalizeState(
      makeState([
        account('renamed-locally', SEED_A, 3, [
          {clientId: 'client-a-local', deviceType: 'mobile', capability: {cid: CID_A, delegate}, createTime: 10},
        ]),
      ]),
      'local',
    )
    const remote = normalizeState(
      makeState([
        account('stale-remote-name', SEED_A, 3, [
          {clientId: 'client-a-remote', deviceType: 'desktop', capability: {cid: CID_A, delegate}, createTime: 20},
          {clientId: 'client-b-remote', deviceType: 'desktop', capability: {cid: CID_B, delegate}, createTime: 30},
        ]),
      ]),
      'remote',
    )

    const {merged, changedFromLocal} = mergeNormalizedStates(local, remote, 1, 2, noLog)
    expect(changedFromLocal).toBe(true)
    expect(merged.accounts).toHaveLength(1)
    expect(merged.accounts[0]!.name).toBe('renamed-locally')
    expect(merged.accounts[0]!.delegations).toHaveLength(2)
    const clients = merged.accounts[0]!.delegations.map((delegation) => delegation.clientId).sort()
    expect(clients).toEqual(['client-a-remote', 'client-b-remote'])
  })

  test('divergent key material for one principal resolves by tiebreak (newer createTime wins)', () => {
    // Unreachable via normalizeState for honest states (the principal is
    // derived from the seed), so build the normalized states by hand the way
    // Go's merge would see a corrupt/colliding entry.
    const principal = vault.accountIdFromSeed(SEED_A)
    const manual = (acct: Account): NormalizedState => ({
      notificationServerUrl: '',
      accounts: new Map([[principal, {principal, account: acct}]]),
      deletedAccounts: {},
      extra: {},
    })

    const older = account('older', SEED_B, 1)
    const newer = account('newer', SEED_C, 2)
    const {merged} = mergeNormalizedStates(manual(older), manual(newer), 1, 1, noLog)
    expect(merged.accounts).toHaveLength(1)
    expect(merged.accounts[0]!.name).toBe('newer')
  })
})

describe('normalizeState', () => {
  test('rejects non-32-byte seeds', () => {
    expect(() => normalizeState(makeState([account('short', new Uint8Array(16), 1)]), 'local')).toThrow(
      /invalid seed length/,
    )
  })

  test('dedupes in-state delegations by capability CID with tiebreak', () => {
    const delegate = new Uint8Array([1])
    const normalized = normalizeState(
      makeState([
        account('main', SEED_A, 1, [
          {clientId: 'older', capability: {cid: CID_A, delegate}, createTime: 10},
          {clientId: 'newer', capability: {cid: CID_A, delegate}, createTime: 20},
        ]),
      ]),
      'local',
    )
    const entry = normalized.accounts.get(vault.accountIdFromSeed(SEED_A))!
    expect(entry.account.delegations).toHaveLength(1)
    expect(entry.account.delegations[0]!.clientId).toBe('newer')
  })

  test('replaces invalid display names with the principal for merge purposes only', () => {
    const normalized = normalizeState(makeState([account('bad name!', SEED_A, 1)]), 'local')
    const principal = vault.accountIdFromSeed(SEED_A)
    expect(normalized.accounts.get(principal)!.account.name).toBe(principal)
  })
})

describe('statesEqual', () => {
  test('ignores account order', () => {
    const left = makeState([account('a', SEED_A, 1), account('b', SEED_B, 2)])
    const right = makeState([account('b', SEED_B, 2), account('a', SEED_A, 1)])
    expect(statesEqual(left, right)).toBe(true)
  })

  test('detects renames, tombstones, and unknown-field changes', () => {
    const base = makeState([account('a', SEED_A, 1)])
    expect(statesEqual(base, makeState([account('renamed', SEED_A, 1)]))).toBe(false)
    expect(statesEqual(base, makeState([account('a', SEED_A, 1)], {deletedAccounts: {gone: 5}}))).toBe(false)

    const withExtra = makeState([account('a', SEED_A, 1)])
    setUnknownFields(withExtra, {future: 'field'})
    expect(statesEqual(base, withExtra)).toBe(false)
  })
})

describe('merge algebra', () => {
  test('merge(x, x) is idempotent and reports no local change', () => {
    const x = makeState([account('main', SEED_A, 100), account('other', SEED_B, 200)], {
      notificationServerUrl: 'https://notify.example.com',
      deletedAccounts: {[vault.accountIdFromSeed(SEED_C)]: 300},
    })

    const {merged, changedFromLocal} = mergeStates(x, x, 1, 1, noLog)
    expect(changedFromLocal).toBe(false)
    expect(statesEqual(merged, x)).toBe(true)
  })

  test('merge is commutative for symmetric inputs (byte-identical serializeState)', async () => {
    const a = makeState([account('alpha', SEED_A, 100)])
    const b = makeState([account('beta', SEED_B, 200)])

    const ab = mergeStates(a, b, 1, 1, noLog).merged
    const ba = mergeStates(b, a, 1, 1, noLog).merged
    const abBytes = await gunzip(await vault.serializeState(ab))
    const baBytes = await gunzip(await vault.serializeState(ba))
    expect(toHex(abBytes)).toBe(toHex(baBytes))
  })

  test('unknown fields survive merge → serializeState → deserializeState', async () => {
    const localAccount = account('main', SEED_A, 1)
    setUnknownFields(localAccount, {futureAccountField: 'kept'})
    const local = makeState([localAccount])
    setUnknownFields(local, {futureStateField: 42})

    const remote = makeState([account('other', SEED_B, 2)])
    setUnknownFields(remote, {remoteStateField: 'also-kept'})

    const {merged} = mergeStates(local, remote, 1, 1, noLog)
    const restored = await vault.deserializeState(await vault.serializeState(merged))

    expect(getUnknownFields(restored)).toEqual({futureStateField: 42, remoteStateField: 'also-kept'})
    const main = restored.accounts.find((acct) => acct.name === 'main')!
    expect(getUnknownFields(main)).toEqual({futureAccountField: 'kept'})
  })
})

describe('Go-parity codec (serializeState/deserializeState)', () => {
  test('two accounts sharing a display name with distinct principals survive the round-trip', async () => {
    // Created independently on two devices: same display name, different keys.
    const deviceOne = makeState([account('shared', SEED_A, 100)])
    const deviceTwo = makeState([account('shared', SEED_B, 200)])

    const {merged} = mergeStates(deviceOne, deviceTwo, 1, 1, noLog)
    expect(merged.accounts).toHaveLength(2)

    const bytes = await vault.serializeState(merged)
    const restored = await vault.deserializeState(bytes)
    expect(restored.accounts).toHaveLength(2)
    expect(restored.accounts.map((acct) => acct.name)).toEqual(['shared', 'shared'])
    const restoredIds = restored.accounts.map((acct) => vault.accountIdFromSeed(acct.seed)).sort()
    expect(restoredIds).toEqual([vault.accountIdFromSeed(SEED_A), vault.accountIdFromSeed(SEED_B)].sort())

    // The legacy deduping codec silently drops one of them — the identity-loss
    // hazard device-role code must never hit.
    const legacyRestored = await vault.deserialize(bytes)
    expect(legacyRestored.accounts).toHaveLength(1)
  })

  test('never renames: invalid-charset names are kept as-is, only empty names are filled', async () => {
    const state = makeState([account('bad name!', SEED_A, 1), account(undefined, SEED_B, 2), account('   ', SEED_C, 3)])

    const restored = await vault.deserializeState(await vault.serializeState(state))
    expect(restored.accounts).toHaveLength(3)
    expect(restored.accounts[0]!.name).toBe('bad name!')
    expect(restored.accounts[1]!.name).toBe(vault.accountIdFromSeed(SEED_B))
    expect(restored.accounts[2]!.name).toBe(vault.accountIdFromSeed(SEED_C))
  })

  test('deserializeState rejects unknown schema versions', async () => {
    const cborg = await import('cborg')
    const encoded = cborg.encode({version: 1, accounts: []})
    await expect(vault.deserializeState(await gzip(encoded))).rejects.toThrow(/schema version mismatch/)
  })

  test('legacy serialize output is unchanged by the codec refactor (regression pin)', async () => {
    // Pinned from the pre-refactor implementation: dedupes the two 'main'
    // accounts (createTime 999 wins), fills the unnamed account's principal,
    // and REPLACES the invalid-charset name with the principal (legacy-only
    // behavior — serializeState keeps it).
    const state = makeState(
      [
        account('main', new Uint8Array(32).fill(3), 100),
        account(undefined, new Uint8Array(32).fill(9), 200),
        account('bad name!', new Uint8Array(32).fill(17), 300),
        account('main', new Uint8Array(32).fill(5), 999),
      ],
      {notificationServerUrl: 'https://notify.example.com', deletedAccounts: {zGone: 111}},
    )

    const cbor = await gunzip(await vault.serialize(state))
    expect(toHex(cbor)).toBe(
      'a46776657273696f6e02686163636f756e747383a4646e616d65646d61696e6473656564582005050505050505050505050505050505050505050505050505050505050505056a63726561746554696d651903e76b64656c65676174696f6e7380a4646e616d6578307a364d6b775644664367394c62625936786a4833455a6b38595346515a756a5635593479315a57654552397444694e336473656564582009090909090909090909090909090909090909090909090909090909090909096a63726561746554696d6518c86b64656c65676174696f6e7380a4646e616d6578307a364d6b74554c75645474417341685265675950695a363633315256337669763132716434475146387a3178423232536473656564582011111111111111111111111111111111111111111111111111111111111111116a63726561746554696d6519012c6b64656c65676174696f6e73806f64656c657465644163636f756e7473a1657a476f6e65186f756e6f74696669636174696f6e53657276657255726c781a68747470733a2f2f6e6f746966792e6578616d706c652e636f6d',
    )
  })
})
