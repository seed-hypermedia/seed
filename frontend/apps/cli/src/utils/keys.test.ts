/**
 * Precedence tests for the vault + keyring key resolution.
 *
 * The vault and keyring backends are mocked (module mocks — this file must run
 * in its own `bun test` invocation so the mocks don't leak into other tests;
 * see the test:unit script). The real vault decoding stack is covered by
 * @seed-hypermedia/client's own tests.
 */

import {afterEach, beforeEach, describe, expect, mock, test} from 'bun:test'
import * as ed25519 from '@noble/ed25519'
import {sha512} from '@noble/hashes/sha512'
import {base58btc} from 'multiformats/bases/base58'

ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m))

type TestKey = {
  name: string
  privateKey: Uint8Array
  publicKey: Uint8Array
  publicKeyWithPrefix: Uint8Array
  accountId: string
}

function makeKey(name: string, fill: number): TestKey {
  const privateKey = new Uint8Array(32).fill(fill)
  const publicKey = new Uint8Array(ed25519.getPublicKey(privateKey))
  const publicKeyWithPrefix = new Uint8Array(2 + publicKey.length)
  publicKeyWithPrefix.set([0xed, 0x01], 0)
  publicKeyWithPrefix.set(publicKey, 2)
  return {name, privateKey, publicKey, publicKeyWithPrefix, accountId: base58btc.encode(publicKeyWithPrefix)}
}

function asVaultAccount(key: TestKey) {
  return {
    name: key.name,
    seed: key.privateKey,
    publicKey: key.publicKey,
    publicKeyWithPrefix: key.publicKeyWithPrefix,
    accountId: key.accountId,
    createTime: 1,
  }
}

// Mutable fixture state consumed by the module mocks below.
const state = {
  vaultAccounts: null as ReturnType<typeof asVaultAccount>[] | null,
  vaultError: null as Error | null,
  keyringKeys: [] as TestKey[],
  config: {} as {defaultAccount?: string; vaultPath?: string},
}

function keyringFind(nameOrId: string): TestKey | null {
  return state.keyringKeys.find((k) => k.name === nameOrId || k.accountId === nameOrId) ?? null
}

mock.module('../config', () => ({
  loadConfig: () => ({...state.config}),
}))

mock.module('./keyring', () => ({
  getKey: (nameOrId: string) => keyringFind(nameOrId),
  getDefaultKey: () => {
    if (state.config.defaultAccount) {
      const match = state.keyringKeys.find((k) => k.accountId === state.config.defaultAccount)
      if (match) return match
    }
    return state.keyringKeys.find((k) => k.name === 'main') ?? state.keyringKeys[0] ?? null
  },
  listKeys: () => state.keyringKeys.map((k) => ({name: k.name, accountId: k.accountId})),
}))

mock.module('@seed-hypermedia/client/vault-local', () => ({
  loadLocalVaultAccounts: async () => {
    if (state.vaultError) throw state.vaultError
    return state.vaultAccounts
  },
}))

const {findDefaultKey, findKey, listAllKeys, resolveSigningKey} = await import('./keys')

const OPTS = {dev: false}

const vaultMain = makeKey('main', 1)
const vaultAlice = makeKey('alice', 2)
const keyringMain = makeKey('main', 3)
const keyringBob = makeKey('bob', 4)

beforeEach(() => {
  state.vaultAccounts = null
  state.vaultError = null
  state.keyringKeys = []
  state.config = {}
})

afterEach(() => {
  delete process.env.SEED_VAULT_PATH
  delete process.env.SEED_CLI_KEYFILE
  delete process.env.SEED_CLI_MNEMONIC
})

/** An unencrypted `.hmkey.json` payload for a test key, as the app exports it. */
function keyfileJson(key: TestKey, publicKey = key.accountId): string {
  return JSON.stringify({
    createTime: '2026-01-01T00:00:00.000Z',
    publicKey,
    keyB64: Buffer.from(key.privateKey).toString('base64'),
  })
}

describe('signing key from the environment', () => {
  test('SEED_CLI_KEYFILE (an exported .hmkey.json) wins over every stored key', async () => {
    state.vaultAccounts = [asVaultAccount(vaultMain)]
    state.keyringKeys = [keyringMain]
    const envKey = makeKey('ci', 9)
    process.env.SEED_CLI_KEYFILE = keyfileJson(envKey)
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('env')
    expect(key.accountId).toBe(envKey.accountId)
    expect(key.privateKey).toEqual(envKey.privateKey)
    // --key may name the same account, or the env key itself, but nothing else.
    expect((await resolveSigningKey(envKey.accountId, OPTS)).accountId).toBe(envKey.accountId)
    expect((await resolveSigningKey('env', OPTS)).accountId).toBe(envKey.accountId)
    await expect(resolveSigningKey('main', OPTS)).rejects.toThrow('SEED_CLI_KEYFILE is set')
  })

  test('SEED_CLI_KEYFILE rejects a key file whose publicKey does not match its key', async () => {
    const envKey = makeKey('ci', 9)
    process.env.SEED_CLI_KEYFILE = keyfileJson(envKey, makeKey('other', 8).accountId)
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow('publicKey does not match')
  })

  test('SEED_CLI_KEYFILE rejects an encrypted key file with guidance', async () => {
    const envKey = makeKey('ci', 9)
    const payload = {...JSON.parse(keyfileJson(envKey)), encryption: {kdf: 'argon2id', cipher: 'xchacha20poly1305'}}
    process.env.SEED_CLI_KEYFILE = JSON.stringify(payload)
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow('export it without a password')
  })

  test('SEED_CLI_KEYFILE rejects junk', async () => {
    process.env.SEED_CLI_KEYFILE = 'not json'
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow('SEED_CLI_KEYFILE is not a usable .hmkey.json')
  })

  test('SEED_CLI_MNEMONIC still works, and both at once is an error', async () => {
    process.env.SEED_CLI_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('env')
    expect(key.accountId.startsWith('z')).toBe(true)
    process.env.SEED_CLI_KEYFILE = keyfileJson(makeKey('ci', 9))
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow('use one')
  })
})

