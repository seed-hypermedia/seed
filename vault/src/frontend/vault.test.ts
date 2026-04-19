import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {describe, expect, test} from 'bun:test'
import {CID} from 'multiformats/cid'
import * as vault from './vault'

interface VaultCompatibilityFixture {
  name: string
  state: {
    version: 2
    accounts: Array<{
      name?: string
      seedHex: string
      createTime: number
      delegations: Array<{
        clientId: string
        deviceType?: 'desktop' | 'mobile' | 'tablet'
        capability: {
          cid: string
          delegatePrincipal: string
        }
        createTime: number
      }>
    }>
  }
  javascriptPayloadBase64: string
  goPayloadBase64: string
}

async function makeAccount(name: string): Promise<vault.Account> {
  const kp = blobs.generateNobleKeyPair()
  await blobs.createProfile(kp, {name}, Date.now())
  return {
    name,
    seed: kp.seed,
    createTime: Date.now(),
    delegations: [],
  }
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
}

function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
}

async function gzipEncodeRaw(data: Record<string, unknown>): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(new Uint8Array(cbor.encode(data)) as any)
  writer.close()
  return collectStream(cs.readable)
}

async function gzipDecodeRaw(data: Uint8Array): Promise<Record<string, unknown>> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data as any)
  writer.close()
  return cbor.decode(await collectStream(ds.readable)) as Record<string, unknown>
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const {done, value} = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function normalizeFixtureState(fixture: VaultCompatibilityFixture): vault.State {
  return {
    version: vault.VAULT_VERSION,
    accounts: fixture.state.accounts.map((account) => {
      const seed = hexToBytes(account.seedHex)
      const principal = blobs.principalToString(blobs.nobleKeyPairFromSeed(seed).principal)
      return {
        ...(account.name ? {name: account.name} : {name: principal}),
        seed,
        createTime: account.createTime,
        delegations: account.delegations.map((delegation) => ({
          clientId: delegation.clientId,
          ...(delegation.deviceType ? {deviceType: delegation.deviceType} : {}),
          capability: {
            cid: CID.parse(delegation.capability.cid),
            delegate: blobs.principalFromString(delegation.capability.delegatePrincipal),
          },
          createTime: delegation.createTime,
        })),
      }
    }),
  }
}

function expectVaultState(actual: vault.State, expected: vault.State) {
  expect(actual.version).toBe(expected.version)
  expect(actual.accounts).toHaveLength(expected.accounts.length)
  actual.accounts.forEach((account, accountIndex) => {
    const expectedAccount = expected.accounts[accountIndex]!
    expect(account.name).toBe(expectedAccount.name)
    expect(new Uint8Array(account.seed)).toEqual(new Uint8Array(expectedAccount.seed))
    expect(account.createTime).toBe(expectedAccount.createTime)
    expect(account.delegations).toHaveLength(expectedAccount.delegations.length)
    account.delegations.forEach((delegation, delegationIndex) => {
      const expectedDelegation = expectedAccount.delegations[delegationIndex]!
      expect(delegation.clientId).toBe(expectedDelegation.clientId)
      expect(delegation.deviceType).toBe(expectedDelegation.deviceType)
      expect(delegation.capability.cid.toString()).toBe(expectedDelegation.capability.cid.toString())
      expect(new Uint8Array(delegation.capability.delegate)).toEqual(
        new Uint8Array(expectedDelegation.capability.delegate),
      )
      expect(delegation.createTime).toBe(expectedDelegation.createTime)
    })
  })
}

