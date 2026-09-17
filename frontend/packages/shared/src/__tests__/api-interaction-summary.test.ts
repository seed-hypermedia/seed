import {describe, expect, it, vi} from 'vitest'
import {ConnectError, Code} from '@connectrpc/connect'
import {InteractionSummary} from '../api-interaction-summary'
import {hmId} from '../utils/entity-id-url'

const targetDocId = hmId('z6MkTestAccount', {path: ['test-doc']})

function makeGrpcClient({
  getDocument = vi.fn().mockResolvedValue({version: 'v1'}),
  getDocumentInfo = vi.fn().mockResolvedValue({activitySummary: {childrenCount: 0}}),
  listDocumentChanges = vi.fn().mockResolvedValue({changes: []}),
  listCitations = vi.fn().mockResolvedValue({citations: []}),
} = {}) {
  return {
    documents: {getDocument, getDocumentInfo, listDocumentChanges},
    resources: {listCitations},
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

  it('returns empty summary when listCitations fails with deleted doc', async () => {
    const grpcClient = makeGrpcClient({
      listCitations: vi
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

describe('InteractionSummary.getData on a republished address', () => {
  const republishId = hmId('z6MkSiteAccount', {path: ['pro', 'paper']})
  const targetId = hmId('z6MkOriginalAccount', {path: ['2026', 'paper']})

  function citation(source: string, targetFragment: string) {
    return {
      source,
      sourceType: 'Ref',
      targetFragment,
      targetVersion: '',
      isExactVersion: false,
      sourceBlob: {author: source.slice('hm://'.length, 'hm://'.length + 8), createTime: undefined},
    }
  }

  function redirectError(republish: boolean) {
    return new ConnectError(
      `document '${republishId.id}' has a redirect to ${targetId.id} (republish = ${republish})`,
      Code.FailedPrecondition,
    )
  }

  it('follows a republish to its target and counts the links to both addresses once each', async () => {
    const getDocument = vi
      .fn()
      .mockImplementation(({account}: {account: string}) =>
        account === republishId.uid ? Promise.reject(redirectError(true)) : Promise.resolve({version: 'v-target'}),
      )
    const listCitations = vi.fn().mockImplementation(({iri}: {iri: string}) =>
      Promise.resolve({
        citations:
          iri === republishId.id
            ? [citation('hm://z6MkReaderOne/notes', 'b1')]
            : [citation('hm://z6MkReaderTwo/essay', 'b1'), citation('hm://z6MkReaderOne/notes', 'b1')],
      }),
    )
    const listDocumentChanges = vi.fn().mockResolvedValue({changes: [{}, {}, {}]})
    const getDocumentInfo = vi.fn().mockResolvedValue({activitySummary: {childrenCount: 4}})
    const grpcClient = makeGrpcClient({getDocument, listCitations, listDocumentChanges, getDocumentInfo})

    const result = await InteractionSummary.getData(grpcClient, {id: republishId}, dummyQueryDaemon)

    expect(result.citations).toBe(2)
    expect(result.blocks).toEqual({b1: {citations: 2, comments: 0}})
    expect(result.changes).toBe(3)
    expect(result.children).toBe(4)
    expect(listCitations).toHaveBeenCalledTimes(2)
    expect(listDocumentChanges).toHaveBeenCalledWith(
      expect.objectContaining({account: targetId.uid, path: '/2026/paper', version: 'v-target'}),
    )
  })

  it('returns an empty summary for a moved address instead of following it', async () => {
    const grpcClient = makeGrpcClient({
      getDocument: vi.fn().mockRejectedValue(redirectError(false)),
      listCitations: vi.fn().mockResolvedValue({citations: [citation('hm://z6MkReaderOne/notes', 'b1')]}),
    })

    const result = await InteractionSummary.getData(grpcClient, {id: republishId}, dummyQueryDaemon)
    expect(result).toEqual(emptySummary)
  })
})
