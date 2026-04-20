import {describe, expect, it, vi} from 'vitest'
import {getFeedEventId, loadCitationEvent} from '../models/activity-service'

const TEST_CID = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'

describe('loadCitationEvent', () => {
  it('keeps comment citation events when document metadata lookups fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const event = {
      account: 'z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh',
      eventTime: null,
      observeTime: null,
      newMention: {
        source: 'hm://z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh/z6FUAnpExKUZwX',
        sourceType: 'comment/Embed',
        sourceBlob: {
          cid: 'bafy2bzacedexveqjcytw4trm6a4lxgxyssrg3ubxyro6rp5o4lo545qcl3imw',
          author: 'z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh',
        },
        sourceDocument: 'hm://z6Mkj6fUDHMAvGm1MRqtjrBH5vLX5gQnDYh2f74NRFfccbVt',
        target: 'hm://z6Mkj6fUDHMAvGm1MRqtjrBH5vLX5gQnDYh2f74NRFfccbVt',
      },
    } as any

    const cache = {
      getAccount: vi.fn(async (uid: string) => ({
        id: {uid},
        metadata: {name: uid},
      })),
      getDocument: vi.fn(async () => {
        throw new Error('document unavailable')
      }),
      getComment: vi.fn(async () => {
        throw new Error('comment unavailable')
      }),
      getCommentReplyCount: vi.fn(async () => 0),
      getContacts: vi.fn(async () => []),
    } as any

    try {
      const loaded = await loadCitationEvent({} as any, event, event.account, cache)
      expect(loaded).not.toBeNull()
      expect(loaded?.type).toBe('citation')
      expect(loaded?.citationType).toBe('c')
      expect(loaded?.source.id.uid).toBe('z6Mkj6fUDHMAvGm1MRqtjrBH5vLX5gQnDYh2f74NRFfccbVt')
      expect(loaded?.target.id.uid).toBe('z6Mkj6fUDHMAvGm1MRqtjrBH5vLX5gQnDYh2f74NRFfccbVt')
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('getFeedEventId', () => {
  it('does not synthesize blob IDs from missing or invalid CIDs', () => {
    expect(
      getFeedEventId({
        account: 'z6Mks-test-account',
        eventTime: null,
        observeTime: null,
        newBlob: {
          cid: TEST_CID,
          blobType: 'Comment',
          author: 'z6Mks-test-account',
          resource: 'hm://z6Mks-test-account/comment',
          extraAttrs: '',
          blobId: '1',
          isPinned: false,
        },
      }),
    ).toBe(`blob-${TEST_CID}`)

    expect(
      getFeedEventId({
        account: 'z6Mks-test-account',
        eventTime: null,
        observeTime: null,
        newBlob: {
          cid: 'undefined',
          blobType: 'Comment',
          author: 'z6Mks-test-account',
          resource: 'hm://z6Mks-test-account/comment',
          extraAttrs: '',
          blobId: '1',
          isPinned: false,
        },
      }),
    ).toBeNull()
  })

  it('does not synthesize mention IDs without source CID or target', () => {
    const event = {
      account: 'z6Mks-test-account',
      eventTime: null,
      observeTime: null,
      newMention: {
        source: 'hm://z6Mks-test-account',
        sourceType: 'doc/Embed',
        sourceBlob: {
          cid: TEST_CID,
          author: 'z6Mks-test-account',
        },
        target: 'hm://z6Mks-target-account',
        mentionType: '',
      },
    } as any

    expect(getFeedEventId(event)).toBe(`mention-${TEST_CID}--hm://z6Mks-target-account`)
    expect(getFeedEventId({...event, newMention: {...event.newMention, sourceBlob: {cid: 'undefined'}}})).toBeNull()
    expect(getFeedEventId({...event, newMention: {...event.newMention, target: ''}})).toBeNull()
  })
})