const compatibilityFixtures = JSON.parse(
  await Bun.file(new URL('../../../testdata/vault-compatibility-fixtures.json', import.meta.url)).text(),
) as VaultCompatibilityFixture[]

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
    expect(restored.accounts[0]!.name).toBe(v.accounts[0]!.name)
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
      expect(restored.accounts[i]!.name).toBe(v.accounts[i]!.name)
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
    const compressed = await gzipEncodeRaw({version: 1, accounts: []})
    await expect(vault.deserialize(compressed)).rejects.toThrow('schema version mismatch')
  })

  test('deserialize backfills missing account names with principal', async () => {
    const kp = blobs.generateNobleKeyPair()
    const legacyState: vault.State = {
      version: vault.VAULT_VERSION,
      accounts: [
        {
          seed: kp.seed,
          createTime: Date.now(),
          delegations: [],
        },
      ],
    }

    const compressed = await vault.serialize(legacyState)
    const restored = await vault.deserialize(compressed)

    expect(restored.accounts).toHaveLength(1)
    expect(restored.accounts[0]!.name).toBe(blobs.principalToString(kp.principal))
  })

  test('serialize backfills missing account names with principal', async () => {
    const kp = blobs.generateNobleKeyPair()
    const legacyState: vault.State = {
      version: vault.VAULT_VERSION,
      accounts: [
        {
          seed: kp.seed,
          createTime: Date.now(),
          delegations: [],
        },
      ],
    }

    const compressed = await vault.serialize(legacyState)
    const raw = await gzipDecodeRaw(compressed)
    const account = (raw.accounts as Array<Record<string, unknown>>)[0]!

    expect(account.name).toBe(blobs.principalToString(kp.principal))
  })

  test('serialize deduplicates accounts by canonical name', async () => {
    const older = blobs.generateNobleKeyPair()
    const newer = blobs.generateNobleKeyPair()
    const state: vault.State = {
      version: vault.VAULT_VERSION,
      accounts: [
        {
          name: 'shared',
          seed: older.seed,
          createTime: 1,
          delegations: [],
        },
        {
          name: 'shared',
          seed: newer.seed,
          createTime: 2,
          delegations: [],
        },
      ],
    }

    const restored = await vault.deserialize(await vault.serialize(state))

    expect(restored.accounts).toHaveLength(1)
    expect(restored.accounts[0]!.name).toBe('shared')
    expect(new Uint8Array(restored.accounts[0]!.seed)).toEqual(new Uint8Array(newer.seed))
  })

  test('unknown fields survive deserialize and serialize', async () => {
    const account = await makeAccount('Extra')
    const delegate = blobs.generateNobleKeyPair()
    const compressed = await gzipEncodeRaw({
      version: vault.VAULT_VERSION,
      notificationServerUrl: 'https://notify.example.com',
      unknownTopLevel: 'top',
      deletedAccounts: {z6Mkhstub: 123},
      accounts: [
        {
          name: account.name,
          seed: account.seed,
          createTime: account.createTime,
          unknownAccountField: 'account',
          delegations: [
            {
              clientId: 'https://example.com',
              createTime: 456,
              unknownDelegationField: 'delegation',
              capability: {
                cid: CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'),
                delegate: delegate.principal,
                unknownCapabilityField: 'capability',
              },
            },
          ],
        },
      ],
    })

    const restored = await vault.deserialize(compressed)
    const reencoded = await vault.serialize(restored)
    const roundTripRaw = await gzipDecodeRaw(reencoded)

    expect(restored.notificationServerUrl).toBe('https://notify.example.com')
    expect(restored.deletedAccounts).toEqual({z6Mkhstub: 123})
    expect(roundTripRaw.unknownTopLevel).toBe('top')
    const roundTrippedAccount = (roundTripRaw.accounts as Array<Record<string, unknown>>)[0]!
    expect(roundTrippedAccount.unknownAccountField).toBe('account')
    const roundTrippedDelegation = (roundTrippedAccount.delegations as Array<Record<string, unknown>>)[0]!
    expect(roundTrippedDelegation.unknownDelegationField).toBe('delegation')
    const roundTrippedCapability = roundTrippedDelegation.capability as Record<string, unknown>
    expect(roundTrippedCapability.unknownCapabilityField).toBe('capability')
  })
})

describe('vault-data compatibility fixtures', () => {
  for (const fixture of compatibilityFixtures) {
    test(`decodes Go payload for ${fixture.name}`, async () => {
      const expected = normalizeFixtureState(fixture)
      const restored = await vault.deserialize(decodeBase64(fixture.goPayloadBase64))

      expectVaultState(restored, expected)

      const reencoded = await vault.serialize(restored)
      const roundTripped = await vault.deserialize(reencoded)
      expectVaultState(roundTripped, expected)
    })

    test(`decodes JavaScript payload for ${fixture.name}`, async () => {
      const expected = normalizeFixtureState(fixture)
      const restored = await vault.deserialize(decodeBase64(fixture.javascriptPayloadBase64))

      expectVaultState(restored, expected)
    })

    test(`re-encodes the same logical state for ${fixture.name}`, async () => {
      const expected = normalizeFixtureState(fixture)
      const encoded = await vault.serialize(expected)
      const restored = await vault.deserialize(encoded)

      expectVaultState(restored, expected)
      expect(encodeBase64(encoded)).not.toHaveLength(0)
    })
  }
})
