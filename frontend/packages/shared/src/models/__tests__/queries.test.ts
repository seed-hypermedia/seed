import {describe, expect, test, vi} from 'vitest'
import {hmId} from '../../utils/entity-id-url'
import {queryKeys} from '../query-keys'
import {
  queryBlockDiscussions,
  queryCommentReplyCount,
  queryCommentVersions,
  queryDocumentComments,
  queryDocumentDiscussions,
  queryDomain,
  queryQueryBlock,
  queryResource,
} from '../queries'

function createMockClient(handler: (key: string, input: any) => any) {
  return {
    request: vi.fn(handler),
  } as any
}

const docA = hmId('uid1', {path: ['old-name']})
const docB = hmId('uid1', {path: ['new-name']})
const docC = hmId('uid1', {path: ['newest-name']})

const documentResponse = (id: ReturnType<typeof hmId>) => ({
  type: 'document' as const,
  id,
  document: {
    version: 'v1',
    account: 'uid1',
    path: '',
    authors: [],
    content: [],
    metadata: {},
    genesis: 'genesis1',
    visibility: 'PUBLIC',
    createTime: '',
    updateTime: '',
  },
})

const redirectResponse = (
  from: ReturnType<typeof hmId>,
  to: ReturnType<typeof hmId>,
  options?: {republish?: boolean},
) => ({
  type: 'redirect' as const,
  id: from,
  redirectTarget: to,
  republish: options?.republish ?? false,
})

const notFoundResponse = (id: ReturnType<typeof hmId>) => ({
  type: 'not-found' as const,
  id,
})

const tombstoneResponse = (id: ReturnType<typeof hmId>) => ({
  type: 'tombstone' as const,
  id,
})

describe('queryResource', () => {
  test('returns document directly when no redirect', async () => {
    const client = createMockClient(() => documentResponse(docA))
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'document', id: docA})
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  test('follows a single redirect and returns resolved document', async () => {
    const client = createMockClient((_key, input) => {
      if (input.id === docA.id) return redirectResponse(docA, docB)
      if (input.id === docB.id) return documentResponse(docB)
      throw new Error(`Unexpected request: ${input.id}`)
    })
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'document', id: docB})
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  test('follows chained redirects (A→B→C)', async () => {
    const client = createMockClient((_key, input) => {
      if (input.id === docA.id) return redirectResponse(docA, docB)
      if (input.id === docB.id) return redirectResponse(docB, docC)
      if (input.id === docC.id) return documentResponse(docC)
      throw new Error(`Unexpected request: ${input.id}`)
    })
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'document', id: docC})
    expect(client.request).toHaveBeenCalledTimes(3)
  })

  test('republish redirects render target content without changing the requested id', async () => {
    const client = createMockClient((_key, input) => {
      if (input.id === docA.id) return redirectResponse(docA, docB, {republish: true})
      if (input.id === docB.id) return documentResponse(docB)
      throw new Error(`Unexpected request: ${input.id}`)
    })
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'document', id: docA})
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  test('republish redirects opened from web urls resolve to the target route', async () => {
    const webDocA = hmId('uid1', {path: ['old-name'], hostname: 'https://site.example'})
    const webDocB = hmId('uid1', {path: ['new-name'], hostname: 'https://site.example'})
    const client = createMockClient((_key, input) => {
      if (input.id === webDocA.id) return redirectResponse(webDocA, docB, {republish: true})
      if (input.id === docB.id) return documentResponse(webDocB)
      throw new Error(`Unexpected request: ${input.id}`)
    })
    const query = queryResource(client, webDocA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'document', id: webDocB})
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  test('handles redirect to not-found', async () => {
    const client = createMockClient((_key, input) => {
      if (input.id === docA.id) return redirectResponse(docA, docB)
      if (input.id === docB.id) return notFoundResponse(docB)
      throw new Error(`Unexpected request: ${input.id}`)
    })
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'not-found', id: docB})
  })

  test('handles redirect to tombstone', async () => {
    const client = createMockClient((_key, input) => {
      if (input.id === docA.id) return redirectResponse(docA, docB)
      if (input.id === docB.id) return tombstoneResponse(docB)
      throw new Error(`Unexpected request: ${input.id}`)
    })
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'tombstone', id: docB})
  })

  test('returns an error after redirect max depth instead of leaking a redirect resource', async () => {
    const ids = Array.from({length: 7}, (_, i) => hmId('uid1', {path: [`doc-${i}`]}))
    const client = createMockClient((_key, input) => {
      const idx = ids.findIndex((id) => id.id === input.id)
      if (idx >= 0 && idx < ids.length - 1) {
        return redirectResponse(ids[idx]!, ids[idx + 1]!)
      }
      return documentResponse(ids[idx]!)
    })

    const result = await queryResource(client, ids[0]!).queryFn!()

    expect(result).toMatchObject({
      type: 'error',
      id: ids[0],
      message: 'Too many redirects while resolving resource',
    })
    expect(client.request).toHaveBeenCalledTimes(6)
  })

  test('does not copy source version onto redirect target', async () => {
    const versionedDocA = hmId('uid1', {path: ['old-name'], version: 'v123'})
    const client = createMockClient((_key, input) => {
      if (input.id === versionedDocA.id) return redirectResponse(versionedDocA, docB)
      if (input.id === docB.id) return documentResponse(docB)
      throw new Error(`Unexpected request: ${input.id}`)
    })

    const result = await queryResource(client, versionedDocA).queryFn!()

    expect(result).toMatchObject({type: 'document', id: docB})
    expect(result?.id.version).toBeNull()
    expect(client.request).toHaveBeenNthCalledWith(2, 'Resource', docB, {signal: undefined})
  })

  test('returns null for null id', async () => {
    const client = createMockClient(() => {
      throw new Error('Should not be called')
    })
    const query = queryResource(client, null)
    const result = await query.queryFn!()
    expect(result).toBeNull()
    expect(client.request).not.toHaveBeenCalled()
  })

  test('returns error when request throws', async () => {
    const client = createMockClient(() => {
      throw new Error('Network failure')
    })
    const query = queryResource(client, docA)
    const result = await query.queryFn!()
    expect(result).toMatchObject({type: 'error', message: 'Network failure'})
  })
})

