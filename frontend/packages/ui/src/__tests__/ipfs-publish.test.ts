import {describe, expect, it, vi} from 'vitest'
import {publishCborBlob, publishTextBlob, type BlobPublisher} from '../ipfs-publish'

function mockClient() {
  const publish = vi.fn(async (input: {blobs: {cid?: string; data: Uint8Array}[]}) => ({
    cids: input.blobs.map((b) => b.cid ?? ''),
  }))
  return {publish} satisfies BlobPublisher & {publish: ReturnType<typeof vi.fn>}
}

describe('publishCborBlob', () => {
  it('encodes JSON to a dag-cbor blob, publishes it, and returns the CID', async () => {
    const client = mockClient()
    const cid = await publishCborBlob(client, {hello: 'world', n: 3})
    // CIDv1 / dag-cbor / sha-256 in base32 always starts with "bafyrei".
    expect(cid).toMatch(/^bafyrei/)
    expect(client.publish).toHaveBeenCalledTimes(1)
    const call = client.publish.mock.calls[0]![0]
    expect(call.blobs).toHaveLength(1)
    expect(call.blobs[0]!.cid).toBe(cid)
    expect(call.blobs[0]!.data).toBeInstanceOf(Uint8Array)
  })

  it('is content-addressed: identical content yields the same CID', async () => {
    const a = await publishCborBlob(mockClient(), {a: 1, b: 2})
    const b = await publishCborBlob(mockClient(), {a: 1, b: 2})
    expect(a).toBe(b)
  })

  it('refuses data that collides with a Seed indexer blob type', async () => {
    const client = mockClient()
    await expect(publishCborBlob(client, {type: 'Comment', body: 'x'})).rejects.toThrow(/Comment/)
    expect(client.publish).not.toHaveBeenCalled()
  })

  it('converts DAG-JSON link forms into real IPLD links before publishing', async () => {
    const client = mockClient()
    // A `{"/": cid}` link form must not throw and must publish.
    const cid = await publishCborBlob(client, {
      ref: {'/': 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgss5hjhr3lxns5x7q'},
    })
    expect(cid).toMatch(/^bafyrei/)
    expect(client.publish).toHaveBeenCalledTimes(1)
  })
})

describe('publishTextBlob', () => {
  it('chunks edited text into a UnixFS blob, publishes it, and returns a CID', async () => {
    const client = mockClient()
    const cid = await publishTextBlob(client, 'hello world')
    expect(typeof cid).toBe('string')
    expect(cid.length).toBeGreaterThan(10)
    expect(client.publish).toHaveBeenCalledTimes(1)
    const call = client.publish.mock.calls[0]![0]
    expect(call.blobs.length).toBeGreaterThan(0)
    expect(call.blobs[0]!.data).toBeInstanceOf(Uint8Array)
  })
})
