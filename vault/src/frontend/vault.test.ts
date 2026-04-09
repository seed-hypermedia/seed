import * as blobs from '@shm/shared/blobs'
import {describe, expect, test} from 'bun:test'
import * as vault from './vault'

async function makeAccount(name: string): Promise<vault.Account> {
  const kp = blobs.generateNobleKeyPair()
  const p = await blobs.createProfile(kp, {name}, Date.now())
  return {
    seed: kp.seed,
    createTime: Date.now(),
    delegations: [],
  }
}

describe('vault-data', () => {
  test('empty vault round-trip', async () => {
    const v = vault.createEmpty()
    const compressed = await vault.serialize(v)
    const restored = await vault.deserialize(compressed)

    expect(restored.version).toBe(vault.VAULT_VERSION)
    expect(restored.accounts).toEqual([])
  })

  test('vault with one account round-trip', async () => {
    const v: vault.State = {
      version: 2,
      notificationServerUrl: 'https://notify.example.com',
      accounts: [await makeAccount('Alice')],
    }

    const compressed = await vault.serialize(v)
    const restored = await vault.deserialize(compressed)

    expect(restored.version).toBe(vault.VAULT_VERSION)
    expect(restored.notificationServerUrl).toBe('https://notify.example.com')
    expect(restored.accounts).toHaveLength(1)
    expect(restored.accounts[0]!.createTime).toBe(v.accounts[0]!.createTime)
    expect(new Uint8Array(restored.accounts[0]!.seed)).toEqual(new Uint8Array(v.accounts[0]!.seed))
    expect(restored.accounts.length).toBe(1)
  })

  test('vault with multiple accounts round-trip', async () => {
    const v: vault.State = {
      version: 2,
      accounts: await Promise.all([makeAccount('Alice'), makeAccount('Bob'), makeAccount('Carol')]),
    }

    const compressed = await vault.serialize(v)
    const restored = await vault.deserialize(compressed)

    expect(restored.accounts).toHaveLength(3)
    for (let i = 0; i < v.accounts.length; i++) {
      expect(new Uint8Array(restored.accounts[i]!.seed)).toEqual(new Uint8Array(v.accounts[i]!.seed))
      expect(restored.accounts[i]!.createTime).toBe(v.accounts[i]!.createTime)
    }
  })

  test('seed survives round-trip', async () => {
    const account = await makeAccount('Test')
    const v: vault.State = {version: 2, accounts: [account]}

    const compressed = await vault.serialize(v)
    const restored = await vault.deserialize(compressed)

    expect(new Uint8Array(restored.accounts[0]!.seed)).toEqual(new Uint8Array(account.seed))
  })

  test('deserialize refuses incompatible schema version', async () => {
    // Manually craft a version-1 vault.
    const badState = {version: 1, accounts: []}
    const {serialize} = await import('./vault')
    // Temporarily lie about the version to get past the serialize type check.
    const compressed = await serialize(badState as unknown as vault.State)
    await expect(vault.deserialize(compressed)).rejects.toThrow('schema version mismatch')
  })
})
