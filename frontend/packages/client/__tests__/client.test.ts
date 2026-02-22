import {describe, it, expect, vi} from 'vitest'
import {serialize} from 'superjson'
import {createSeedClient} from '../src/client'
import {SeedClientError, SeedNetworkError} from '../src/errors'

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => serialize(data),
  })
}

function mockFetchError(status: number, statusText: string, body?: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: async () => body ?? '',
  })
}

describe('createSeedClient', () => {
  it('strips trailing slashes from baseUrl', () => {
    const client = createSeedClient('https://example.com/')
    expect(client.baseUrl).toBe('https://example.com')
  })

  it('uses custom APIParams serializer for Account (string input)', async () => {
    // Account uses AccountParams.inputToParams which converts uid → {id: uid}
    const fetchFn = mockFetchOk({type: 'account-not-found', uid: 'test-uid'})
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await client.request('Account', 'test-uid')

    const calledUrl = fetchFn.mock.calls[0]![0] as string
    expect(calledUrl).toBe('https://example.com/api/Account?id=test-uid')
  })

  it('uses generic serialization for ListComments (object input)', async () => {
    const fetchFn = mockFetchOk({comments: [], authors: {}})
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await client.request('ListComments', {targetId: 'hm://abc'})

    const calledUrl = fetchFn.mock.calls[0]![0] as string
    expect(calledUrl).toContain('/api/ListComments?')
    expect(calledUrl).toContain('targetId=')
  })

  it('deserializes superjson-wrapped responses', async () => {
    const original = {comments: [], authors: {}}
    const fetchFn = mockFetchOk(original)
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    const result = await client.request('ListComments', {targetId: 'hm://abc'})
    expect(result).toEqual(original)
  })

  it('sends default headers', async () => {
    const fetchFn = mockFetchOk({type: 'account-not-found', uid: 'x'})
    const client = createSeedClient('https://example.com', {
      fetch: fetchFn,
      headers: {'X-Custom': 'value'},
    })

    await client.request('Account', 'x')

    const calledOptions = fetchFn.mock.calls[0]![1] as RequestInit
    expect(calledOptions.headers).toEqual(
      expect.objectContaining({'X-Custom': 'value'}),
    )
  })

  it('throws SeedClientError on HTTP errors', async () => {
    const fetchFn = mockFetchError(404, 'Not Found', '{"error":"not found"}')
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await expect(client.request('Account', 'test')).rejects.toThrow(
      SeedClientError,
    )

    try {
      await client.request('Account', 'test')
    } catch (err) {
      expect(err).toBeInstanceOf(SeedClientError)
      const e = err as SeedClientError
      expect(e.status).toBe(404)
      expect(e.body).toBe('{"error":"not found"}')
    }
  })

  it('throws SeedNetworkError on fetch failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('DNS failure'))
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await expect(client.request('Account', 'test')).rejects.toThrow(
      SeedNetworkError,
    )
  })
})
