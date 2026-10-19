import {QueryClient} from '@tanstack/react-query'
import {getQueryClient, queryClient, registerQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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
}))

vi.mock('@seed-hypermedia/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seed-hypermedia/client')>()),
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

vi.mock('@shm/shared/models/query-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/query-client')>()),
  invalidateQueries: mocks.invalidateQueriesMock,
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
  afterEach(() => {
    getQueryClient().clear()
    registerQueryClient(queryClient)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    registerQueryClient(new QueryClient())

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
    mocks.publishMock.mockResolvedValue({cids: ['published-version']})
    mocks.createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1, 2, 3])}]})
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

    expect(firstResult).toMatchObject({
      type: 'comment',
      commentUrl: '/hm/doc-1/:comments',
      comment: {id: 'comment-record-id', version: 'published-version'},
    })
    expect(secondResult).toEqual(firstResult)
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

  it('checks membership for an explicit account before the session keys are stored', async () => {
    // The auth callback runs this alongside the delegation publish, before the
    // local keys exist, so it must not depend on the stored account.
    mocks.getCurrentAccountUidWithDelegationMock.mockResolvedValue(null)
    await expect(getSiteMembershipStatus('account-2', 'account-2')).resolves.toBe('own-site')
  })
  it.each([
    [{key: 'comments', id: docId}, '/hm/doc-1/:comments'],
    [{key: 'document', id: docId, panel: {key: 'comments', id: docId}}, '/hm/doc-1?panel=comments'],
    [
      {key: 'comments', id: docId, openComment: 'root', replyCommentId: 'parent'},
      '/hm/doc-1/:comments/root?reply=comment-record-id',
    ],
    [
      {key: 'document', id: docId, panel: {key: 'comments', id: docId, openComment: 'root', replyCommentId: 'parent'}},
      '/hm/doc-1?panel=comments/root&reply=comment-record-id',
    ],
  ])('restores the submitted discussion location', async (commentRoute, commentUrl) => {
    mocks.getPendingIntentMock.mockResolvedValue({type: 'comment', docId, docVersion: 'v1', content: [], commentRoute})
    await expect(processPendingIntent()).resolves.toMatchObject({
      type: 'comment',
      commentUrl,
      comment: {version: 'published-version'},
    })
  })

  it('keeps the intent and draft when comment publication fails', async () => {
    mocks.getPendingIntentMock.mockResolvedValue({
      type: 'comment',
      docId,
      docVersion: 'v1',
      content: [],
      replyCommentId: 'parent',
    })
    mocks.requestMock.mockResolvedValue([{id: 'contact', subject: docId.uid, subscribe: {site: true}}])
    mocks.publishMock.mockRejectedValueOnce(new Error('offline'))
    await expect(processPendingIntent()).resolves.toEqual({type: 'none'})
    expect(mocks.clearPendingIntentMock).not.toHaveBeenCalled()
    expect(localStorage.removeItem).not.toHaveBeenCalled()
  })
  it('inserts the published comment into the registered web cache', async () => {
    mocks.getPendingIntentMock.mockResolvedValue({type: 'comment', docId, docVersion: 'v1', content: []})
    await processPendingIntent()
    expect(getQueryClient().getQueryData([queryKeys.DOCUMENT_COMMENTS, docId])).toMatchObject({
      comments: [{id: 'comment-record-id', version: 'published-version'}],
    })
  })
})
