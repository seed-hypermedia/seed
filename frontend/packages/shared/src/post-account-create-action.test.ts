import {decode as cborDecode} from '@ipld/dag-cbor'
import {afterEach, describe, expect, test, vi} from 'vitest'
import * as blobs from './blobs'
import * as queryClient from './models/query-client'
import {queryKeys} from './models/query-keys'
import {defaultJoinedSiteUid, postAccountCreateAction} from './post-account-create-action'

describe('postAccountCreateAction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('publishes a site subscription contact for the default joined site', async () => {
    const keyPair = blobs.generateNobleKeyPair()
    const accountUid = blobs.principalToString(keyPair.principal)
    const publishedInputs: Array<{blobs: Array<{cid?: string; data: Uint8Array}>}> = []
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await postAccountCreateAction(
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
    expect(invalidateQueriesSpy).toHaveBeenCalledWith([queryKeys.CONTACTS_ACCOUNT, accountUid])
    expect(invalidateQueriesSpy).toHaveBeenCalledWith([queryKeys.CONTACTS_SUBJECT, defaultJoinedSiteUid])
  })

  test('does not throw when publishing fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const keyPair = blobs.generateNobleKeyPair()
    const accountUid = blobs.principalToString(keyPair.principal)

    await expect(
      postAccountCreateAction(
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
    ).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
