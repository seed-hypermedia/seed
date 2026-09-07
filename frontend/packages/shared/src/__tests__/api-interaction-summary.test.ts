import {describe, expect, it, vi} from 'vitest'
import {ConnectError, Code} from '@connectrpc/connect'
import {InteractionSummary} from '../api-interaction-summary'
import {hmId} from '../utils/entity-id-url'

const targetDocId = hmId('z6MkTestAccount', {path: ['test-doc']})

function makeGrpcClient({
  getDocument = vi.fn().mockResolvedValue({version: 'v1'}),
  getDocumentInfo = vi.fn().mockResolvedValue({activitySummary: {childrenCount: 0}}),
  listDocumentChanges = vi.fn().mockResolvedValue({changes: []}),
  getInteractionSummary = vi.fn().mockResolvedValue({citationCount: 0, commentCount: 0, blocks: [], authorUids: []}),
} = {}) {
  return {
    documents: {getDocument, getDocumentInfo, listDocumentChanges},
    resources: {getInteractionSummary},
  } as any
}

const dummyQueryDaemon = (() => Promise.resolve(null)) as any

const emptySummary = {
  citations: 0,
  comments: 0,
  changes: 0,
  children: 0,
  authorUids: [],
  blocks: {},
}

describe('InteractionSummary.getData', () => {
  it('uses the daemon aggregate counts', async () => {
    const grpcClient = makeGrpcClient({
      getInteractionSummary: vi.fn().mockResolvedValue({
        citationCount: 4321,
        commentCount: 7,
        authorUids: ['z6MkAuthor'],
        blocks: [
          {targetFragment: 'block-a', citationCount: 2, commentCount: 1},
          {targetFragment: 'block-a[4:8]', citationCount: 1, commentCount: 2},
        ],
      }),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toMatchObject({
      citations: 4321,
      comments: 7,
      authorUids: ['z6MkAuthor'],
      blocks: {'block-a': {citations: 3, comments: 3}},
    })
  })

  it('returns empty summary when document is marked as deleted', async () => {
    const grpcClient = makeGrpcClient({
      getDocument: vi
        .fn()
        .mockRejectedValue(
          new ConnectError(
            "rpc error: code = FailedPrecondition desc = document 'hm://z6Mk.../test-doc' is marked as deleted",
            Code.FailedPrecondition,
          ),
        ),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })

  it('returns empty summary when document is not found', async () => {
    const grpcClient = makeGrpcClient({
      getDocument: vi.fn().mockRejectedValue(new ConnectError('not found', Code.NotFound)),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })

  it('rethrows unexpected errors', async () => {
    const grpcClient = makeGrpcClient({
      getDocument: vi.fn().mockRejectedValue(new ConnectError('internal server error', Code.Internal)),
    })

    await expect(InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)).rejects.toThrow()
  })

  it('returns empty summary when getInteractionSummary fails with deleted doc', async () => {
    const grpcClient = makeGrpcClient({
      getInteractionSummary: vi
        .fn()
        .mockRejectedValue(
          new ConnectError("document 'hm://z6Mk.../test-doc' is marked as deleted", Code.FailedPrecondition),
        ),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })

  it('returns empty summary when getDocumentInfo fails with not found', async () => {
    const grpcClient = makeGrpcClient({
      getDocumentInfo: vi.fn().mockRejectedValue(new ConnectError('not found', Code.NotFound)),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })
})
