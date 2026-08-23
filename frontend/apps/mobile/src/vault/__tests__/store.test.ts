/**
 * VaultManager unit tests against the memory SecretStore and an in-memory KV
 * storage.
 *
 * The Go-parity state codec + merge live in @seed-hypermedia/client
 * (vault-merge is built concurrently), so ../state-codec is mocked with a
 * functionally equivalent test double: the legacy client codec for
 * serialization (no duplicate display names appear in these tests) and a
 * simple principal-keyed union merge.
 */

import type {State} from '@seed-hypermedia/client/vault'

jest.mock('../state-codec', () => require('./state-codec.mock'))
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  // Mirrors the real client's unchanged semantics: version echoes knownVersion.
  getVault: jest.fn(async (_vaultUrl: string, _bearer: string, knownVersion?: number) => ({
    unchanged: true,
    version: knownVersion && knownVersion > 0 ? knownVersion : 1,
    credentials: [],
  })),
  saveVault: jest.fn(async () => {}),
  getVaultConnect: jest.fn(async () => ({found: false})),
  deleteSecretCredential: jest.fn(async () => {}),
}))

import {StorageKeys, type KVStorage} from '../../store/storage'
import {b64url, b64std, decrypt, encrypt, randomBytes} from '../crypto'
import {parseEnvelope, serializeEnvelope} from '../envelope'
import {createMemorySecretStore, storeSecret, type SecretStore} from '../secret-store'
import {VaultManager} from '../store'
import {accountIdFromSeed, deserializeState, serializeState} from '../state-codec'

function createMemoryKV(): KVStorage & {dump(): Map<string, string>} {
  const map = new Map<string, string>()
  return {
    getString: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    dump: () => map,
  }
}

async function loadManager(overrides: {storage?: KVStorage; secretStore?: SecretStore} = {}) {
  const storage = overrides.storage ?? createMemoryKV()
  const secretStore = overrides.secretStore ?? createMemorySecretStore()
  const manager = await VaultManager.load({storage, secretStore})
  return {manager, storage, secretStore}
}

afterEach(() => {
  jest.clearAllMocks()
  globalThis.localStorage?.clear()
})

