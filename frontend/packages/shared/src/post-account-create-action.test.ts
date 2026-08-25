import {decode as cborDecode} from '@ipld/dag-cbor'
import {afterEach, describe, expect, test, vi} from 'vitest'
import * as blobs from './blobs'
import * as queryClient from './models/query-client'
import {queryKeys} from './models/query-keys'
import {defaultJoinedSpaceUid, postAccountCreateAction} from './post-account-create-action'

describe('postAccountCreateAction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('publishes a space subscription contact for the default joined space', async () => {
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
    expect(blobs.principalToString(decoded.subject)).toBe(defaultJoinedSpaceUid)
    expect(blobs.principalToString(decoded.account!)).toBe(accountUid)
    expect(decoded.subscribe).toEqual({site: true})
    expect(invalidateQueriesSpy).toHaveBeenCalledWith([queryKeys.CONTACTS_ACCOUNT, accountUid])
    expect(invalidateQueriesSpy).toHaveBeenCalledWith([queryKeys.CONTACTS_SUBJECT, defaultJoinedSpaceUid])
  })

  test('does not invalidate contact queries when the publish step fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const keyPair = blobs.generateNobleKeyPair()
    const accountUid = blobs.principalToString(keyPair.principal)
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

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

    expect(invalidateQueriesSpy).not.toHaveBeenCalled()
  })
})
