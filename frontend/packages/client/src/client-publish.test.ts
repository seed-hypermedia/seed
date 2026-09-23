import {CID} from 'multiformats/cid'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createSeedClient} from './client'

const blob = (cid: string, n: number) => ({cid, data: new Uint8Array(n).fill(7)})
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}})

describe('SeedClient.publish', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stores blobs through the API when the site accepts the body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({cids: ['a', 'b']}))
    const client = createSeedClient('https://site.example')
    const out = await client.publish({blobs: [blob('a', 10), blob('b', 20)]})
    expect(out.cids).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://site.example/api/PublishBlobs')
  })

  it('falls back to one POST /ipfs/<cid> per blob when the API answers 413', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Request Entity Too Large', {status: 413}))
      .mockResolvedValue(new Response('', {status: 200}))
    const client = createSeedClient('https://site.example/')
    const out = await client.publish({blobs: [blob('bafyA', 10), blob('bafyB', 20)]})
    expect(out.cids).toEqual(['bafyA', 'bafyB'])
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual([
      'https://site.example/api/PublishBlobs',
      'https://site.example/ipfs/bafyA',
      'https://site.example/ipfs/bafyB',
    ])
    const put = fetchMock.mock.calls[1]![1] as RequestInit
    expect(put.method).toBe('POST')
    expect((put.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream')
    expect((put.body as Uint8Array).byteLength).toBe(10)
  })

  it('names an unaddressed blob the way the daemon would (DAG-CBOR, blake2b-256) before putting it', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Request Entity Too Large', {status: 413}))
      .mockResolvedValue(new Response('', {status: 200}))
    const client = createSeedClient('https://site.example')
    const data = new TextEncoder().encode('a ref without a cid')
    const out = await client.publish({blobs: [{data}]})
    const cid = CID.parse(out.cids[0]!)
    expect(cid.code).toBe(0x71)
    expect(cid.multihash.code).toBe(0xb220)
    expect(out.cids[0]!.startsWith('bafy2bzace')).toBe(true)
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`https://site.example/ipfs/${out.cids[0]}`)
    expect(client.daemonBlobCid(data)).toBe(out.cids[0])
  })

  it('does not fall back on any other error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', {status: 500}))
    const client = createSeedClient('https://site.example')
    await expect(client.publish({blobs: [blob('a', 1)]})).rejects.toMatchObject({status: 500})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('putBlob reports the daemon refusing a mismatched CID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('CID mismatch', {status: 400}))
    const client = createSeedClient('https://site.example')
    await expect(client.putBlob(blob('bafyX', 4))).rejects.toMatchObject({status: 400, body: 'CID mismatch'})
  })
})