describe('VaultManager (local mode)', () => {
  test('first run creates an empty local-mode vault with a decryptable envelope', async () => {
    const {manager, storage, secretStore} = await loadManager()
    try {
      expect(manager.getStatus()).toMatchObject({
        backendMode: 'local',
        connectionStatus: 'disconnected',
      })
      expect(manager.listIdentities()).toEqual([])

      const envelope = parseEnvelope(storage.getString(StorageKeys.VAULT_ENVELOPE)!)
      expect(envelope.remote).toBeNull()
      // The local KEK unwraps the DEK, which decrypts the state.
      const kekBundle = await secretStore.load('local')
      const kek = b64std.decode(kekBundle!.credentials[''])
      expect(kek).toHaveLength(32)
      const dek = await decrypt(envelope.wrappedDEK, kek)
      expect(dek).toHaveLength(64)
      const state = await deserializeState(await decrypt(envelope.encryptedData, dek))
      expect(state.accounts).toEqual([])
    } finally {
      manager.destroy()
    }
  })

  test('createIdentity persists across reloads and never bumps versions in local mode', async () => {
    const {manager, storage, secretStore} = await loadManager()
    const identity = await manager.createIdentity('phone')
    expect(identity.name).toBe('phone')
    expect(identity.accountId).toMatch(/^z/)
    manager.destroy()

    const envelope = parseEnvelope(storage.getString(StorageKeys.VAULT_ENVELOPE)!)
    expect(envelope.remote).toBeNull() // local mode is version-less

    const {manager: reloaded} = await loadManager({storage, secretStore})
    try {
      expect(reloaded.listIdentities()).toEqual([identity])
      const signer = reloaded.getSigner(identity.accountId)
      expect(typeof signer.sign).toBe('function')
      expect(() => reloaded.getSigner('z6MkunknownUnknownUnknown')).toThrow('named key not found')
    } finally {
      reloaded.destroy()
    }
  })

  test('identity names follow the Go rules', async () => {
    const {manager} = await loadManager()
    try {
      await manager.createIdentity('alice')
      await expect(manager.createIdentity('has spaces')).rejects.toThrow('Invalid name format')
      await expect(manager.createIdentity('alice')).rejects.toThrow('already exists')

      // Rename: format, uniqueness, no-op guard.
      await expect(manager.renameIdentity('alice', 'bad name!')).rejects.toThrow('Invalid new name format')
      await manager.createIdentity('bob')
      await expect(manager.renameIdentity('alice', 'bob')).rejects.toThrow('already exists')
      await expect(manager.renameIdentity('bob', 'bob')).rejects.toThrow('equals current name')
      await expect(manager.renameIdentity('nosuch', 'other')).rejects.toThrow('named key not found')

      // validateLocalKeyName: a name that decodes as a DIFFERENT principal is rejected…
      const [alice, bob] = manager.listIdentities()
      await expect(manager.renameIdentity('alice', bob.accountId)).rejects.toThrow('parses as a different public key')
      // …but renaming a key to its own principal string is allowed.
      await manager.renameIdentity('alice', alice.accountId)
      expect(manager.listIdentities().map((identity) => identity.name)).toContain(alice.accountId)
    } finally {
      manager.destroy()
    }
  })

  test('deleteIdentity removes the account and records a tombstone', async () => {
    const {manager, storage, secretStore} = await loadManager()
    const identity = await manager.createIdentity('doomed')
    const before = Date.now()
    await manager.deleteIdentity('doomed')
    expect(manager.listIdentities()).toEqual([])
    manager.destroy()

    // Tombstone is in the persisted state, keyed by principal, in unix ms.
    const envelope = parseEnvelope(storage.getString(StorageKeys.VAULT_ENVELOPE)!)
    const kek = b64std.decode((await secretStore.load('local'))!.credentials[''])
    const dek = await decrypt(envelope.wrappedDEK, kek)
    const state = await deserializeState(await decrypt(envelope.encryptedData, dek))
    expect(state.deletedAccounts?.[identity.accountId]).toBeGreaterThanOrEqual(before)

    // Re-creating the same identity clears the tombstone (Go StoreKey).
    const {manager: reloaded} = await loadManager({storage, secretStore})
    try {
      await expect(reloaded.deleteIdentity('doomed')).rejects.toThrow('named key not found')
    } finally {
      reloaded.destroy()
    }
  })

  test('forceSync throws in local mode', async () => {
    const {manager} = await loadManager()
    try {
      await expect(manager.forceSync()).rejects.toThrow('Not connected to a remote vault')
    } finally {
      manager.destroy()
    }
  })
})

