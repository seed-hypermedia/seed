import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import './base64'
import * as encryption from './encryption'
import {readOSSecret} from './os-keychain'
import * as vault from './vault'
import {
  loadLocalVaultAccounts,
  readVaultWrappingKey,
  resolveVaultPath,
  VaultFileNotFoundError,
  VaultSecretMissingError,
  wellKnownVaultPaths,
} from './vault-local'

vi.mock('./os-keychain', async (importOriginal) => {
  const original = await importOriginal<typeof import('./os-keychain')>()
  return {...original, readOSSecret: vi.fn(() => null)}
})

const mockedReadOSSecret = vi.mocked(readOSSecret)

const KEK = new Uint8Array(32).fill(7)
const DEK = new Uint8Array(32).fill(5)
const SEED = new Uint8Array(32).fill(3)

function b64(data: Uint8Array): string {
  return data.toBase64({alphabet: 'base64'})
}

async function writeVaultFixture(dir: string, extraEnvelope: Record<string, unknown> = {}): Promise<string> {
  const state = vault.createEmpty()
  state.accounts.push({name: 'main', seed: SEED, createTime: 1, delegations: []})
  const encryptedData = await encryption.encrypt(await vault.serialize(state), DEK)
  const wrappedDEK = await encryption.encrypt(DEK, KEK)
  const path = join(dir, 'vault.json')
  writeFileSync(path, JSON.stringify({encryptedData: b64(encryptedData), wrappedDEK: b64(wrappedDEK), ...extraEnvelope}))
  return path
}

function localEnvelope(): vault.VaultEnvelope {
  return {encryptedData: new Uint8Array(1), wrappedDEK: new Uint8Array(1), credentials: [], remote: null}
}

function remoteEnvelope(): vault.VaultEnvelope {
  return {
    encryptedData: new Uint8Array(1),
    wrappedDEK: new Uint8Array(1),
    credentials: [],
    remote: {vaultUrl: 'https://vault.example.com', userId: 'user-1', credentialId: 'cred-1'},
  }
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'vault-local-test-'))
  mockedReadOSSecret.mockReset()
  mockedReadOSSecret.mockReturnValue(null)
})

afterEach(() => {
  rmSync(tempDir, {recursive: true, force: true})
  vi.unstubAllEnvs()
})

describe('resolveVaultPath', () => {
  test('explicit path wins and is marked explicit', () => {
    vi.stubEnv('SEED_VAULT_PATH', '/elsewhere/vault.json')
    expect(resolveVaultPath({path: '/some/vault.json'})).toEqual({path: '/some/vault.json', explicit: true})
  })

  test('SEED_VAULT_PATH is used when no explicit path is given', () => {
    vi.stubEnv('SEED_VAULT_PATH', '/env/vault.json')
    expect(resolveVaultPath({})).toEqual({path: '/env/vault.json', explicit: true})
  })

  test('falls back to the first existing well-known location', async () => {
    vi.stubEnv('SEED_VAULT_PATH', '')
    vi.stubEnv('XDG_CONFIG_HOME', tempDir)
    const desktopDir = join(tempDir, 'Seed', 'daemon')
    mkdirSync(desktopDir, {recursive: true})
    const fixture = await writeVaultFixture(desktopDir)
    expect(resolveVaultPath({})).toEqual({path: fixture, explicit: false})
  })

  test('returns null when nothing exists', () => {
    vi.stubEnv('SEED_VAULT_PATH', '')
    vi.stubEnv('XDG_CONFIG_HOME', join(tempDir, 'empty'))
    vi.stubEnv('HOME', join(tempDir, 'empty'))
    expect(resolveVaultPath({})).toBeNull()
  })

  test('well-known paths differ between dev and prod', () => {
    const prod = wellKnownVaultPaths(false)
    const dev = wellKnownVaultPaths(true)
    expect(prod.some((p) => p.includes('Seed') && !p.includes('Seed-dev'))).toBe(true)
    expect(prod.some((p) => p.includes('.mtt'))).toBe(true)
    expect(dev.some((p) => p.includes('Seed-dev'))).toBe(true)
  })
})

