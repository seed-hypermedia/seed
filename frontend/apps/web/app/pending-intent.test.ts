import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  clearPendingIntentMock: vi.fn(),
  commentRecordIdFromBlobMock: vi.fn(),
  createCommentMock: vi.fn(),
  createContactMock: vi.fn(),
  updateContactMock: vi.fn(),
  getCurrentAccountUidWithDelegationMock: vi.fn(),
  getCurrentSignerMock: vi.fn(),
  getPendingIntentMock: vi.fn(),
  getStoredLocalKeysMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  publishMock: vi.fn(),
  requestMock: vi.fn(),
  routeToUrlMock: vi.fn(),
}))

vi.mock('@seed-hypermedia/client', () => ({
  commentRecordIdFromBlob: mocks.commentRecordIdFromBlobMock,
  createComment: mocks.createCommentMock,
  createContact: mocks.createContactMock,
  updateContact: mocks.updateContactMock,
}))

vi.mock('@shm/shared', () => ({
  queryKeys: {
    ACTIVITY_FEED: 'ACTIVITY_FEED',
    BLOCK_DISCUSSIONS: 'BLOCK_DISCUSSIONS',
    CONTACTS_ACCOUNT: 'CONTACTS_ACCOUNT',
    CONTACTS_SUBJECT: 'CONTACTS_SUBJECT',
    DOC_CITATIONS: 'DOC_CITATIONS',
    DOCUMENT_ACTIVITY: 'DOCUMENT_ACTIVITY',
    DOCUMENT_COMMENTS: 'DOCUMENT_COMMENTS',
    DOCUMENT_DISCUSSION: 'DOCUMENT_DISCUSSION',
    DOCUMENT_INTERACTION_SUMMARY: 'DOCUMENT_INTERACTION_SUMMARY',
  },
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: mocks.invalidateQueriesMock,
}))

vi.mock('@shm/shared/utils/entity-id-url', () => ({
  routeToUrl: mocks.routeToUrlMock,
}))

vi.mock('./auth', () => ({
  getCurrentAccountUidWithDelegation: mocks.getCurrentAccountUidWithDelegationMock,
  getCurrentSigner: mocks.getCurrentSignerMock,
}))

vi.mock('./local-db', () => ({
  clearPendingIntent: mocks.clearPendingIntentMock,
  getPendingIntent: mocks.getPendingIntentMock,
  getStoredLocalKeys: mocks.getStoredLocalKeysMock,
}))

vi.mock('./universal-client', () => ({
  webUniversalClient: {
    publish: mocks.publishMock,
    request: mocks.requestMock,
  },
}))

import {getSiteMembershipStatus, processPendingIntent} from './pending-intent'

const docId = {
  id: 'hm://doc-1',
  uid: 'doc-1',
  path: [],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: null,
}

describe('pending-intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        removeItem: vi.fn(),
      },
    })

    mocks.getCurrentSignerMock.mockResolvedValue({sign: vi.fn()})
    mocks.getCurrentAccountUidWithDelegationMock.mockResolvedValue('account-1')
    mocks.getStoredLocalKeysMock.mockResolvedValue({
      keyPair: {
        privateKey: {} as CryptoKey,
        publicKey: {} as CryptoKey,
      },
    })
    mocks.requestMock.mockResolvedValue([])
    mocks.commentRecordIdFromBlobMock.mockResolvedValue('comment-record-id')
    mocks.publishMock.mockResolvedValue({ok: true})
    mocks.routeToUrlMock.mockReturnValue('/hm/doc-1?comment=comment-record-id')
  })

  it('reuses in-flight comment processing so the comment is only created once', async () => {
    mocks.getPendingIntentMock.mockResolvedValue({
      type: 'comment',
      docId,
      docVersion: 'v1',
      content: [],
    })

    let releaseCreateComment: (() => void) | null = null
    mocks.createCommentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreateComment = () =>
            resolve({
              blobs: [{data: new Uint8Array([1, 2, 3])}],
            })
        }),
    )

    const firstRun = processPendingIntent()
    const secondRun = processPendingIntent()

    await vi.waitFor(() => {
      expect(mocks.getPendingIntentMock).toHaveBeenCalledTimes(1)
      expect(mocks.createCommentMock).toHaveBeenCalledTimes(1)
    })

    releaseCreateComment!()

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun])

    expect(firstResult).toEqual({type: 'comment', commentUrl: '/hm/doc-1?comment=comment-record-id'})
    expect(secondResult).toEqual({type: 'comment', commentUrl: '/hm/doc-1?comment=comment-record-id'})
    expect(mocks.createCommentMock).toHaveBeenCalledTimes(1)
    expect(mocks.publishMock).toHaveBeenCalledTimes(2)
    expect(mocks.clearPendingIntentMock).toHaveBeenCalledTimes(1)
  })

  it('returns joined when a join intent creates the site membership', async () => {
    mocks.getPendingIntentMock.mockResolvedValue({type: 'join', subjectUid: 'site-1'})

    await expect(processPendingIntent()).resolves.toEqual({type: 'join', joinStatus: 'joined'})
    expect(mocks.createContactMock).toHaveBeenCalledWith(
      {
        subjectUid: 'site-1',
        accountUid: 'account-1',
        subscribe: {site: true},
      },
      expect.any(Object),
    )
  })

  it('returns already-joined when a join intent targets an existing site membership', async () => {
    mocks.getPendingIntentMock.mockResolvedValue({type: 'join', subjectUid: 'site-1'})
    mocks.requestMock.mockResolvedValue([{id: 'contact-1', subject: 'site-1', subscribe: {site: true}}])

    await expect(processPendingIntent()).resolves.toEqual({type: 'join', joinStatus: 'already-joined'})
    expect(mocks.createContactMock).not.toHaveBeenCalled()
    expect(mocks.updateContactMock).not.toHaveBeenCalled()
  })

  it('returns own-site when a join intent targets the site account itself', async () => {
    mocks.getPendingIntentMock.mockResolvedValue({type: 'join', subjectUid: 'account-1'})

    await expect(processPendingIntent()).resolves.toEqual({type: 'join', joinStatus: 'own-site'})
    expect(mocks.requestMock).not.toHaveBeenCalled()
  })

  it('reports site membership status for non-members, members, and the site account', async () => {
    mocks.requestMock.mockResolvedValueOnce([])
    await expect(getSiteMembershipStatus('site-1')).resolves.toBe('not-member')

    mocks.requestMock.mockResolvedValueOnce([{id: 'contact-1', subject: 'site-1', subscribe: {site: true}}])
    await expect(getSiteMembershipStatus('site-1')).resolves.toBe('already-joined')

    await expect(getSiteMembershipStatus('account-1')).resolves.toBe('own-site')
  })
})