describe('VaultManager (remote mode)', () => {
  const VAULT_URL = 'http://localhost:4242/vault'
  const USER_ID = 'user-1'
  const CREDENTIAL_ID = 'cred-1'

  /** Build storage + secret store representing an already-connected device. */
  async function seedConnectedVault(state: State) {
    const storage = createMemoryKV()
    const secretStore = createMemorySecretStore()
    const secret = randomBytes(32)
    const dek = randomBytes(64)
    await storeSecret(secretStore, `${VAULT_URL}|${USER_ID}`, CREDENTIAL_ID, secret)
    const wrappedDEKUrl = b64url.encode(await encrypt(dek, secret))
    storage.set(
      StorageKeys.VAULT_ENVELOPE,
      serializeEnvelope({
        encryptedData: await encrypt(await serializeState(state), dek),
        wrappedDEK: await encrypt(dek, secret),
        credentials: [{kind: 'secret', credentialId: CREDENTIAL_ID, wrappedDEK: wrappedDEKUrl}],
        remote: {
          vaultUrl: VAULT_URL,
          userId: USER_ID,
          credentialId: CREDENTIAL_ID,
          localVersion: 0,
          remoteVersion: 1,
          syncedLocalVersion: 0,
          lastSyncTime: 1_700_000_000,
          lastSyncError: '',
        },
      }),
    )
    return {storage, secretStore, secret, dek}
  }

  test('loads a connected envelope and bumps localVersion on mutation', async () => {
    const seedBytes = randomBytes(32)
    const {storage, secretStore} = await seedConnectedVault({
      version: 2,
      accounts: [{name: 'web-identity', seed: seedBytes, createTime: 1000, delegations: []}],
    })

    const {manager} = await loadManager({storage, secretStore})
    try {
      expect(manager.getStatus()).toMatchObject({
        backendMode: 'remote',
        connectionStatus: 'connected',
        remoteVaultUrl: VAULT_URL,
      })
      expect(manager.listIdentities()).toEqual([{name: 'web-identity', accountId: accountIdFromSeed(seedBytes)}])

      await manager.createIdentity('mobile-identity')
      // Mutations bump localVersion only while connected (Go applyMutation).
      expect(manager.getStatus().syncStatus?.localVersion).toBe(1)
      const envelope = parseEnvelope(storage.getString(StorageKeys.VAULT_ENVELOPE)!)
      expect(envelope.remote?.localVersion).toBe(1)
    } finally {
      manager.destroy()
    }
  })

  test('forceSync uploads when localVersion is ahead and records success metadata', async () => {
    const api = require('../api')
    const {storage, secretStore} = await seedConnectedVault({version: 2, accounts: []})
    const {manager} = await loadManager({storage, secretStore})
    try {
      api.saveVault.mockClear()
      await manager.createIdentity('mobile-identity')
      await manager.forceSync()

      // unchanged + localVersion(1) !== syncedLocalVersion(0) → upload with the
      // server's expected current version.
      expect(api.saveVault).toHaveBeenCalledTimes(1)
      const [, , request] = api.saveVault.mock.calls[0]
      expect(request.version).toBe(1)
      const status = manager.getStatus().syncStatus!
      expect(status.remoteVersion).toBe(2) // server bumped 1 → 2
      expect(status.syncedLocalVersion).toBe(1)
      expect(status.lastSyncError).toBe('')
      expect(status.lastSyncTime).toBeGreaterThan(1_700_000_000)
      // lastSyncTime is unix SECONDS, not ms.
      expect(status.lastSyncTime).toBeLessThan(Date.now() / 100)
    } finally {
      manager.destroy()
    }
  })

  test('sync failures are recorded in status and forceSync rethrows', async () => {
    const api = require('../api')
    const {storage, secretStore} = await seedConnectedVault({version: 2, accounts: []})
    const {manager} = await loadManager({storage, secretStore})
    try {
      api.getVault.mockRejectedValue(new Error('network down'))
      await expect(manager.forceSync()).rejects.toThrow('network down')
      expect(manager.getStatus().syncStatus?.lastSyncError).toContain('network down')
    } finally {
      manager.destroy()
    }
  })

  test('disconnect keeps identities and rewraps the DEK under the local KEK', async () => {
    const seedBytes = randomBytes(32)
    const {storage, secretStore, dek} = await seedConnectedVault({
      version: 2,
      accounts: [{name: 'keeper', seed: seedBytes, createTime: 1, delegations: []}],
    })
    const {manager} = await loadManager({storage, secretStore})
    try {
      await manager.disconnect({clearLocalVault: false})
      expect(manager.getStatus()).toMatchObject({backendMode: 'local', connectionStatus: 'disconnected'})
      expect(manager.listIdentities()).toHaveLength(1)

      const envelope = parseEnvelope(storage.getString(StorageKeys.VAULT_ENVELOPE)!)
      expect(envelope.remote).toBeNull()
      expect(envelope.credentials).toEqual([])
      // Same DEK, now wrapped under the freshly ensured local KEK (Go Disconnect).
      const kek = b64std.decode((await secretStore.load('local'))!.credentials[''])
      const unwrapped = await decrypt(envelope.wrappedDEK, kek)
      expect(Array.from(unwrapped)).toEqual(Array.from(dek))
      // NO tombstones from disconnecting.
      const state = await deserializeState(await decrypt(envelope.encryptedData, unwrapped))
      expect(state.deletedAccounts ?? {}).toEqual({})
    } finally {
      manager.destroy()
    }
  })

  test('disconnect with clearLocalVault empties the state without tombstones', async () => {
    const {storage, secretStore} = await seedConnectedVault({
      version: 2,
      accounts: [{name: 'gone-from-device', seed: randomBytes(32), createTime: 1, delegations: []}],
    })
    const {manager} = await loadManager({storage, secretStore})
    try {
      await manager.disconnect({clearLocalVault: true})
      expect(manager.listIdentities()).toEqual([])
      const envelope = parseEnvelope(storage.getString(StorageKeys.VAULT_ENVELOPE)!)
      const kek = b64std.decode((await secretStore.load('local'))!.credentials[''])
      const dek = await decrypt(envelope.wrappedDEK, kek)
      const state = await deserializeState(await decrypt(envelope.encryptedData, dek))
      expect(state.accounts).toEqual([])
      expect(state.deletedAccounts ?? {}).toEqual({}) // NO tombstones (Go DisconnectAndClear)
    } finally {
      manager.destroy()
    }
  })
})
