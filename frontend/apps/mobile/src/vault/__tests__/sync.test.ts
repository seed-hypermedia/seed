/**
 * runRemoteSync unit tests — the Go syncRemote port: knownVersion fetch,
 * merge-in without version bumps, semantic upload decisions, and the
 * ≤3-attempt 409 retry loop.
 */

import type {State} from '@seed-hypermedia/client/vault'

jest.mock('../state-codec', () => require('./state-codec.mock'))
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getVault: jest.fn(),
  saveVault: jest.fn(async () => {}),
}))

import {VaultWriteConflictError} from '../api'
import {b64url, decrypt, encrypt, randomBytes} from '../crypto'
import {deserializeState, serializeState} from '../state-codec'
import {runRemoteSync, type RemoteSyncContext, type RemoteSyncHost, type SyncSuccess} from '../sync'

const api = require('../api')

const VAULT_URL = 'http://localhost:4242/vault'

type HostState = {
  state: State
  localVersion: number
  merged: State[]
  successes: SyncSuccess[]
}

function makeHost(ctx: RemoteSyncContext | null, initialState: State, localVersion: number) {
  const host: HostState = {state: initialState, localVersion, merged: [], successes: []}
  const syncHost: RemoteSyncHost = {
    loadSyncContext: async () => ctx,
    getLocalSnapshot: () => ({state: host.state, localVersion: host.localVersion}),
    applyMergedState: async (state) => {
      host.state = state
      host.merged.push(state)
    },
    recordSyncSuccess: async (success) => {
      host.successes.push(success)
    },
    log: () => {},
  }
  return {host, syncHost}
}

async function makeCrypto() {
  const secret = randomBytes(32)
  const dek = randomBytes(64)
  const wrappedDEK = b64url.encode(await encrypt(dek, secret))
  return {secret, dek, wrappedDEK}
}

function makeContext(crypto: {secret: Uint8Array; wrappedDEK: string}, versions: Partial<RemoteSyncContext> = {}) {
  return {
    vaultUrl: VAULT_URL,
    userId: 'user-1',
    credentialId: 'cred-1',
    secret: crypto.secret,
    wrappedDEK: crypto.wrappedDEK,
    localVersion: 0,
    remoteVersion: 1,
    syncedLocalVersion: 0,
    ...versions,
  } satisfies RemoteSyncContext
}

const emptyState: State = {version: 2, accounts: []}

function stateWith(...names: string[]): State {
  return {
    version: 2,
    accounts: names.map((name, index) => ({
      name,
      seed: randomBytes(32),
      createTime: 1000 + index,
      delegations: [],
    })),
  }
}

async function encryptedSnapshot(state: State, dek: Uint8Array, version: number, crypto: {wrappedDEK: string}) {
  return {
    encryptedData: b64url.encode(await encrypt(await serializeState(state), dek)),
    version,
    credentials: [{kind: 'secret', credentialId: 'cred-1', wrappedDEK: crypto.wrappedDEK}],
    unchanged: false,
  }
}

afterEach(() => jest.clearAllMocks())

