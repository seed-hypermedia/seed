import {describe, expect, test} from 'bun:test'
import * as dagCbor from '@ipld/dag-cbor'
import {fileToIpfsBlobs, type SeedClient} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {blake2b} from '@noble/hashes/blake2b'
import {zipSync} from 'fflate'
import {CID} from 'multiformats/cid'
import {create as createDigest} from 'multiformats/hashes/digest'
import {sha256} from 'multiformats/hashes/sha2'
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  AssetDownloader,
  archiveSpace,
  cidMatches,
  collectSpaceBlobs,
  extractMarkdownArchive,
  orderBlobs,
  readArchive,
  restoreBlobs,
  sniffExtension,
  type ArchiveManifest,
} from './space-archive'

async function cborBlob(value: unknown) {
  const data = dagCbor.encode(value)
  return {cid: CID.create(1, dagCbor.code, await sha256.digest(data)), data}
}

async function rawBlob(data: Uint8Array) {
  return {cid: CID.create(1, 0x55, await sha256.digest(data)), data}
}

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Serve `/hm/api/file/<cid>` from `store` for the duration of `fn`; anything else is a 404. */
async function withFileServer<T>(store: Map<string, Uint8Array>, fn: (requested: string[]) => Promise<T>): Promise<T> {
  const requested: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    requested.push(String(url))
    const cid = String(url).split('/').pop()!
    const data = store.get(cid)
    return data ? new Response(data) : new Response('not found', {status: 404})
  }) as typeof fetch
  try {
    return await fn(requested)
  } finally {
    globalThis.fetch = realFetch
  }
}

