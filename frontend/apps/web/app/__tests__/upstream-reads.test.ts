import {Code, ConnectError} from '@connectrpc/connect'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const request = vi.fn()
const createSeedClient = vi.fn((_baseUrl: string) => ({request}))
vi.mock('@seed-hypermedia/client', () => ({createSeedClient: (url: string) => createSeedClient(url)}))

const EXTERNAL = 'z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB'
const LOCAL = 'z6MkpqwQYZ8vYQsDUUqXL7zwixaVHR27fWvTihS8gbdYxXJY'

/** A gRPC client whose daemon knows only LOCAL. */
function fakeGrpc() {
  return {
    documents: {
      getAccount: vi.fn(async ({id}: {id: string}) => {
        if (id === LOCAL) return {id}
        throw new ConnectError(`account ${id} is not found`, Code.NotFound)
      }),
    },
  } as any
}

const upstreamDocument = {
  type: 'document',
  id: {id: `hm://${EXTERNAL}/agent/guide`, uid: EXTERNAL, path: ['agent', 'guide']},
  document: {content: [], metadata: {name: 'Agent Guide'}},
}

async function load(upstreamUrl: string | undefined) {
  vi.resetModules()
  if (upstreamUrl === undefined) delete process.env.SEED_UPSTREAM_API_URL
  else process.env.SEED_UPSTREAM_API_URL = upstreamUrl
  return await import('../upstream-reads.server')
}

describe('withUpstreamFallback', () => {
  beforeEach(() => {
    request.mockReset()
    createSeedClient.mockClear()
    request.mockImplementation(async () => upstreamDocument)
  })
  afterEach(() => {
    delete process.env.SEED_UPSTREAM_API_URL
  })

  it('answers a not-found read of an unknown space from the upstream node', async () => {
    const {withUpstreamFallback} = await load('https://hyper.media/')
    const input = {id: `hm://${EXTERNAL}/agent/guide`, uid: EXTERNAL, path: ['agent', 'guide']}
    const out: any = await withUpstreamFallback('Resource', input, {type: 'not-found', id: input}, fakeGrpc())
    expect(out.type).toBe('document')
    expect(createSeedClient).toHaveBeenCalledWith('https://hyper.media')
    expect(request.mock.calls[0]![0]).toBe('Resource')
  })

  it('never sends a read of a space the daemon has upstream', async () => {
    const {withUpstreamFallback} = await load('https://hyper.media')
    const input = {id: `hm://${LOCAL}/secret`, uid: LOCAL, path: ['secret']}
    const notFound = {type: 'not-found', id: input}
    expect(await withUpstreamFallback('Resource', input, notFound, fakeGrpc())).toBe(notFound)
    expect(request).not.toHaveBeenCalled()
  })

  it('stays local when the daemon cannot say whether it knows the space', async () => {
    const {withUpstreamFallback} = await load('https://hyper.media')
    const grpc = {documents: {getAccount: vi.fn(async () => Promise.reject(new Error('connection refused')))}} as any
    const notFound = {type: 'not-found'}
    expect(await withUpstreamFallback('Resource', {uid: EXTERNAL}, notFound, grpc)).toBe(notFound)
    expect(request).not.toHaveBeenCalled()
  })

  it('is off without SEED_UPSTREAM_API_URL, and leaves found results and other keys alone', async () => {
    const off = await load(undefined)
    const notFound = {type: 'not-found'}
    expect(await off.withUpstreamFallback('Resource', {uid: EXTERNAL}, notFound, fakeGrpc())).toBe(notFound)
    const on = await load('https://hyper.media')
    const found = {type: 'document'}
    expect(await on.withUpstreamFallback('Resource', {uid: EXTERNAL}, found, fakeGrpc())).toBe(found)
    const comments = {comments: []}
    expect(await on.withUpstreamFallback('ListComments', {targetId: EXTERNAL}, comments, fakeGrpc())).toBe(comments)
    expect(request).not.toHaveBeenCalled()
  })

  it('falls back for a directory listing of one unknown space, not for a mix with a local one', async () => {
    const {withUpstreamFallback} = await load('https://hyper.media')
    request.mockImplementation(async () => ({results: [{id: 'x'}]}))
    const empty = {results: []}
    const one = {includes: [{space: EXTERNAL, path: '', mode: 'Children'}]}
    expect(await withUpstreamFallback('Query', one, empty, fakeGrpc())).toEqual({results: [{id: 'x'}]})
    const mixed = {
      includes: [
        {space: EXTERNAL, path: ''},
        {space: LOCAL, path: ''},
      ],
    }
    expect(await withUpstreamFallback('Query', mixed, empty, fakeGrpc())).toBe(empty)
  })

  it('keeps the local answer when the upstream fails or does not have it either', async () => {
    const {withUpstreamFallback} = await load('https://hyper.media')
    request.mockImplementation(async () => Promise.reject(new Error('HTTP 500')))
    const notFound = {type: 'account-not-found', uid: EXTERNAL}
    expect(await withUpstreamFallback('Account', EXTERNAL, notFound, fakeGrpc())).toBe(notFound)
  })
})
