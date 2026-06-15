import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {describe, expect, it, vi} from 'vitest'
import {signDocumentChange} from '../src/change'
import type {HMSigner} from '../src/hm-types'

const TEST_ACCOUNT_UID = 'z6MksV3sM8YJxFqv8kV4m4wQdD4sP2wJvB8c2kHh9Qx7LmNo'

function makeSigner(): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(base58btc.decode(TEST_ACCOUNT_UID)),
    sign: vi.fn(async () => new Uint8Array(64).fill(7)),
  }
}

describe('signDocumentChange', () => {
  it('uses the prepared change timestamp for first-publish ref generation and timestamp', async () => {
    const preparedChangeTs = 123456
    const unsignedChange = cborEncode({
      type: 'Change',
      body: {
        ops: [],
        opCount: 0,
      },
      signer: null,
      ts: preparedChangeTs,
      sig: null,
    })

    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(999999)
    try {
      const {changeCid, publishInput} = await signDocumentChange(
        {
          account: TEST_ACCOUNT_UID,
          path: '/new-doc',
          unsignedChange,
        },
        makeSigner(),
      )

      const ref = cborDecode(publishInput.blobs[1]!.data) as Record<string, unknown>
      expect(ref['generation']).toBe(preparedChangeTs)
      expect(ref['ts']).toBe(preparedChangeTs)
      expect(String(ref['genesisBlob'])).toBe(changeCid.toString())
    } finally {
      dateNowSpy.mockRestore()
    }
  })
})
