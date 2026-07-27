import {describe, expect, test} from 'vitest'
import './base64'
import * as encryption from './encryption'
import * as vault from './vault'

const SEED_A = new Uint8Array(32).fill(3)
const SEED_B = new Uint8Array(32).fill(9)

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data)
  writer.close()
  const chunks: Uint8Array[] = []
  const reader = cs.readable.getReader()
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

async function buildEnvelopeJSON(state: vault.State, dek: Uint8Array, kek: Uint8Array): Promise<string> {
  const encryptedData = await encryption.encrypt(await vault.serialize(state), dek)
  const wrappedDEK = await encryption.encrypt(dek, kek)
  return JSON.stringify({
    encryptedData: encryptedData.toBase64({alphabet: 'base64'}),
    wrappedDEK: wrappedDEK.toBase64({alphabet: 'base64'}),
  })
}

describe('vault state codec', () => {
  test('serialize/deserialize round-trip', async () => {
    const state = vault.createEmpty()
    state.accounts.push({name: 'main', seed: SEED_A, createTime: 123, delegations: []})
    state.accounts.push({seed: SEED_B, createTime: 456, delegations: []})

    const restored = await vault.deserialize(await vault.serialize(state))
    expect(restored.version).toBe(vault.VAULT_VERSION)
    expect(restored.accounts).toHaveLength(2)
    expect(restored.accounts[0]!.name).toBe('main')
    expect(restored.accounts[0]!.seed).toEqual(SEED_A)
    expect(restored.accounts[0]!.createTime).toBe(123)
    // Unnamed accounts get their principal string as the name.
    expect(restored.accounts[1]!.name).toBe(vault.accountIdFromSeed(SEED_B))
  })

  test('deserialize rejects unknown schema versions', async () => {
    const cborg = await import('cborg')
    const encoded = cborg.encode({version: 1, accounts: []})
    await expect(vault.deserialize(await gzip(encoded))).rejects.toThrow(/schema version mismatch/)
  })

  test('accountIdFromSeed produces a base58btc principal', () => {
    const accountId = vault.accountIdFromSeed(SEED_A)
    expect(accountId.startsWith('z')).toBe(true)
    expect(accountId.length).toBeGreaterThan(40)
  })
})

describe('vault.json envelope', () => {
  test('parse + unwrap + decrypt round-trip', async () => {
    const state = vault.createEmpty()
    state.accounts.push({name: 'main', seed: SEED_A, createTime: 1, delegations: []})
    const dek = new Uint8Array(32).fill(5)
    const kek = new Uint8Array(32).fill(7)

    const envelope = vault.parseVaultEnvelope(await buildEnvelopeJSON(state, dek, kek))
    expect(envelope.remote).toBeNull()
    expect(envelope.credentials).toEqual([])

    const unwrapped = await vault.unwrapDEK(envelope, kek)
    expect(unwrapped).toEqual(dek)

    const restored = await vault.decryptVaultState(envelope, unwrapped)
    expect(restored.accounts).toHaveLength(1)
    expect(restored.accounts[0]!.name).toBe('main')
    expect(restored.accounts[0]!.seed).toEqual(SEED_A)
  })

  test('64-byte DEKs (web-vault generated) also decrypt', async () => {
    const state = vault.createEmpty()
    const dek = new Uint8Array(64).fill(11)
    const kek = new Uint8Array(32).fill(7)

    const envelope = vault.parseVaultEnvelope(await buildEnvelopeJSON(state, dek, kek))
    const unwrapped = await vault.unwrapDEK(envelope, kek)
    expect(unwrapped).toEqual(dek)
    await expect(vault.decryptVaultState(envelope, unwrapped)).resolves.toBeTruthy()
  })

  test('unwrapDEK fails with a clear error on the wrong secret', async () => {
    const dek = new Uint8Array(32).fill(5)
    const envelope = vault.parseVaultEnvelope(
      await buildEnvelopeJSON(vault.createEmpty(), dek, new Uint8Array(32).fill(7)),
    )
    await expect(vault.unwrapDEK(envelope, new Uint8Array(32).fill(8))).rejects.toThrow(/wrong vault secret/)
  })

  test('parseVaultEnvelope validates required fields', () => {
    expect(() => vault.parseVaultEnvelope('not json')).toThrow(/not valid JSON/)
    expect(() => vault.parseVaultEnvelope('{}')).toThrow(/encrypted data must not be empty/)
    expect(() => vault.parseVaultEnvelope(JSON.stringify({encryptedData: 'AAAA'}))).toThrow(
      /wrapped DEK must not be empty/,
    )
    expect(() =>
      vault.parseVaultEnvelope(JSON.stringify({encryptedData: 'AAAA', wrappedDEK: 'AAAA', remote: {vaultUrl: ''}})),
    ).toThrow(/Remote vault URL is required/)
  })

  test('parseVaultEnvelope decodes credentials and remote state', () => {
    const envelope = vault.parseVaultEnvelope(
      JSON.stringify({
        encryptedData: 'AAAA',
        wrappedDEK: 'AAAA',
        credentials: [
          {
            kind: 'password',
            credentialId: 'cred-1',
            wrappedDEK: new Uint8Array([1, 2, 3]).toBase64({alphabet: 'base64url', omitPadding: true}),
          },
        ],
        remote: {vaultUrl: 'https://vault.example.com', userId: 'user-1', credentialId: 'cred-2'},
      }),
    )
    expect(envelope.credentials).toHaveLength(1)
    expect(envelope.credentials[0]!.kind).toBe('password')
    expect(envelope.credentials[0]!.wrappedDEK).toEqual(new Uint8Array([1, 2, 3]))
    expect(envelope.remote).toEqual({vaultUrl: 'https://vault.example.com', userId: 'user-1', credentialId: 'cred-2'})
  })
})
