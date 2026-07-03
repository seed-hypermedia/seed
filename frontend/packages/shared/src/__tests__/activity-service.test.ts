import {describe, expect, it, vi} from 'vitest'
import {getFeedEventId, loadCitationEvent, loadContactEvent} from '../models/activity-service'

const TEST_CID = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'

describe('loadContactEvent', () => {
  it('resolves delegated contact events using the resource account authority', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const accountUid = 'z6MkskmgMyAn2rvUWPi86a9ikfgJLXriV7TGVmeGWGyHUhTm'
    const signerUid = 'z6MknSNtx8BhA4wKqU258VRoGPTGu57M6ABueFZWdWpZEiGt'
    const subjectUid = 'z6Mkw656UN6cWCfBYvMG6ynNus1ZyWEFgy34WzTMjB5VaDSJ'

    const event = {
      account: accountUid,
      eventTime: '2026-05-29T10:47:46.819Z',
      observeTime: null,
      newBlob: {
        cid: TEST_CID,
        blobType: 'Contact',
        author: signerUid,
        resource: `hm://${accountUid}`,
        extraAttrs: JSON.stringify({tsid: 'z6GyVaJDbfxv6c'}),
        blobId: '1',
        isPinned: false,
      },
    } as any

    const getContact = vi.fn(async () => ({
      subject: subjectUid,
      name: '',
      metadata: {
        toJson: () => ({subscribe: {site: true}}),
      },
    }))

    const grpcClient = {
      documents: {
        getContact,
      },
    } as any

    const cache = {
      getAccount: vi.fn(async (uid: string) => ({
        id: {uid},
        metadata: {name: uid},
      })),
      getDocument: vi.fn(),
      getComment: vi.fn(),
      getCommentReplyCount: vi.fn(),
      getContacts: vi.fn(async () => []),
    } as any

    try {
      const loaded = await loadContactEvent(grpcClient, event, event.account, cache)
      expect(getContact).toHaveBeenCalledWith({id: `${accountUid}/z6GyVaJDbfxv6c`})
      expect(loaded?.contact.id.uid).toBe(accountUid)
      expect(loaded?.contact.subject.id.uid).toBe(subjectUid)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('drops contact events whose resolved contact has no subject', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const event = {
      account: 'z6Mks-test-account',
      eventTime: '2026-05-29T10:47:46.819Z',
      observeTime: null,
      newBlob: {
        cid: TEST_CID,
        blobType: 'Contact',
        author: 'z6Mks-test-account',
        resource: 'hm://z6Mks-test-account',
        extraAttrs: JSON.stringify({tsid: 'z6GyVaJDbfxv6c'}),
        blobId: '1',
        isPinned: false,
      },
    } as any

    const grpcClient = {
      documents: {
        getContact: vi.fn(async () => ({
          subject: '',
          name: '',
          metadata: {
            toJson: () => ({}),
          },
        })),
      },
    } as any

    const cache = {
      getAccount: vi.fn(async (uid: string) => ({
        id: {uid},
        metadata: {name: uid},
      })),
      getDocument: vi.fn(),
      getComment: vi.fn(),
      getCommentReplyCount: vi.fn(),
      getContacts: vi.fn(async () => []),
    } as any

    try {
      const loaded = await loadContactEvent(grpcClient, event, event.account, cache)
      expect(loaded).toBeNull()
      expect(cache.getAccount).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith('Skipping contact event with missing subject', {
        cid: TEST_CID,
        contactId: 'z6Mks-test-account/z6GyVaJDbfxv6c',
        author: 'z6Mks-test-account',
      })
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('loadCitationEvent', () => {
  it('keeps comment citation events when document metadata lookups fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const event = {
      account: 'z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh',
      eventTime: null,
      observeTime: null,
      newCitation: {
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
      newCitation: {
        source: 'hm://z6Mks-test-account',
        sourceType: 'doc/Embed',
        sourceBlob: {
          cid: TEST_CID,
          author: 'z6Mks-test-account',
        },
        target: 'hm://z6Mks-target-account',
        citationType: '',
      },
    } as any

    expect(getFeedEventId(event)).toBe(`mention-${TEST_CID}--hm://z6Mks-target-account`)
    expect(getFeedEventId({...event, newCitation: {...event.newCitation, sourceBlob: {cid: 'undefined'}}})).toBeNull()
    expect(getFeedEventId({...event, newCitation: {...event.newCitation, target: ''}})).toBeNull()
  })
})
