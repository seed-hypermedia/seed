import {describe, expect, it, vi} from 'vitest'
import {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {QueryBlock} from '../api-query-block'
import {hmId} from '../utils/entity-id-url'

vi.mock('../models/directory', () => ({
  createQueryResolver: vi.fn(),
}))

vi.mock('../api-account', () => ({
  loadAccount: vi.fn(),
}))

import {loadAccount} from '../api-account'
import {createQueryResolver} from '../models/directory'

const queryTarget = hmId('alice', {path: ['projects'], latest: true})
const docA = hmId('alice', {path: ['projects', 'a'], version: 'v1', latest: true})
const docB = hmId('alice', {path: ['projects', 'b'], version: 'v2', latest: true})

const resultA: HMDocumentInfo = {
  type: 'document',
  id: docA,
  path: ['projects', 'a'],
  authors: ['author-a'],
  createTime: {seconds: 1, nanos: 0},
  updateTime: {seconds: 1, nanos: 0},
  sortTime: new Date('2024-01-01T00:00:00Z'),
  genesis: 'genesis-a',
  version: 'v1',
  breadcrumbs: [],
  activitySummary: {
    latestCommentTime: undefined,
    latestCommentId: '',
    commentCount: 2,
    latestChangeTime: {seconds: 1, nanos: 0},
    isUnread: false,
  },
  generationInfo: {generation: 0n, genesis: 'genesis-a'},
  metadata: {name: 'Doc A'},
  visibility: 'PUBLIC',
}

const resultB: HMDocumentInfo = {
  type: 'document',
  id: docB,
  path: ['projects', 'b'],
  authors: ['author-b'],
  createTime: {seconds: 2, nanos: 0},
  updateTime: {seconds: 2, nanos: 0},
  sortTime: new Date('2024-01-02T00:00:00Z'),
  genesis: 'genesis-b',
  version: 'v2',
  breadcrumbs: [],
  activitySummary: {
    latestCommentTime: undefined,
    latestCommentId: '',
    commentCount: 0,
    latestChangeTime: {seconds: 2, nanos: 0},
    isUnread: false,
  },
  generationInfo: {generation: 0n, genesis: 'genesis-b'},
  metadata: {name: 'Doc B'},
  visibility: 'PUBLIC',
}

describe('QueryBlock.getData', () => {
  it('returns only the fields needed by query block rendering and logs perf data', async () => {
    vi.mocked(createQueryResolver).mockReturnValue(
      vi.fn().mockResolvedValue({
        in: queryTarget,
        mode: 'Children',
        results: [resultA, resultB],
      }),
    )

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const grpcClient = {
      documents: {
        getDocumentInfo: vi.fn().mockResolvedValue({
          metadata: {
            toJson: () => ({name: 'Projects'}),
          },
        }),
        batchGetAccounts: vi.fn().mockResolvedValue({
          accounts: {
            'author-a': {
              profile: {name: 'Author A', icon: 'author-a.png'},
              homeDocumentInfo: {version: 'va'},
            },
          },
          errors: {},
        }),
      },
    } as any

    const result = await QueryBlock.getData(
      grpcClient,
      {
        query: {
          includes: [{space: 'alice', path: '/projects', mode: 'Children'}],
          sort: [{term: 'UpdateTime', reverse: false}],
          limit: 1,
        },
      },
      undefined as any,
    )

    expect(result).toEqual({
      queryTargetName: 'Projects',
      in: queryTarget,
      mode: 'Children',
      results: [resultA],
      interactionSummaries: {
        [docA.id]: {
          comments: 2,
          authorUids: [],
        },
      },
      accountsMetadata: {
        'author-a': {id: hmId('author-a', {version: 'va'}), metadata: {name: 'Author A', icon: 'author-a.png'}},
      },
    })

    expect(grpcClient.documents.getDocumentInfo).toHaveBeenCalledWith({
      account: queryTarget.uid,
      path: '/projects',
    })
    expect(grpcClient.documents.batchGetAccounts).toHaveBeenCalledWith({ids: ['author-a']})
    expect(loadAccount).not.toHaveBeenCalled()
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    expect(consoleInfoSpy.mock.calls[0]?.[0]).toBe('[QueryBlock perf]')

    const perfSummary = JSON.parse(String(consoleInfoSpy.mock.calls[0]?.[1]))
    expect(perfSummary.status).toBe('success')
    expect(perfSummary.resolvedItemCount).toBe(2)
    expect(perfSummary.returnedItemCount).toBe(1)
    expect(perfSummary.visibleContributorCount).toBe(1)
    expect(perfSummary.grpcRequests.byMethod['documents.getDocumentInfo'].count).toBe(1)
    expect(perfSummary.grpcRequests.byMethod['documents.batchGetAccounts'].count).toBe(1)
    expect(perfSummary.grpcRequests.byMethod['entities.listEntityMentions']).toBeUndefined()

    consoleInfoSpy.mockRestore()
  })

  it('returns null when the underlying query resolver returns null and still logs perf data', async () => {
    vi.mocked(createQueryResolver).mockReturnValue(vi.fn().mockResolvedValue(null))

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const result = await QueryBlock.getData(
      {} as any,
      {
        query: {
          includes: [{space: 'alice', path: '/projects', mode: 'Children'}],
        },
      },
      undefined as any,
    )

    expect(result).toBeNull()
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)

    const perfSummary = JSON.parse(String(consoleInfoSpy.mock.calls[0]?.[1]))
    expect(perfSummary.status).toBe('empty')
    expect(perfSummary.returnedItemCount).toBe(0)
    expect(perfSummary.grpcRequests.totalCount).toBe(0)

    consoleInfoSpy.mockRestore()
  })
})
