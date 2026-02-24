import {describe, it, expect, vi} from 'vitest'
import {serialize} from 'superjson'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createSeedClient} from '../src/client'
import {SeedClientError, SeedNetworkError, SeedValidationError} from '../src/errors'

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

const VALID_TARGET_ID = {
  id: 'hm://abc',
  uid: 'abc',
  path: null,
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
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
    const calledOptions = fetchFn.mock.calls[0]![1] as RequestInit
    expect(calledUrl).toBe('https://example.com/api/Account?id=test-uid')
    expect(calledOptions.method).toBe('GET')
  })

  it('uses generic serialization for ListComments (object input)', async () => {
    const fetchFn = mockFetchOk({comments: [], authors: {}})
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await client.request('ListComments', {targetId: VALID_TARGET_ID})

    const calledUrl = fetchFn.mock.calls[0]![0] as string
    expect(calledUrl).toContain('/api/ListComments?')
    expect(calledUrl).toContain('targetId=')
  })

  it('deserializes superjson-wrapped responses', async () => {
    const original = {comments: [], authors: {}}
    const fetchFn = mockFetchOk(original)
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    const result = await client.request('ListComments', {
      targetId: VALID_TARGET_ID,
    })
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
    expect(calledOptions.headers).toEqual(expect.objectContaining({'X-Custom': 'value'}))
  })

  it('throws SeedClientError on HTTP errors', async () => {
    const fetchFn = mockFetchError(404, 'Not Found', '{"error":"not found"}')
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await expect(client.request('Account', 'test')).rejects.toThrow(SeedClientError)

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

    await expect(client.request('Account', 'test')).rejects.toThrow(SeedNetworkError)
  })

  it('uses POST CBOR transport for PublishBlobs', async () => {
    const fetchFn = mockFetchOk({cids: ['bafynew']})
    const client = createSeedClient('https://example.com', {fetch: fetchFn})
    const input = {
      blobs: [{cid: 'bafyold', data: new Uint8Array([1, 2, 3])}],
    }

    const result = await client.request('PublishBlobs', input)

    expect(result).toEqual({cids: ['bafynew']})

    const calledUrl = fetchFn.mock.calls[0]![0] as string
    const calledOptions = fetchFn.mock.calls[0]![1] as RequestInit
    expect(calledUrl).toBe('https://example.com/api/PublishBlobs')
    expect(calledOptions.method).toBe('POST')
    expect(calledOptions.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/cbor',
      }),
    )
    expect(calledOptions.body).toBeInstanceOf(Uint8Array)
    const decodedBody = cborDecode(calledOptions.body as Uint8Array)
    expect(decodedBody).toEqual(input)
  })

  it('validates PublishBlobs input before sending request', async () => {
    const fetchFn = vi.fn()
    const client = createSeedClient('https://example.com', {fetch: fetchFn})

    await expect(
      client.request('PublishBlobs', {
        blobs: [{cid: 'bad', data: 'not-bytes'}],
      } as any),
    ).rejects.toThrow(SeedValidationError)

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('exposes publishBlobs convenience method', async () => {
    const fetchFn = mockFetchOk({cids: ['bafyviahelper']})
    const client = createSeedClient('https://example.com', {fetch: fetchFn})
    const input = {
      blobs: [{data: new Uint8Array([9, 8, 7])}],
    }

    const result = await client.publishBlobs(input)

    expect(result).toEqual({cids: ['bafyviahelper']})
  })

  it('exposes publish convenience method', async () => {
    const fetchFn = mockFetchOk({cids: ['bafyviahelper2']})
    const client = createSeedClient('https://example.com', {fetch: fetchFn})
    const input = {
      blobs: [{data: new Uint8Array([1, 2, 3])}],
    }

    const result = await client.publish(input)

    expect(result).toEqual({cids: ['bafyviahelper2']})
  })
})
