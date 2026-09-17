import {describe, expect, test} from 'bun:test'
import * as dagCbor from '@ipld/dag-cbor'
import {fileToIpfsBlobs, type SeedClient} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {blake2b} from '@noble/hashes/blake2b'
import {CID} from 'multiformats/cid'
import {create as createDigest} from 'multiformats/hashes/digest'
import {sha256} from 'multiformats/hashes/sha2'
import {existsSync, mkdtempSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AssetDownloader, cidMatches, orderBlobs, sniffExtension} from './space-archive'

async function cborBlob(value: unknown) {
  const data = dagCbor.encode(value)
  return {cid: CID.create(1, dagCbor.code, await sha256.digest(data)), data}
}

describe('cidMatches', () => {
  test('checks sha2-256 and blake2b-256 CIDs', async () => {
    const {cid, data} = await cborBlob({hello: 'world'})
    expect(cidMatches(cid, data)).toBe(true)
    expect(cidMatches(cid, new Uint8Array([1]))).toBe(false)
    const blake = CID.create(1, dagCbor.code, createDigest(0xb220, blake2b(data, {dkLen: 32})))
    expect(cidMatches(blake, data)).toBe(true)
  })
})

describe('sniffExtension', () => {
  test('names common files by their bytes', () => {
    expect(sniffExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('.png')
    expect(sniffExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg')
    expect(sniffExtension(new TextEncoder().encode('%PDF-1.7'))).toBe('.pdf')
    expect(sniffExtension(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="x">'))).toBe('.svg')
    expect(sniffExtension(new TextEncoder().encode('just text'))).toBe('')
  })
})

describe('orderBlobs', () => {
  test('publishes files first and every blob after what it links', async () => {
    const genesis = await cborBlob({type: 'Change', ts: 3})
    const change = await cborBlob({type: 'Change', ts: 1, genesis: genesis.cid, deps: [genesis.cid]})
    const ref = await cborBlob({type: 'Ref', ts: 0, heads: [change.cid]})
    const cap = await cborBlob({type: 'Capability', ts: 9})
    const file = await fileToIpfsBlobs(new Uint8Array([1, 2, 3]))
    const blobs = new Map<string, Uint8Array>([
      [ref.cid.toString(), ref.data],
      [change.cid.toString(), change.data],
      [genesis.cid.toString(), genesis.data],
      [cap.cid.toString(), cap.data],
      [file.cid, file.blobs[0]!.data],
    ])
    const order = orderBlobs(blobs).map((b) => b.type)
    expect(order).toEqual(['raw', 'Capability', 'Change', 'Change', 'Ref'])
    const cids = orderBlobs(blobs).map((b) => b.cid)
    expect(cids.indexOf(genesis.cid.toString())).toBeLessThan(cids.indexOf(change.cid.toString()))
  })
})

describe('AssetDownloader', () => {
  test('downloads each linked file once and links it relatively', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const requested: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      requested.push(String(url))
      return new Response(png)
    }) as typeof fetch
    try {
      const dir = mkdtempSync(join(tmpdir(), 'asset-test-'))
      const downloader = new AssetDownloader({baseUrl: 'http://server'} as SeedClient, dir)
      const nodes = [
        {block: {id: 'a', type: 'Image', text: '', link: 'ipfs://bafkimage', annotations: [], attributes: {}}},
        {
          block: {id: 'b', type: 'Paragraph', text: 'x', annotations: [], attributes: {}},
          children: [{block: {id: 'c', type: 'File', link: 'ipfs://bafkimage', attributes: {}}}],
        },
      ] as unknown as HMBlockNode[]
      const out = await downloader.localize(nodes, 'guides/intro.md', {icon: 'ipfs://bafkicon'})
      expect((out[0]!.block as {link: string}).link).toBe('../assets/bafkimage.png')
      expect((out[1]!.children![0]!.block as {link: string}).link).toBe('../assets/bafkimage.png')
      expect(requested).toEqual(['http://server/hm/api/file/bafkicon', 'http://server/hm/api/file/bafkimage'])
      expect(existsSync(join(dir, 'assets/bafkicon.png'))).toBe(true)
      expect(new Uint8Array(readFileSync(join(dir, 'assets/bafkimage.png')))).toEqual(png)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
