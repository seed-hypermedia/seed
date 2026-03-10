import {beforeEach, describe, it, expect, vi} from 'vitest'
import {serialize} from 'superjson'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {createSeedClient} from '../src/client'
import {createDocumentChange, createGenesisChange, signDocumentChange} from '../src/change'
import {SeedClientError, SeedNetworkError, SeedValidationError} from '../src/errors'
import {createVersionRef} from '../src/ref'

vi.mock('../src/change', async () => {
  const actual = await vi.importActual<typeof import('../src/change')>('../src/change')
  return {
    ...actual,
    createGenesisChange: vi.fn(),
    createDocumentChange: vi.fn(),
    signDocumentChange: vi.fn(),
  }
})

vi.mock('../src/ref', async () => {
  const actual = await vi.importActual<typeof import('../src/ref')>('../src/ref')
  return {
    ...actual,
    createVersionRef: vi.fn(),
  }
})

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('uses POST CBOR transport for PrepareDocumentChange', async () => {
    // PrepareDocumentChange is an action — should use POST like PublishBlobs.
    // We abort after the fetch call to inspect transport without faking the response.
    let capturedUrl: string | undefined
    let capturedOptions: RequestInit | undefined

    const fetchFn = vi.fn().mockImplementation((url: string, options: RequestInit) => {
      capturedUrl = url
      capturedOptions = options
      return Promise.reject(new Error('test abort'))
    })
    const client = createSeedClient('https://example.com', {fetch: fetchFn})
    const input = {account: 'test-uid', changes: []}

    await expect(client.request('PrepareDocumentChange', input)).rejects.toThrow(SeedNetworkError)

    expect(capturedUrl).toBe('https://example.com/api/PrepareDocumentChange')
    expect(capturedOptions?.method).toBe('POST')
    expect(capturedOptions?.headers).toEqual(expect.objectContaining({'Content-Type': 'application/cbor'}))
    const decodedBody = cborDecode(capturedOptions?.body as Uint8Array)
    expect(decodedBody).toEqual(input)
  })

  it('publishes new documents through PrepareDocumentChange before PublishBlobs', async () => {
    const mockedSignDocumentChange = vi.mocked(signDocumentChange)
    mockedSignDocumentChange.mockResolvedValueOnce({
      changeCid: {} as any,
      publishInput: {
        blobs: [{cid: 'bafy-change', data: new Uint8Array([4, 5, 6])}],
      },
    })

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => serialize({unsignedChange: new Uint8Array([1, 2, 3])}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => serialize({cids: ['bafy-change']}),
      })

    const client = createSeedClient('https://example.com', {fetch: fetchFn})
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }

    await client.publishDocument(
      {
        account: 'test-uid',
        path: '/new-doc',
        changes: [
          {
            op: {
              case: 'setAttribute',
              value: {
                blockId: '',
                key: ['customField'],
                value: {
                  case: 'stringValue',
                  value: 'custom value',
                },
              },
            },
          },
        ],
      },
      signer,
    )

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://example.com/api/PrepareDocumentChange')
    expect(fetchFn.mock.calls[1]?.[0]).toBe('https://example.com/api/PublishBlobs')
    expect(mockedSignDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'test-uid',
        path: '/new-doc',
        unsignedChange: new Uint8Array([1, 2, 3]),
      }),
      signer,
    )
  })

  it('publishes brand-new home documents without PrepareDocumentChange', async () => {
    const mockedCreateGenesisChange = vi.mocked(createGenesisChange)
    const mockedCreateDocumentChange = vi.mocked(createDocumentChange)
    const mockedCreateVersionRef = vi.mocked(createVersionRef)
    const mockedSignDocumentChange = vi.mocked(signDocumentChange)

    mockedCreateGenesisChange.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      cid: {toString: () => 'bafy-genesis'} as any,
    })
    mockedCreateDocumentChange.mockResolvedValueOnce({
      bytes: new Uint8Array([2]),
      cid: {toString: () => 'bafy-content'} as any,
    })
    mockedCreateVersionRef.mockResolvedValueOnce({
      blobs: [{cid: 'bafy-ref', data: new Uint8Array([3])}],
    })

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => serialize({cids: ['bafy-genesis', 'bafy-content', 'bafy-ref']}),
    })

    const client = createSeedClient('https://example.com', {fetch: fetchFn})
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }

    await client.publishDocument(
      {
        account: 'test-uid',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}}],
      },
      signer,
    )

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://example.com/api/PublishBlobs')
    expect(mockedCreateGenesisChange).toHaveBeenCalledWith(signer)
    expect(mockedCreateDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        depth: 1,
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}}],
      }),
      signer,
    )
    expect(mockedCreateVersionRef).toHaveBeenCalledWith(
      expect.objectContaining({
        space: 'test-uid',
        path: '',
        genesis: 'bafy-genesis',
        version: 'bafy-content',
      }),
      signer,
    )
    expect(mockedSignDocumentChange).not.toHaveBeenCalled()
  })
})
