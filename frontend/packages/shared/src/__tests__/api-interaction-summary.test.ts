import {describe, expect, it, vi} from 'vitest'
import {ConnectError, Code} from '@connectrpc/connect'
import {InteractionSummary} from '../api-interaction-summary'
import {hmId} from '../utils/entity-id-url'

const targetDocId = hmId('z6MkTestAccount', {path: ['test-doc']})

function makeGrpcClient({
  getDocument = vi.fn().mockResolvedValue({version: 'v1'}),
  listDirectory = vi.fn().mockResolvedValue({documents: []}),
  listDocumentChanges = vi.fn().mockResolvedValue({changes: []}),
  listEntityMentions = vi.fn().mockResolvedValue({mentions: []}),
} = {}) {
  return {
    documents: {getDocument, listDirectory, listDocumentChanges},
    entities: {listEntityMentions},
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

  it('returns empty summary when listEntityMentions fails with deleted doc', async () => {
    const grpcClient = makeGrpcClient({
      listEntityMentions: vi
        .fn()
        .mockRejectedValue(
          new ConnectError("document 'hm://z6Mk.../test-doc' is marked as deleted", Code.FailedPrecondition),
        ),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })

  it('returns empty summary when listDirectory fails with not found', async () => {
    const grpcClient = makeGrpcClient({
      listDirectory: vi.fn().mockRejectedValue(new ConnectError('not found', Code.NotFound)),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: targetDocId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })
})