describe('cidMatches', () => {
  test('checks sha2-256 and blake2b-256 CIDs', async () => {
    const {cid, data} = await cborBlob({hello: 'world'})
    expect(cidMatches(cid, data)).toBe(true)
    expect(cidMatches(cid, new Uint8Array([1]))).toBe(false)
    const blake = CID.create(1, dagCbor.code, createDigest(0xb220, blake2b(data, {dkLen: 32})))
    expect(cidMatches(blake, data)).toBe(true)
  })

  test('rejects a hash function it cannot check', async () => {
    const data = new Uint8Array([1, 2, 3])
    const sha512 = CID.create(1, 0x55, createDigest(0x13, new Uint8Array(64)))
    expect(cidMatches(sha512, data)).toBe(false)
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

  test('tells media containers apart', () => {
    const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0))
    expect(sniffExtension(new Uint8Array([...bytes('RIFF'), 0, 0, 0, 0, ...bytes('WEBP')]))).toBe('.webp')
    expect(sniffExtension(new Uint8Array([0, 0, 0, 0x18, ...bytes('ftypisom')]))).toBe('.mp4')
    expect(sniffExtension(new Uint8Array([0, 0, 0, 0x14, ...bytes('ftypqt  ')]))).toBe('.mov')
    expect(sniffExtension(new TextEncoder().encode('GIF89a'))).toBe('.gif')
    expect(sniffExtension(new TextEncoder().encode('OggS'))).toBe('.ogg')
    expect(sniffExtension(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('.zip')
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

  test('puts blob types it does not know last, and a reply after its parent', async () => {
    const parent = await cborBlob({type: 'Comment', ts: 5})
    const reply = await cborBlob({type: 'Comment', ts: 4, replyParent: parent.cid})
    const other = await cborBlob({type: 'Something', ts: 0})
    const untyped = await cborBlob({hello: 'world'})
    const blobs = new Map<string, Uint8Array>([
      [reply.cid.toString(), reply.data],
      [other.cid.toString(), other.data],
      [untyped.cid.toString(), untyped.data],
      [parent.cid.toString(), parent.data],
    ])
    const cids = orderBlobs(blobs).map((b) => b.cid)
    expect(cids.slice(0, 2)).toEqual([parent.cid.toString(), reply.cid.toString()])
    expect(new Set(cids.slice(2))).toEqual(new Set([other.cid.toString(), untyped.cid.toString()]))
  })
})

describe('AssetDownloader', () => {
  test('downloads each linked file once and links it relatively', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const store = new Map([
      ['bafkimage', png],
      ['bafkicon', png],
    ])
    await withFileServer(store, async (requested) => {
      const dir = tempDir('asset-test-')
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
      expect(downloader.assets.map((a) => a.file).sort()).toEqual(['assets/bafkicon.png', 'assets/bafkimage.png'])
      expect(downloader.missing).toEqual([])
    })
  })

  test('links from a top-level file start with ./ and non-file links are left alone', async () => {
    const store = new Map([['bafkdoc', new TextEncoder().encode('%PDF-1.4')]])
    await withFileServer(store, async () => {
      const downloader = new AssetDownloader({baseUrl: 'http://server'} as SeedClient, tempDir('asset-test-'))
      const nodes = [
        {block: {id: 'a', type: 'File', link: 'ipfs://bafkdoc', attributes: {}}},
        {block: {id: 'b', type: 'Embed', link: 'ipfs://bafkdoc', attributes: {}}},
        {block: {id: 'c', type: 'Link', link: 'hm://z6Mk/doc', text: 'a document', annotations: []}},
        {block: {id: 'd', type: 'Image', link: 'https://example.com/pic.png', attributes: {}}},
      ] as unknown as HMBlockNode[]
      const out = await downloader.localize(nodes, 'index.md')
      expect(out.map((n) => (n.block as {link: string}).link)).toEqual([
        './assets/bafkdoc.pdf',
        'ipfs://bafkdoc',
        'hm://z6Mk/doc',
        'https://example.com/pic.png',
      ])
    })
  })

  test('keeps the ipfs:// link and records the CID as missing when the server cannot return the file', async () => {
    await withFileServer(new Map(), async () => {
      const lines: string[] = []
      const downloader = new AssetDownloader(
        {baseUrl: 'http://server'} as SeedClient,
        tempDir('asset-test-'),
        'assets',
        (l) => lines.push(l),
      )
      const nodes = [
        {block: {id: 'a', type: 'Image', link: 'ipfs://bafkgone', attributes: {}}},
      ] as unknown as HMBlockNode[]
      const out = await downloader.localize(nodes, 'index.md', {cover: 'ipfs://bafkcover'})
      expect((out[0]!.block as {link: string}).link).toBe('ipfs://bafkgone')
      expect(downloader.assets).toEqual([])
      expect(downloader.missing.map((m) => m.cid).sort()).toEqual(['bafkcover', 'bafkgone'])
      expect(downloader.missing[0]!.reason).toBe('HTTP 404')
      expect(lines.some((l) => l.startsWith('missing bafkgone'))).toBe(true)
    })
  })
})

describe('readArchive', () => {
  function zipWith(dir: string, entries: Record<string, Uint8Array>) {
    const file = join(dir, 'a.zip')
    writeFileSync(file, zipSync(entries))
    return file
  }
  const manifest = (extra: Partial<ArchiveManifest>) =>
    new TextEncoder().encode(
      JSON.stringify({format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, kind: 'blobs', documents: [], ...extra}),
    )

  test('returns the manifest and every other file, directory entries left out', () => {
    const dir = tempDir('archive-test-')
    const file = zipWith(dir, {
      'manifest.json': manifest({space: 'z6MkA'}),
      'blobs/': new Uint8Array(),
      'blobs/bafy1': new Uint8Array([1]),
      'notes.md': new TextEncoder().encode('# Notes'),
    })
    const read = readArchive(file)
    expect(read.manifest.space).toBe('z6MkA')
    expect([...read.files.keys()].sort()).toEqual(['blobs/bafy1', 'notes.md'])
  })

  test('refuses a zip without a manifest, another format, or a newer archive version', () => {
    const dir = tempDir('archive-test-')
    expect(() => readArchive(zipWith(dir, {'notes.md': new Uint8Array([1])}))).toThrow(/no manifest.json/)
    expect(() => readArchive(zipWith(dir, {'manifest.json': manifest({format: 'other' as never})}))).toThrow(
      /not a space archive \(format other\)/,
    )
    expect(() => readArchive(zipWith(dir, {'manifest.json': manifest({version: ARCHIVE_VERSION + 1})}))).toThrow(
      /archive version 2; this CLI reads up to 1/,
    )
  })
})

describe('extractMarkdownArchive', () => {
  test('writes every file under the directory', () => {
    const dir = tempDir('extract-test-')
    const files = new Map<string, Uint8Array>([
      ['notes.md', new TextEncoder().encode('# Notes')],
      ['guides/intro.md', new TextEncoder().encode('# Intro')],
      ['assets/bafk.png', new Uint8Array([0x89, 0x50])],
    ])
    expect(extractMarkdownArchive(files, dir)).toEqual(['notes.md', 'guides/intro.md', 'assets/bafk.png'])
    expect(readFileSync(join(dir, 'guides/intro.md'), 'utf8')).toBe('# Intro')
    expect(new Uint8Array(readFileSync(join(dir, 'assets/bafk.png')))).toEqual(new Uint8Array([0x89, 0x50]))
  })

  test('refuses an entry that would land outside the directory', () => {
    const dir = tempDir('extract-test-')
    for (const name of ['../escape.md', '/etc/escape.md', 'a/../../escape.md']) {
      expect(() => extractMarkdownArchive(new Map([[name, new Uint8Array([1])]]), dir)).toThrow(
        /Refusing to extract .* outside/,
      )
    }
    expect(existsSync(join(dir, '..', 'escape.md'))).toBe(false)
  })
})

describe('restoreBlobs', () => {
  function publishingClient() {
    const batches: Array<Array<{cid: string; data: Uint8Array}>> = []
    const client = {
      baseUrl: 'http://server',
      publish: async ({blobs}: {blobs: Array<{cid: string; data: Uint8Array}>}) => {
        batches.push(blobs)
      },
    } as unknown as SeedClient
    return {client, batches}
  }
  const manifestFor = (blobs: Array<{cid: CID; data: Uint8Array}>): ArchiveManifest => ({
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    kind: 'blobs',
    space: 'z6MkA',
    server: 'http://origin',
    createdAt: '2026-01-01T00:00:00.000Z',
    documents: [],
    blobs: blobs.map((b) => ({cid: b.cid.toString(), size: b.data.length})),
  })
  const filesFor = (blobs: Array<{cid: CID; data: Uint8Array}>) =>
    new Map(blobs.map((b) => [`blobs/${b.cid.toString()}`, b.data]))

  test('publishes the blobs in manifest order and reports the bytes', async () => {
    const blobs = [await cborBlob({type: 'Change', ts: 1}), await cborBlob({type: 'Ref', ts: 2})]
    const {client, batches} = publishingClient()
    const lines: string[] = []
    const result = await restoreBlobs({
      client,
      manifest: manifestFor(blobs),
      files: filesFor(blobs),
      log: (l) => lines.push(l),
    })
    expect(result).toEqual({published: 2, bytes: blobs[0]!.data.length + blobs[1]!.data.length})
    expect(batches.map((b) => b.map((x) => x.cid))).toEqual([blobs.map((b) => b.cid.toString())])
    expect(lines).toEqual(['publish 2/2 blobs'])
  })

  test('a dry run checks everything and publishes nothing', async () => {
    const blobs = [await cborBlob({type: 'Change', ts: 1})]
    const {client, batches} = publishingClient()
    const result = await restoreBlobs({client, manifest: manifestFor(blobs), files: filesFor(blobs), dryRun: true})
    expect(result).toEqual({published: 0, bytes: blobs[0]!.data.length})
    expect(batches).toEqual([])
  })

  test('refuses an archive whose bytes do not match, or that lacks a listed blob', async () => {
    const good = await cborBlob({type: 'Change', ts: 1})
    const other = await cborBlob({type: 'Change', ts: 2})
    const {client, batches} = publishingClient()
    const damaged = filesFor([good, other])
    damaged.set(`blobs/${other.cid}`, new Uint8Array([1, 2, 3]))
    await expect(restoreBlobs({client, manifest: manifestFor([good, other]), files: damaged})).rejects.toThrow(
      new RegExp(`damaged:\\n  ${other.cid}: bytes do not match the CID`),
    )
    await expect(restoreBlobs({client, manifest: manifestFor([good, other]), files: filesFor([good])})).rejects.toThrow(
      /listed in the manifest but not in the archive/,
    )
    expect(batches).toEqual([])
  })

  test('splits publishing into batches by count and by size', async () => {
    const many = await Promise.all(Array.from({length: 201}, (_, i) => cborBlob({type: 'Change', ts: i})))
    const {client, batches} = publishingClient()
    const result = await restoreBlobs({client, manifest: manifestFor(many), files: filesFor(many)})
    expect(result.published).toBe(201)
    expect(batches.map((b) => b.length)).toEqual([200, 1])
    expect(batches.flat().map((b) => b.cid)).toEqual(many.map((b) => b.cid.toString()))

    const big = [
      await rawBlob(new Uint8Array(3 * 1024 * 1024).fill(1)),
      await rawBlob(new Uint8Array(3 * 1024 * 1024).fill(2)),
    ]
    const sized = publishingClient()
    await restoreBlobs({client: sized.client, manifest: manifestFor(big), files: filesFor(big)})
    expect(sized.batches.map((b) => b.length)).toEqual([1, 1])
  })
})

/**
 * A space of one document as a server would list it: a genesis change, a change linking a
 * file, a capability, the Ref placing the document, and a comment on it.
 */
async function fakeSpace() {
  const uid = 'z6MkFakeSpace'
  const file = await fileToIpfsBlobs(new Uint8Array([9, 8, 7]))
  const genesis = await cborBlob({type: 'Change', ts: 1, author: uid})
  const change = await cborBlob({
    type: 'Change',
    ts: 2,
    genesis: genesis.cid,
    deps: [genesis.cid],
    body: {ops: [{link: `ipfs://${file.cid}`}]},
  })
  const cap = await cborBlob({type: 'Capability', ts: 3})
  const ref = await cborBlob({type: 'Ref', ts: 4, genesis: genesis.cid, heads: [change.cid], capability: cap.cid})
  const comment = await cborBlob({type: 'Comment', ts: 5, version: [change.cid]})
  const store = new Map<string, Uint8Array>([
    [genesis.cid.toString(), genesis.data],
    [change.cid.toString(), change.data],
    [cap.cid.toString(), cap.data],
    [ref.cid.toString(), ref.data],
    [comment.cid.toString(), comment.data],
    [file.cid, file.blobs[0]!.data],
  ])
  const document = {path: '', version: change.cid.toString(), genesis: genesis.cid.toString(), content: []}
  const client = (overrides: Record<string, () => unknown> = {}) =>
    ({
      baseUrl: 'http://server',
      request: async (method: string) => {
        if (overrides[method]) return overrides[method]!()
        switch (method) {
          case 'Resource':
            return {type: 'document', document}
          case 'Query':
            return {results: []}
          case 'ListRefs':
            return {refs: [{id: ref.cid.toString()}]}
          case 'ListChanges':
            return {changes: [{id: genesis.cid.toString()}, {id: change.cid.toString()}]}
          case 'ListCapabilities':
            return {capabilities: [{id: cap.cid.toString()}]}
          case 'ListComments':
            return {comments: [{version: comment.cid.toString()}]}
        }
        throw new Error(`unexpected request ${method}`)
      },
    }) as unknown as SeedClient
  return {uid, file, genesis, change, cap, ref, comment, store, client}
}

describe('collectSpaceBlobs', () => {
  test('follows every link from what the server lists and checks each blob', async () => {
    const space = await fakeSpace()
    await withFileServer(space.store, async () => {
      const lines: string[] = []
      const collected = await collectSpaceBlobs({client: space.client(), uid: space.uid, log: (l) => lines.push(l)})
      expect([...collected.blobs.keys()].sort()).toEqual([...space.store.keys()].sort())
      for (const [cid, data] of collected.blobs) expect(data).toEqual(space.store.get(cid)!)
      expect(collected.missing).toEqual([])
      expect(collected.documents).toEqual([
        {
          path: '',
          version: space.change.cid.toString(),
          genesis: space.genesis.cid.toString(),
          refs: [space.ref.cid.toString()],
        },
      ])
      expect(lines[0]).toBe('found   1 document')
      expect(lines.some((l) => l.startsWith('warning'))).toBe(false)
    })
  })

  test('leaves comments out on request', async () => {
    const space = await fakeSpace()
    await withFileServer(space.store, async () => {
      const collected = await collectSpaceBlobs({client: space.client(), uid: space.uid, comments: false})
      expect(collected.blobs.has(space.comment.cid.toString())).toBe(false)
      expect(collected.blobs.size).toBe(space.store.size - 1)
    })
  })

  test('still archives the changes, with a warning, on a server without ListRefs', async () => {
    const space = await fakeSpace()
    await withFileServer(space.store, async () => {
      const lines: string[] = []
      const client = space.client({
        ListRefs: () => {
          throw new Error('Unknown API method: ListRefs')
        },
      })
      const collected = await collectSpaceBlobs({client, uid: space.uid, log: (l) => lines.push(l)})
      expect(collected.documents[0]!.refs).toBeUndefined()
      expect(collected.blobs.has(space.ref.cid.toString())).toBe(false)
      expect(collected.blobs.has(space.change.cid.toString())).toBe(true)
      expect(collected.blobs.has(space.file.cid)).toBe(true)
      expect(lines.some((l) => l.startsWith('warning http://server does not list Refs'))).toBe(true)
    })
  })

  test('records what the server cannot return, or returns with the wrong bytes, as missing', async () => {
    const space = await fakeSpace()
    const gone = await cborBlob({type: 'Capability', ts: 7})
    const tampered = await cborBlob({type: 'Capability', ts: 8})
    space.store.set(tampered.cid.toString(), new Uint8Array([1, 2, 3]))
    await withFileServer(space.store, async () => {
      const client = space.client({
        ListCapabilities: () => ({
          capabilities: [
            {id: space.cap.cid.toString()},
            {id: gone.cid.toString()},
            {id: tampered.cid.toString()},
            {id: 'not-a-cid'},
          ],
        }),
      })
      const collected = await collectSpaceBlobs({client, uid: space.uid})
      expect(collected.missing.sort((a, b) => a.cid.localeCompare(b.cid))).toEqual(
        [
          {cid: gone.cid.toString(), reason: 'HTTP 404'},
          {cid: tampered.cid.toString(), reason: 'hash mismatch'},
          {cid: 'not-a-cid', reason: 'not a CID'},
        ].sort((a, b) => a.cid.localeCompare(b.cid)),
      )
      expect(collected.blobs.has(tampered.cid.toString())).toBe(false)
      expect(collected.blobs.size).toBe(6)
    })
  })
})

describe('archiveSpace (blobs) → readArchive → restoreBlobs', () => {
  test('round-trips every blob of the space in publish order', async () => {
    const space = await fakeSpace()
    const dir = tempDir('archive-roundtrip-')
    const out = join(dir, 'space.zip')
    const {manifest, bytes} = await withFileServer(space.store, () =>
      archiveSpace({client: space.client(), uid: space.uid, kind: 'blobs', out, workDir: dir}),
    )
    expect(bytes).toBeGreaterThan(0)
    expect(manifest.kind).toBe('blobs')
    expect(manifest.space).toBe(space.uid)
    expect(manifest.server).toBe('http://server')
    expect(manifest.missing).toEqual([])
    expect(manifest.blobs!.map((b) => b.type)).toEqual(['raw', 'Capability', 'Change', 'Change', 'Ref', 'Comment'])
    expect(manifest.blobs!.map((b) => b.cid)).toEqual([
      space.file.cid,
      space.cap.cid.toString(),
      space.genesis.cid.toString(),
      space.change.cid.toString(),
      space.ref.cid.toString(),
      space.comment.cid.toString(),
    ])

    const read = readArchive(out)
    expect(read.manifest).toEqual(manifest)
    expect([...read.files.keys()].sort()).toEqual(manifest.blobs!.map((b) => `blobs/${b.cid}`).sort())

    const batches: Array<Array<{cid: string}>> = []
    const target = {
      baseUrl: 'http://elsewhere',
      publish: async ({blobs}: {blobs: Array<{cid: string}>}) => {
        batches.push(blobs)
      },
    } as unknown as SeedClient
    const result = await restoreBlobs({client: target, manifest: read.manifest, files: read.files})
    expect(result.published).toBe(6)
    expect(batches.flat().map((b) => b.cid)).toEqual(manifest.blobs!.map((b) => b.cid))
  })
})
