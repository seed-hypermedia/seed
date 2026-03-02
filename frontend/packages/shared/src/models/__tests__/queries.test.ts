import {describe, expect, test, vi} from 'vitest'
import {hmId} from '../../utils/entity-id-url'
import {queryResource} from '../queries'

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

const redirectResponse = (from: ReturnType<typeof hmId>, to: ReturnType<typeof hmId>) => ({
  type: 'redirect' as const,
  id: from,
  redirectTarget: to,
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

  test('stops following redirects after max depth (5)', async () => {
    // Create a chain of 6 redirects — should stop after 5
    const ids = Array.from({length: 7}, (_, i) => hmId('uid1', {path: [`doc-${i}`]}))
    const client = createMockClient((_key, input) => {
      const idx = ids.findIndex((id) => id.id === input.id)
      if (idx >= 0 && idx < ids.length - 1) {
        return redirectResponse(ids[idx]!, ids[idx + 1]!)
      }
      return documentResponse(ids[idx]!)
    })
    const query = queryResource(client, ids[0]!)
    const result = await query.queryFn!()
    // After 5 redirects, we're at ids[5] which still redirects to ids[6],
    // but we've hit the limit. The result is the redirect response itself.
    expect(result).toMatchObject({type: 'redirect'})
    // 1 initial + 5 follows = 6 total requests
    expect(client.request).toHaveBeenCalledTimes(6)
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
