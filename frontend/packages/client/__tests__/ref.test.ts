import {decode as cborDecode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {describe, expect, it, vi} from 'vitest'
import type {HMSigner} from '../src/hm-types'
import {createRedirectRef, createTombstoneRef, createVersionRef} from '../src/ref'

const TEST_ACCOUNT_UID = 'z6MksV3sM8YJxFqv8kV4m4wQdD4sP2wJvB8c2kHh9Qx7LmNo'
const TEST_TARGET_UID = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'
const TEST_GENESIS_CID = 'bafy2bzaceccy7cvdsvkhohx775p67c7taqzs7h6gwcu5uhcmx2pcr2r53j43u'
const TEST_VERSION_CID = 'bafy2bzacecnggwieumanlnliwvfrqazfwubzmuaiviqp7pso3hboy7vaqwz3o'

function makeSigner(): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(base58btc.decode(TEST_ACCOUNT_UID)),
    sign: vi.fn(async () => new Uint8Array(64).fill(9)),
  }
}

describe('ref generation encoding', () => {
  it('omits generation from tombstone refs when it is zero', async () => {
    const result = await createTombstoneRef(
      {
        space: TEST_ACCOUNT_UID,
        path: '/deleted-doc',
        genesis: TEST_GENESIS_CID,
        generation: 0,
      },
      makeSigner(),
    )

    const decoded = cborDecode(result.blobs[0]!.data) as Record<string, unknown>
    expect(decoded['generation']).toBeUndefined()
  })

  it('preserves non-zero generation on tombstone refs', async () => {
    const result = await createTombstoneRef(
      {
        space: TEST_ACCOUNT_UID,
        path: '/deleted-doc',
        genesis: TEST_GENESIS_CID,
        generation: 123456,
      },
      makeSigner(),
    )

    const decoded = cborDecode(result.blobs[0]!.data) as Record<string, unknown>
    expect(decoded['generation']).toBe(123456)
  })

  it('omits generation from version refs when it is zero', async () => {
    const result = await createVersionRef(
      {
        space: TEST_ACCOUNT_UID,
        path: '/forked-doc',
        genesis: TEST_GENESIS_CID,
        version: TEST_VERSION_CID,
        generation: 0,
      },
      makeSigner(),
    )

    const decoded = cborDecode(result.blobs[0]!.data) as Record<string, unknown>
    expect(decoded['generation']).toBeUndefined()
  })

  it('omits generation from redirect refs when it is zero', async () => {
    const result = await createRedirectRef(
      {
        space: TEST_ACCOUNT_UID,
        path: '/redirected-doc',
        genesis: TEST_GENESIS_CID,
        generation: 0,
        targetSpace: TEST_TARGET_UID,
        targetPath: '/target-doc',
      },
      makeSigner(),
    )

    const decoded = cborDecode(result.blobs[0]!.data) as Record<string, unknown>
    expect(decoded['generation']).toBeUndefined()
  })
})
