import {decode as cborDecode} from '@ipld/dag-cbor'
import {createDocumentBlobs} from '@seed-hypermedia/client/create-document'
import type {HMDocument, HMSigner} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {base58btc} from 'multiformats/bases/base58'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {useAppsPublisher} from '../apps/publish'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

/** A signer with a fixed key and a deterministic signature: enough to build blobs with. */
function makeSigner(seed: number): HMSigner & {accountId: string} {
  const publicKey = new Uint8Array(34)
  publicKey[0] = 0xed
  publicKey[1] = 0x01
  for (let i = 2; i < 34; i++) publicKey[i] = (i * seed) & 0xff
  return {
    accountId: base58btc.encode(publicKey),
    getPublicKey: async () => publicKey,
    sign: async (data: Uint8Array) => {
      const sig = new Uint8Array(64)
      for (let i = 0; i < 64; i++) sig[i] = data[i % data.length]! ^ (i & 0xff)
      return sig
    },
  }
}

const mocks = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  account: '',
  hostChange: [] as unknown[],
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => mocks.client,
  useUniversalAppContext: () => ({}),
}))
vi.mock('@shm/shared/use-stream', () => ({useStream: () => mocks.account}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: vi.fn()}))
// The change that lists a child on its host is built from the host as the node holds it. Here the
// node is absent, so that one step answers with a marked blob, and its ops are kept to look at.
vi.mock('@seed-hypermedia/client/apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seed-hypermedia/client/apps')>()),
  createDocumentUpdateBlobs: async ({ops}: {ops: unknown[]}) => {
    mocks.hostChange = ops
    return {changed: true, blobs: [{cid: 'host-change', data: new Uint8Array([1])}]}
  },
}))

// The publisher is a hook with nothing to show: it is rendered once, without a DOM, to get hold of
// it. The blobs it builds are bytes, which a DOM test environment hands over in another realm.
let publisher: ReturnType<typeof useAppsPublisher>
function Probe() {
  publisher = useAppsPublisher()
  return null
}

const alice = makeSigner(1)
const bob = makeSigner(3)
const appId = hmId(alice.accountId, {path: ['weather']})
const sourceId = hmId(bob.accountId, {path: ['tools', 'convert']})
const app = {id: appId, document: {metadata: {name: 'Weather'}, content: []} as unknown as HMDocument}

let published: {cid: string; data: Uint8Array}[]
let taken: Set<string>
let source: {genesis: string; version: string}

beforeEach(async () => {
  const created = await createDocumentBlobs(bob, {
    space: bob.accountId,
    path: '/tools/convert',
    ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'convert'}]}],
  })
  source = {genesis: created.genesis, version: created.version}
  published = []
  taken = new Set()
  mocks.account = alice.accountId
  mocks.hostChange = []
  mocks.client = {
    getSigner: () => alice,
    publish: async ({blobs}: {blobs: {cid: string; data: Uint8Array}[]}) => {
      published.push(...blobs)
    },
    request: async (key: string, input: {id: string}) => {
      if (key !== 'Resource') throw new Error(`unexpected request ${key}`)
      if (input.id === sourceId.id)
        return {
          type: 'document',
          document: {metadata: {name: 'convert'}, genesis: source.genesis, version: source.version, content: []},
        }
      return taken.has(input.id) ? {type: 'document', document: {metadata: {}}} : {type: 'not-found'}
    },
  }
  renderToStaticMarkup(<Probe />)
})

/** The Ref among what was published: the blob that puts a version at a path. */
function publishedRef() {
  const refs = published
    .filter((blob) => blob.cid !== 'host-change')
    .map((blob) => cborDecode(blob.data) as Record<string, unknown>)
    .filter((value) => value.type === 'Ref')
  expect(refs).toHaveLength(1)
  return refs[0]!
}

describe('copying a document into an app', () => {
  it('puts the version that was read at a path under the app, and lists it there in the same publish', async () => {
    const copy = await publisher.copyInto(app, sourceId)
    expect(copy).toMatchObject({uid: alice.accountId, path: ['weather', 'convert']})

    const ref = publishedRef()
    expect(ref.path).toBe('/weather/convert')
    // The copy is in the signer's own space, which a Ref leaves out.
    expect(ref.space).toBeUndefined()
    // It starts as the source's version, under the source's genesis.
    expect((ref.heads as {toString(): string}[]).map(String)).toEqual([source.version])
    expect(String(ref.genesisBlob)).toBe(source.genesis)

    // The app's list gets the copy's card, published with it.
    expect(published.map((blob) => blob.cid)).toContain('host-change')
    expect(JSON.stringify(mocks.hostChange)).toContain(copy.id)
  })

  it('adds a number to the name when the app already has a document by it', async () => {
    taken.add(hmId(alice.accountId, {path: ['weather', 'convert']}).id)
    const copy = await publisher.copyInto(app, sourceId)
    expect(copy.path).toEqual(['weather', 'convert-2'])
    expect(publishedRef().path).toBe('/weather/convert-2')
  })
})