describe('queryQueryBlock', () => {
  test('requests the combined query block payload with the expected cache key', async () => {
    const payload = {
      queryTargetName: 'Projects',
      in: docA,
      results: [
        {
          type: 'document' as const,
          id: docB,
          path: ['new-name'],
          authors: ['author-a'],
          createTime: {seconds: 1, nanos: 0},
          updateTime: {seconds: 1, nanos: 0},
          sortTime: new Date('2024-01-01T00:00:00Z'),
          genesis: 'genesis-1',
          version: 'v1',
          breadcrumbs: [],
          activitySummary: {
            latestCommentTime: undefined,
            latestCommentId: '',
            commentCount: 0,
            latestChangeTime: {seconds: 1, nanos: 0},
            isUnread: false,
          },
          generationInfo: {generation: 0n, genesis: 'genesis-1'},
          metadata: {name: 'Doc B'},
          visibility: 'PUBLIC' as const,
        },
      ],
      mode: 'Children' as const,
      interactionSummaries: {
        [docB.id]: {comments: 2, authorUids: ['author-a']},
      },
      accountsMetadata: {
        'author-a': {id: hmId('author-a'), metadata: {name: 'Author A'}},
      },
    }
    const input = {
      query: {
        includes: [{space: docA.uid, path: '/old-name', mode: 'Children' as const}],
        sort: [{term: 'UpdateTime' as const, reverse: false}],
        limit: 10,
      },
    }
    const client = createMockClient(() => payload)
    const query = queryQueryBlock(client, input)

    expect(query.queryKey).toEqual([queryKeys.QUERY_BLOCK, input.query])
    await expect(query.queryFn!()).resolves.toEqual(payload)
    expect(client.request).toHaveBeenCalledWith('QueryBlock', input, {signal: undefined})
  })
})