describe('resolveSigningKey precedence', () => {
  test('vault-only: default resolves to the vault "main" account', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice), asVaultAccount(vaultMain)]
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('vault')
    expect(key.accountId).toBe(vaultMain.accountId)
  })

  test('vault-only without "main": default resolves to the first vault account', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice)]
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('vault')
    expect(key.accountId).toBe(vaultAlice.accountId)
  })

  test('keyring-only: behavior is unchanged (keyring default)', async () => {
    state.keyringKeys = [keyringBob, keyringMain]
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('keyring')
    expect(key.accountId).toBe(keyringMain.accountId)
  })

  test('"main" in vault wins over "main" in keyring', async () => {
    state.vaultAccounts = [asVaultAccount(vaultMain)]
    state.keyringKeys = [keyringMain]
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('vault')
    expect(key.accountId).toBe(vaultMain.accountId)
  })

  test('keyring "main" wins over a non-main vault account', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice)]
    state.keyringKeys = [keyringMain]
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('keyring')
    expect(key.accountId).toBe(keyringMain.accountId)
  })

  test('config defaultAccount matches a vault account first', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice)]
    state.keyringKeys = [keyringMain]
    state.config = {defaultAccount: vaultAlice.accountId}
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('vault')
    expect(key.accountId).toBe(vaultAlice.accountId)
  })

  test('config defaultAccount falls back to the keyring', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice)]
    state.keyringKeys = [keyringBob]
    state.config = {defaultAccount: keyringBob.accountId}
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('keyring')
    expect(key.accountId).toBe(keyringBob.accountId)
  })

  test('explicit --key by name prefers the vault on collisions', async () => {
    state.vaultAccounts = [asVaultAccount(vaultMain)]
    state.keyringKeys = [keyringMain]
    const key = await resolveSigningKey('main', OPTS)
    expect(key.source).toBe('vault')
    expect(key.accountId).toBe(vaultMain.accountId)
  })

  test('explicit --key by account ID finds keyring keys not in the vault', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice)]
    state.keyringKeys = [keyringBob]
    const key = await resolveSigningKey(keyringBob.accountId, OPTS)
    expect(key.source).toBe('keyring')
  })

  test('no keys anywhere: throws with guidance', async () => {
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow(/No signing keys found/)
  })
})

describe('vault load failures', () => {
  test('implicit discovery degrades to the keyring with a warning', async () => {
    state.vaultError = new Error('keychain unavailable')
    state.keyringKeys = [keyringMain]
    const key = await resolveSigningKey(undefined, OPTS)
    expect(key.source).toBe('keyring')
  })

  test('explicitly requested vault (SEED_VAULT_PATH) makes failures fatal', async () => {
    process.env.SEED_VAULT_PATH = '/some/vault.json'
    state.vaultError = new Error('keychain unavailable')
    state.keyringKeys = [keyringMain]
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow(/keychain unavailable/)
  })

  test('config vaultPath makes failures fatal', async () => {
    state.config = {vaultPath: '/some/vault.json'}
    state.vaultError = new Error('boom')
    state.keyringKeys = [keyringMain]
    await expect(resolveSigningKey(undefined, OPTS)).rejects.toThrow(/boom/)
  })
})

describe('listAllKeys', () => {
  test('merges vault and keyring entries with source labels', async () => {
    state.vaultAccounts = [asVaultAccount(vaultAlice)]
    state.keyringKeys = [keyringBob]
    const keys = await listAllKeys(OPTS)
    expect(keys).toEqual([
      {name: 'alice', accountId: vaultAlice.accountId, source: 'vault'},
      {name: 'bob', accountId: keyringBob.accountId, source: 'keyring'},
    ])
  })
})

describe('findKey / findDefaultKey', () => {
  test('findKey returns null for unknown keys', async () => {
    expect(await findKey('nope', OPTS)).toBeNull()
  })

  test('findDefaultKey returns null with no keys anywhere', async () => {
    expect(await findDefaultKey(OPTS)).toBeNull()
  })
})