describe('readVaultWrappingKey', () => {
  test('SEED_VAULT_KEK bypasses the keychain', () => {
    vi.stubEnv('SEED_VAULT_KEK', b64(KEK))
    expect(readVaultWrappingKey(localEnvelope())).toEqual(KEK)
    expect(mockedReadOSSecret).not.toHaveBeenCalled()
  })

  test('rejects a malformed SEED_VAULT_KEK', () => {
    vi.stubEnv('SEED_VAULT_KEK', 'too-short')
    expect(() => readVaultWrappingKey(localEnvelope())).toThrow(/SEED_VAULT_KEK/)
  })

  test('reads the local KEK from the v2 credential bundle', () => {
    mockedReadOSSecret.mockImplementation((service, account) =>
      service === 'seed-hypermedia-vault-secret-v2' && account === 'local'
        ? JSON.stringify({credentials: {'': b64(KEK)}})
        : null,
    )
    expect(readVaultWrappingKey(localEnvelope())).toEqual(KEK)
  })

  test('accepts a raw base64 legacy value inside the v2 record', () => {
    mockedReadOSSecret.mockImplementation((service, account) =>
      service === 'seed-hypermedia-vault-secret-v2' && account === 'local' ? b64(KEK) : null,
    )
    expect(readVaultWrappingKey(localEnvelope())).toEqual(KEK)
  })

  test('accepts a go-keyring-base64: wrapped bundle', () => {
    const bundle = JSON.stringify({credentials: {'': b64(KEK)}})
    const wrapped = `go-keyring-base64:${Buffer.from(bundle).toString('base64')}`
    mockedReadOSSecret.mockImplementation((service, account) =>
      service === 'seed-hypermedia-vault-secret-v2' && account === 'local' ? wrapped : null,
    )
    expect(readVaultWrappingKey(localEnvelope())).toEqual(KEK)
  })

  test('falls back to the legacy v1 service record', () => {
    mockedReadOSSecret.mockImplementation((service, account) =>
      service === 'seed-hypermedia-vault-secret' && account === 'local' ? b64(KEK) : null,
    )
    expect(readVaultWrappingKey(localEnvelope())).toEqual(KEK)
  })

  test('remote envelopes read the "<url>|<userId>" account by credential ID', () => {
    mockedReadOSSecret.mockImplementation((service, account) =>
      service === 'seed-hypermedia-vault-secret-v2' && account === 'https://vault.example.com|user-1'
        ? JSON.stringify({credentials: {'cred-1': b64(KEK)}})
        : null,
    )
    expect(readVaultWrappingKey(remoteEnvelope())).toEqual(KEK)
  })

  test('throws VaultSecretMissingError when no record exists', () => {
    expect(() => readVaultWrappingKey(localEnvelope())).toThrow(VaultSecretMissingError)
  })

  test('throws when the credential ID is missing from the bundle', () => {
    mockedReadOSSecret.mockImplementation((service) =>
      service === 'seed-hypermedia-vault-secret-v2' ? JSON.stringify({credentials: {other: b64(KEK)}}) : null,
    )
    expect(() => readVaultWrappingKey(remoteEnvelope())).toThrow(VaultSecretMissingError)
  })
})

describe('loadLocalVaultAccounts', () => {
  test('full unlock via SEED_VAULT_PATH + SEED_VAULT_KEK', async () => {
    const path = await writeVaultFixture(tempDir)
    vi.stubEnv('SEED_VAULT_PATH', path)
    vi.stubEnv('SEED_VAULT_KEK', b64(KEK))

    const accounts = await loadLocalVaultAccounts({})
    expect(accounts).not.toBeNull()
    expect(accounts).toHaveLength(1)
    expect(accounts![0]!.name).toBe('main')
    expect(accounts![0]!.seed).toEqual(SEED)
    expect(accounts![0]!.accountId).toBe(vault.accountIdFromSeed(SEED))
    expect(accounts![0]!.publicKeyWithPrefix.subarray(0, 2)).toEqual(new Uint8Array([0xed, 0x01]))
  })

  test('explicit missing path throws VaultFileNotFoundError', async () => {
    await expect(loadLocalVaultAccounts({path: join(tempDir, 'nope.json')})).rejects.toThrow(VaultFileNotFoundError)
  })

  test('returns null when no vault exists anywhere', async () => {
    vi.stubEnv('SEED_VAULT_PATH', '')
    vi.stubEnv('XDG_CONFIG_HOME', join(tempDir, 'empty'))
    vi.stubEnv('HOME', join(tempDir, 'empty'))
    await expect(loadLocalVaultAccounts({})).resolves.toBeNull()
  })

  test('wrong KEK yields a wrong-secret error', async () => {
    const path = await writeVaultFixture(tempDir)
    vi.stubEnv('SEED_VAULT_PATH', path)
    vi.stubEnv('SEED_VAULT_KEK', b64(new Uint8Array(32).fill(8)))
    await expect(loadLocalVaultAccounts({})).rejects.toThrow(/wrong vault secret/)
  })
})