describe('runRemoteSync', () => {
  test('no-op when not connected', async () => {
    const {syncHost, host} = makeHost(null, emptyState, 0)
    await runRemoteSync(syncHost)
    expect(api.getVault).not.toHaveBeenCalled()
    expect(host.successes).toHaveLength(0)
  })

  test('unchanged + versions in sync → no upload, success recorded', async () => {
    const crypto = await makeCrypto()
    api.getVault.mockResolvedValue({unchanged: true, version: 3, credentials: []})
    const {syncHost, host} = makeHost(
      makeContext(crypto, {remoteVersion: 3, localVersion: 2, syncedLocalVersion: 2}),
      emptyState,
      2,
    )

    await runRemoteSync(syncHost)

    expect(api.getVault).toHaveBeenCalledWith(VAULT_URL, expect.stringMatching(/^cred-1:/), 3)
    expect(api.saveVault).not.toHaveBeenCalled()
    expect(host.successes).toHaveLength(1)
    expect(host.successes[0]).toMatchObject({remoteVersion: 3, syncedLocalVersion: 2})
    expect(host.successes[0].lastSyncTime).toBeLessThan(Date.now() / 100) // seconds, not ms
  })

  test('unchanged + local ahead → uploads with the expected current version', async () => {
    const crypto = await makeCrypto()
    api.getVault.mockResolvedValue({unchanged: true, version: 5, credentials: []})
    const local = stateWith('mobile-identity')
    const {syncHost, host} = makeHost(
      makeContext(crypto, {remoteVersion: 5, localVersion: 4, syncedLocalVersion: 3}),
      local,
      4,
    )

    await runRemoteSync(syncHost)

    expect(api.saveVault).toHaveBeenCalledTimes(1)
    const [, , request] = api.saveVault.mock.calls[0]
    expect(request.version).toBe(5) // expected CURRENT version; server bumps
    // The upload is decryptable with the DEK and contains the local state.
    const uploaded = await deserializeState(await decrypt(b64url.decode(request.encryptedData), crypto.dek))
    expect(uploaded.accounts.map((account) => account.name)).toEqual(['mobile-identity'])
    expect(host.successes[0]).toMatchObject({remoteVersion: 6, syncedLocalVersion: 4})
  })

  test('changed remote merges in without an upload when local has nothing new', async () => {
    const crypto = await makeCrypto()
    const remoteState = stateWith('web-identity')
    api.getVault.mockResolvedValue(await encryptedSnapshot(remoteState, crypto.dek, 2, crypto))
    const {syncHost, host} = makeHost(makeContext(crypto, {remoteVersion: 1}), emptyState, 0)

    await runRemoteSync(syncHost)

    // Remote identity landed locally via applyMergedState (no version bump).
    expect(host.merged).toHaveLength(1)
    expect(host.state.accounts.map((account) => account.name)).toEqual(['web-identity'])
    // Post-merge local == remote → no upload (semantic comparison).
    expect(api.saveVault).not.toHaveBeenCalled()
    expect(host.successes[0]).toMatchObject({remoteVersion: 2, syncedLocalVersion: 0})
  })

  test('changed remote + local extras → merge in AND upload the union', async () => {
    const crypto = await makeCrypto()
    const remoteState = stateWith('web-identity')
    api.getVault.mockResolvedValue(await encryptedSnapshot(remoteState, crypto.dek, 2, crypto))
    const local = stateWith('mobile-identity')
    const {syncHost, host} = makeHost(makeContext(crypto, {remoteVersion: 1, localVersion: 1}), local, 1)

    await runRemoteSync(syncHost)

    expect(host.state.accounts.map((account) => account.name).sort()).toEqual(['mobile-identity', 'web-identity'])
    expect(api.saveVault).toHaveBeenCalledTimes(1)
    const [, , request] = api.saveVault.mock.calls[0]
    expect(request.version).toBe(2)
    const uploaded = await deserializeState(await decrypt(b64url.decode(request.encryptedData), crypto.dek))
    expect(uploaded.accounts.map((account) => account.name).sort()).toEqual(['mobile-identity', 'web-identity'])
    expect(host.successes[0]).toMatchObject({remoteVersion: 3, syncedLocalVersion: 1})
  })

  test('409 conflict → refetch and retry, succeeding within 3 attempts', async () => {
    const crypto = await makeCrypto()
    const local = stateWith('mobile-identity')
    api.getVault
      .mockResolvedValueOnce({unchanged: true, version: 5, credentials: []})
      .mockResolvedValueOnce(await encryptedSnapshot(stateWith('web-identity'), crypto.dek, 6, crypto))
    api.saveVault.mockRejectedValueOnce(new VaultWriteConflictError()).mockResolvedValueOnce(undefined)
    const {syncHost, host} = makeHost(
      makeContext(crypto, {remoteVersion: 5, localVersion: 2, syncedLocalVersion: 1}),
      local,
      2,
    )

    await runRemoteSync(syncHost)

    expect(api.getVault).toHaveBeenCalledTimes(2)
    expect(api.saveVault).toHaveBeenCalledTimes(2)
    // Second attempt used the refetched version.
    expect(api.saveVault.mock.calls[1][2].version).toBe(6)
    expect(host.successes[0]).toMatchObject({remoteVersion: 7})
  })

  test('three consecutive conflicts fail the pass', async () => {
    const crypto = await makeCrypto()
    api.getVault.mockResolvedValue({unchanged: true, version: 5, credentials: []})
    api.saveVault.mockRejectedValue(new VaultWriteConflictError())
    const {syncHost} = makeHost(
      makeContext(crypto, {remoteVersion: 5, localVersion: 2, syncedLocalVersion: 1}),
      stateWith('mobile-identity'),
      2,
    )

    await expect(runRemoteSync(syncHost)).rejects.toThrow()
    expect(api.saveVault).toHaveBeenCalledTimes(3)
  })

  test('non-conflict save errors propagate immediately', async () => {
    const crypto = await makeCrypto()
    api.getVault.mockResolvedValue({unchanged: true, version: 5, credentials: []})
    api.saveVault.mockRejectedValue(new Error('boom'))
    const {syncHost} = makeHost(
      makeContext(crypto, {remoteVersion: 5, localVersion: 2, syncedLocalVersion: 1}),
      stateWith('mobile-identity'),
      2,
    )

    await expect(runRemoteSync(syncHost)).rejects.toThrow('boom')
    expect(api.saveVault).toHaveBeenCalledTimes(1)
  })
})
