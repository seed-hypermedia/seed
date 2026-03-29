import {decode as cborDecode} from '@ipld/dag-cbor'
import {afterEach, describe, expect, test, vi} from 'vitest'
import * as blobs from './blobs'
import {defaultJoinedSiteUid, publishDefaultJoinedSite} from './publish-default-joined-site'

describe('publishDefaultJoinedSite', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('publishes a site subscription contact for the default joined site', async () => {
    const keyPair = blobs.generateNobleKeyPair()
    const accountUid = blobs.principalToString(keyPair.principal)
    const publishedInputs: Array<{blobs: Array<{cid?: string; data: Uint8Array}>}> = []

    const didPublish = await publishDefaultJoinedSite(
      {
        accountUid,
      },
      {
        getSigner: () => ({
          getPublicKey: async () => keyPair.principal,
          sign: keyPair.sign.bind(keyPair),
        }),
        publish: async (input) => {
          publishedInputs.push(input)
          return {cids: []}
        },
      },
    )
    expect(didPublish).toBe(true)

    expect(publishedInputs).toHaveLength(1)
    const contactBlob = publishedInputs[0]?.blobs[0]?.data
    expect(contactBlob).toBeDefined()
    const decoded = cborDecode(contactBlob!) as {
      type: string
      subject: Uint8Array
      account?: Uint8Array
      subscribe?: {site?: boolean}
    }

    expect(decoded.type).toBe('Contact')
    expect(blobs.principalToString(decoded.subject)).toBe(defaultJoinedSiteUid)
    expect(blobs.principalToString(decoded.account!)).toBe(accountUid)
    expect(decoded.subscribe).toEqual({site: true})
  })

  test('does not throw when publishing fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const keyPair = blobs.generateNobleKeyPair()
    const accountUid = blobs.principalToString(keyPair.principal)

    await expect(
      publishDefaultJoinedSite(
        {
          accountUid,
        },
        {
          getSigner: () => ({
            getPublicKey: async () => keyPair.principal,
            sign: keyPair.sign.bind(keyPair),
          }),
          publish: async () => {
            throw new Error('publish failed')
          },
        },
      ),
    ).resolves.toBe(false)

    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