describe('queryDomain', () => {
  test('requests the cached domain info by default', async () => {
    const domainInfo = {
      domain: 'alice.example',
      lastCheck: null,
      status: 'success',
      lastSuccess: null,
      registeredAccountUid: 'alice',
      peerId: null,
      lastError: null,
    }
    const client = createMockClient(() => domainInfo)
    const query = queryDomain(client, 'alice.example')
    const result = await query.queryFn!()

    expect(result).toEqual(domainInfo)
    expect(client.request).toHaveBeenCalledWith('GetDomain', {domain: 'alice.example'}, {signal: undefined})
  })

  test('passes forceCheck through to the client when requested', async () => {
    const client = createMockClient(() => null)
    const query = queryDomain(client, 'alice.example', true)
    await query.queryFn!()

    expect(client.request).toHaveBeenCalledWith(
      'GetDomain',
      {domain: 'alice.example', forceCheck: true},
      {signal: undefined},
    )
  })

  test('returns null when the domain lookup fails', async () => {
    const client = createMockClient(() => {
      throw new Error('not found')
    })
    const query = queryDomain(client, 'alice.example')
    const result = await query.queryFn!()

    expect(result).toBeNull()
  })
})

describe('comment query options', () => {
  test('queryDocumentComments preserves the document comments cache key', async () => {
    const output = {comments: [], authors: {}}
    const client = createMockClient(() => output)
    const query = queryDocumentComments(client, docA)

    expect(query.queryKey).toEqual([queryKeys.DOCUMENT_COMMENTS, docA])
    expect(query.retry).toBe(1)
    expect(query.staleTime).toBe(30_000)
    await expect(query.queryFn()).resolves.toBe(output)
    expect(client.request).toHaveBeenCalledWith('ListComments', {targetId: docA}, {signal: undefined})
  })

  test('queryDocumentDiscussions preserves the document discussion cache key', async () => {
    const output = {discussions: [], citingDiscussions: [], authors: {}}
    const client = createMockClient(() => output)
    const query = queryDocumentDiscussions(client, docA, 'author/comment')

    expect(query.queryKey).toEqual([queryKeys.DOCUMENT_DISCUSSION, docA, 'author/comment'])
    expect(query.retry).toBe(1)
    expect(query.staleTime).toBe(30_000)
    await expect(query.queryFn()).resolves.toBe(output)
    expect(client.request).toHaveBeenCalledWith(
      'ListDiscussions',
      {
        targetId: docA,
        commentId: 'author/comment',
      },
      {signal: undefined},
    )
  })

  test('queryBlockDiscussions preserves the block discussions cache key', async () => {
    const output = {comments: [], authors: {}}
    const blockTarget = {...docA, blockRef: 'block-1'}
    const client = createMockClient(() => output)
    const query = queryBlockDiscussions(client, blockTarget)

    expect(query.queryKey).toEqual([queryKeys.BLOCK_DISCUSSIONS, blockTarget])
    expect(query.retry).toBe(1)
    expect(query.staleTime).toBe(30_000)
    await expect(query.queryFn()).resolves.toBe(output)
    expect(client.request).toHaveBeenCalledWith('ListCommentsByReference', {targetId: blockTarget}, {signal: undefined})
  })

  test('queryCommentVersions preserves the comment versions cache key and disabled state', () => {
    const client = createMockClient(() => ({versions: []}))
    const query = queryCommentVersions(client, null)

    expect(query.queryKey).toEqual([queryKeys.COMMENT_VERSIONS, null])
    expect(query.enabled).toBe(false)
    expect(query.useErrorBoundary).toBe(false)
    expect(query.staleTime).toBe(60_000)
  })

  test('queryCommentReplyCount uses the reply count query key', async () => {
    const output = {count: 2}
    const client = createMockClient(() => output)
    const query = queryCommentReplyCount(client, 'author/comment')

    expect(query.queryKey).toEqual([queryKeys.COMMENT_REPLY_COUNT, 'author/comment'])
    expect(query.retry).toBe(1)
    expect(query.staleTime).toBe(60_000)
    expect(query.refetchOnWindowFocus).toBe(false)
    expect(query.queryFn()).toBe(output)
    expect(client.request).toHaveBeenCalledWith('GetCommentReplyCount', {id: 'author/comment'}, {signal: undefined})
  })
})
