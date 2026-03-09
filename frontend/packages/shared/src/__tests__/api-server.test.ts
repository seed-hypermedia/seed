import {describe, expect, it, vi} from 'vitest'
import {encode as cborEncode, decode as cborDecode} from '@ipld/dag-cbor'
import {deserialize} from 'superjson'
import {handleApiAction} from '../api-server'

describe('handleApiAction', () => {
  it('returns 200 for valid PublishBlobs payload', async () => {
    const storeBlobs = vi.fn().mockResolvedValue({cids: ['bafynew']})
    const grpcClient = {
      daemon: {
        storeBlobs,
      },
    } as any
    const queryDaemon = vi.fn()
    const payload = {
      blobs: [{cid: 'bafyold', data: new Uint8Array([1, 2, 3])}],
    }

    const result = await handleApiAction('PublishBlobs', cborEncode(payload), grpcClient, queryDaemon)

    expect(result.status).toBe(200)
    expect(deserialize(JSON.parse(result.body))).toEqual({cids: ['bafynew']})
    expect(storeBlobs).toHaveBeenCalledWith({
      blobs: [{cid: 'bafyold', data: new Uint8Array([1, 2, 3])}],
    })
  })

  it('returns 400 for invalid PublishBlobs input payload', async () => {
    const storeBlobs = vi.fn().mockResolvedValue({cids: ['ignored']})
    const grpcClient = {
      daemon: {
        storeBlobs,
      },
    } as any
    const queryDaemon = vi.fn()
    const invalidPayload = {
      blobs: [{cid: 'bad', data: 'not-bytes'}],
    }

    const result = await handleApiAction('PublishBlobs', cborEncode(invalidPayload), grpcClient, queryDaemon)

    expect(result.status).toBe(400)
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({error: expect.any(String)}))
    expect(storeBlobs).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown API key', async () => {
    const grpcClient = {
      daemon: {
        storeBlobs: vi.fn(),
      },
    } as any
    const queryDaemon = vi.fn()

    const result = await handleApiAction('UnknownKey', cborEncode({}), grpcClient, queryDaemon)

    expect(result.status).toBe(404)
    expect(JSON.parse(result.body)).toEqual(
      expect.objectContaining({
        error: 'Unknown action key: UnknownKey',
      }),
    )
  })

  it('returns 200 for valid PrepareDocumentChange payload', async () => {
    const unsignedChange = new Uint8Array([4, 5, 6])
    const prepareChange = vi.fn().mockResolvedValue({unsignedChange})
    const grpcClient = {documents: {prepareChange}} as any
    const queryDaemon = vi.fn()
    const payload = {account: 'test-uid', changes: []}

    const result = await handleApiAction('PrepareDocumentChange', cborEncode(payload), grpcClient, queryDaemon)

    expect(result.status).toBe(200)
    expect(prepareChange).toHaveBeenCalledWith(expect.objectContaining({account: 'test-uid', changes: []}))
    const deserialized = deserialize(JSON.parse(result.body)) as any
    expect(deserialized.unsignedChange).toBeInstanceOf(Uint8Array)
    expect(Array.from(deserialized.unsignedChange)).toEqual([4, 5, 6])
  })

  it('converts change plain objects to DocumentChange instances for prepareChange', async () => {
    const prepareChange = vi.fn().mockResolvedValue({unsignedChange: new Uint8Array([1])})
    const grpcClient = {documents: {prepareChange}} as any
    const queryDaemon = vi.fn()
    const payload = {
      account: 'test-uid',
      changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Test'}}}],
    }

    await handleApiAction('PrepareDocumentChange', cborEncode(payload), grpcClient, queryDaemon)

    const calledChanges = prepareChange.mock.calls[0]![0].changes
    expect(calledChanges).toHaveLength(1)
    expect(calledChanges[0].op.case).toBe('setMetadata')
    expect(calledChanges[0].op.value).toEqual(expect.objectContaining({key: 'name', value: 'Test'}))
  })

  it('accepts PublishBlobs with Buffer-like byte data from CBOR decode', async () => {
    // Simulate what happens in Electron's bundled main process where
    // @ipld/dag-cbor may decode bytes as a Uint8Array subclass (Buffer)
    // that fails z.instanceof(Uint8Array) due to cross-realm constructor mismatch.
    const storeBlobs = vi.fn().mockResolvedValue({cids: ['bafynew']})
    const grpcClient = {daemon: {storeBlobs}} as any
    const queryDaemon = vi.fn()

    // Create a Uint8Array subclass to simulate Buffer or cross-realm Uint8Array
    class FakeBuffer extends Uint8Array {}
    const blobData = new FakeBuffer([1, 2, 3])
    const payload = {blobs: [{cid: 'bafyold', data: blobData}]}
    const encoded = cborEncode(payload)

    // Manually decode and re-encode with the subclass to bypass normal CBOR round-trip
    const decoded = cborDecode(encoded) as any
    // Replace the data with our FakeBuffer to simulate the cross-realm issue
    decoded.blobs[0].data = new FakeBuffer(decoded.blobs[0].data)

    const result = await handleApiAction('PublishBlobs', cborEncode(decoded), grpcClient, queryDaemon)

    expect(result.status).toBe(200)
    expect(storeBlobs).toHaveBeenCalled()
  })

  it('returns 400 for PrepareDocumentChange missing required account', async () => {
    const grpcClient = {documents: {prepareChange: vi.fn()}} as any
    const queryDaemon = vi.fn()
    const invalidPayload = {changes: []} // missing 'account'

    const result = await handleApiAction('PrepareDocumentChange', cborEncode(invalidPayload), grpcClient, queryDaemon)

    expect(result.status).toBe(400)
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining({error: expect.any(String)}))
  })
})
