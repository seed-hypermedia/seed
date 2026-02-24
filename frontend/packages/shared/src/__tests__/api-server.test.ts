import {describe, expect, it, vi} from 'vitest'
import {encode as cborEncode} from '@ipld/dag-cbor'
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
        error: 'Unknown API key: UnknownKey',
      }),
    )
  })
})
