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
  unpackHmIdMock: vi.fn(),
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
  unpackHmId: mocks.unpackHmIdMock,
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

import {processPendingIntent} from './pending-intent'

describe('processPendingIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        removeItem: vi.fn(),
      },
    })

    mocks.getCurrentSignerMock.mockResolvedValue({sign: vi.fn()})
    mocks.getStoredLocalKeysMock.mockResolvedValue({
      keyPair: {
        privateKey: {} as CryptoKey,
        publicKey: {} as CryptoKey,
      },
    })
    mocks.getPendingIntentMock.mockResolvedValue({
      type: 'comment',
      content: '[]',
      docId: JSON.stringify({id: 'hm://doc-1', uid: 'doc-1'}),
      docVersion: 'v1',
    })
    mocks.commentRecordIdFromBlobMock.mockResolvedValue('comment-record-id')
    mocks.publishMock.mockResolvedValue({ok: true})
    mocks.routeToUrlMock.mockReturnValue('/hm/doc-1?comment=comment-record-id')
    mocks.unpackHmIdMock.mockReturnValue(undefined)
  })

  it('reuses in-flight comment processing so the comment is only created once', async () => {
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

    expect(firstResult).toBe('/hm/doc-1?comment=comment-record-id')
    expect(secondResult).toBe('/hm/doc-1?comment=comment-record-id')
    expect(mocks.createCommentMock).toHaveBeenCalledTimes(1)
    expect(mocks.publishMock).toHaveBeenCalledTimes(1)
    expect(mocks.clearPendingIntentMock).toHaveBeenCalledTimes(1)
  })
})
