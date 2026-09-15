/**
 * The web loader, one case per kind of address it can be asked to load.
 *
 * Every case checks the two things the client depends on: the id the loader hands back (the
 * route's identity, and whether a version is pinned onto it) and the resource query it dehydrates
 * for that id (what the page hydrates from). A loader that fetches the right document but
 * dehydrates the wrong id renders "Document Not Found" — the #1120 regression, which this file's
 * republish cases guard.
 *
 * The daemon is FakeDaemon from loaders.test-support.ts; the module mocks below route every
 * daemon surface the loader uses to it.
 */
import type {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId} from '@shm/shared'
import {HMNotFoundError, HMRedirectError} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {AUTHOR_UID, FakeDaemon, makeComment, makeDocument, OTHER_UID, SITE_UID} from './loaders.test-support'

const state = vi.hoisted(() => ({
  daemon: null as unknown as {
    fetch: (id: any) => unknown
    resolve: (id: any) => Promise<unknown>
    request: (name: string, input: any) => Promise<unknown>
    getDocument: (req: any) => Promise<unknown>
  },
  gateway: false,
  discoverDocument: null as unknown as (...args: unknown[]) => Promise<unknown>,
}))

vi.mock('./client.server', () => ({
  grpcClient: {documents: {getDocument: (req: unknown) => state.daemon.getDocument(req)}},
  transport: {},
  domainResolver: {},
}))
vi.mock('./server-universal-client', () => ({
  serverUniversalClient: {
    request: (name: string, input: unknown) => state.daemon.request(name, input),
    publish: async () => ({cids: []}),
  },
}))
vi.mock('@shm/shared/resource-loader', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createResourceFetcher: () => async (id: unknown) => state.daemon.fetch(id),
    createResourceResolver: () => async (id: unknown) => state.daemon.resolve(id),
  }
})
// The loader's getDocument runs the gRPC answer through prepareHMDocument; the fake daemon
// already speaks HMDocument.
vi.mock('@shm/shared/document-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {...actual, prepareHMDocument: (doc: unknown) => doc}
})
vi.mock('@shm/shared/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    get WEB_IS_GATEWAY() {
      return state.gateway
    },
  }
})
vi.mock('./utils/discovery', () => ({
  discoverDocument: (...args: unknown[]) => state.discoverDocument(...args),
}))
vi.mock('@shm/editor/ssr-render', () => ({renderDocumentToHTML: () => ''}))
vi.mock('@shm/editor/comment-editor', () => ({CommentEditor: () => null, HypermediaCommentEditor: () => null}))
// site-config.server reads DATA_DIR/config.json at import time and throws without one (CI).
vi.mock('./site-config.server', () => ({
  getConfig: async () => ({registeredAccountUid: SITE_UID}),
  getServiceConfig: async () => null,
  getHostnames: () => [],
}))

function entityQuery(
  payload: {dehydratedState?: {queries: Array<{queryKey: readonly unknown[]; state: {data: unknown}}>}},
  id: UnpackedHypermediaId,
) {
  const version = id.version || undefined
  const latest = id.latest || false
  return payload.dehydratedState?.queries.find(
    (q) =>
      q.queryKey[0] === queryKeys.ENTITY &&
      q.queryKey[1] === id.id &&
      q.queryKey[2] === version &&
      q.queryKey[3] === latest,
  )
}

async function load(id: UnpackedHypermediaId) {
  const {loadResource} = await import('./loaders')
  const {parseRequest} = await import('./request')
  const parsedRequest = parseRequest(new Request(`https://site.example/${id.path?.join('/') ?? ''}`))
  return loadResource(id, parsedRequest)
}

let daemon: FakeDaemon

beforeEach(() => {
  daemon = new FakeDaemon()
  state.daemon = daemon
  state.gateway = false
  state.discoverDocument = async () => null
})

describe('loadResource by route kind', () => {
  it('document at latest: pins the served version onto the route id and dehydrates it', async () => {
    const doc = makeDocument({uid: SITE_UID, path: ['guide'], version: 'v1'})
    daemon.putDocument(doc)
    const routeId = hmId(SITE_UID, {path: ['guide'], latest: true})

    const payload = await load(routeId)

    expect(payload.id).toMatchObject({uid: SITE_UID, path: ['guide'], version: 'v1', latest: false})
    expect(payload.isLatest).toBe(true)
    const entity = entityQuery(payload, payload.id)
    expect(entity, 'ENTITY query for the pinned route id').toBeDefined()
    expect((entity!.state.data as HMResource).type).toBe('document')
  })

  it('document at an older pinned version: keeps the pin and reports it is not the latest', async () => {
    daemon.putDocument(makeDocument({uid: SITE_UID, path: ['guide'], version: 'v1', name: 'Old'}))
    daemon.putDocument(makeDocument({uid: SITE_UID, path: ['guide'], version: 'v2', name: 'New'}))
    const routeId = hmId(SITE_UID, {path: ['guide'], version: 'v1', latest: false})

    const payload = await load(routeId)

    expect(payload.id).toMatchObject({version: 'v1', latest: false})
    expect(payload.document.metadata.name).toBe('Old')
    expect(payload.isLatest).toBe(false)
    expect((entityQuery(payload, payload.id)!.state.data as HMResource).type).toBe('document')
  })

  it('comment permalink: loads the target document and returns the comment id as the route id', async () => {
    const target = makeDocument({uid: SITE_UID, path: ['guide'], version: 'v1'})
    daemon.putDocument(target)
    const targetId = hmId(SITE_UID, {path: ['guide'], version: 'v1'})
    // A comment is addressed by its author and its own id, not by the document it targets.
    const commentId = hmId(AUTHOR_UID, {path: ['c1']})
    const comment = makeComment({id: `${AUTHOR_UID}/c1`, version: 'c1', author: AUTHOR_UID, target: targetId})
    daemon.put(commentId, {type: 'comment', id: commentId, comment})

    const payload = await load(commentId)

    expect(payload.id).toEqual(commentId)
    expect(payload.comment?.id).toBe(comment.id)
    expect(payload.document.version).toBe('v1')
  })

  it('move redirect: throws the redirect for the route to answer with a 302', async () => {
    const from = hmId(SITE_UID, {path: ['old'], latest: true})
    const to = hmId(SITE_UID, {path: ['new'], latest: true})
    daemon.putRedirect(from, to)
    daemon.putDocument(makeDocument({uid: SITE_UID, path: ['new'], version: 'v1'}))

    const error = await load(from).catch((e) => e)

    expect(error).toBeInstanceOf(HMRedirectError)
    expect((error as HMRedirectError).target).toMatchObject({uid: SITE_UID, path: ['new']})
    expect((error as HMRedirectError).republish).toBe(false)
  })

  it('republish: renders the target at the republish address, unpinned, with no not-found in the cache', async () => {
    const target = makeDocument({uid: OTHER_UID, path: ['2026', 'paper'], version: 'vT', name: 'The Paper'})
    daemon.putDocument(target)
    const routeId = hmId(SITE_UID, {path: ['paper'], latest: true})
    daemon.putRedirect(routeId, hmId(OTHER_UID, {path: ['2026', 'paper']}), {republish: true})

    const payload = await load(routeId)

    // The route keeps the republish's own address and never pins the target's version onto it.
    expect(payload.id).toMatchObject({uid: SITE_UID, path: ['paper']})
    expect(payload.id.version).toBeFalsy()
    expect(payload.document.metadata.name).toBe('The Paper')

    const entity = entityQuery(payload, routeId)
    expect(entity, 'ENTITY query for the republish route').toBeDefined()
    expect((entity!.state.data as HMResource).type).toBe('document')
    const notFound = payload.dehydratedState?.queries.filter(
      (q) =>
        q.queryKey[0] === queryKeys.ENTITY &&
        q.queryKey[1] === routeId.id &&
        (q.state.data as HMResource)?.type === 'not-found',
    )
    expect(notFound).toEqual([])
  })

  it('republish of a republish: follows the chain to the document with content', async () => {
    daemon.putDocument(makeDocument({uid: OTHER_UID, path: ['2026', 'paper'], version: 'vT', name: 'The Paper'}))
    const hop = hmId(SITE_UID, {path: ['pro', 'paper'], latest: true})
    daemon.putRedirect(hop, hmId(OTHER_UID, {path: ['2026', 'paper']}), {republish: true})
    const routeId = hmId(SITE_UID, {path: ['paper'], latest: true})
    daemon.putRedirect(routeId, hmId(SITE_UID, {path: ['pro', 'paper']}), {republish: true})

    const payload = await load(routeId)

    expect(payload.id).toMatchObject({uid: SITE_UID, path: ['paper']})
    expect(payload.id.version).toBeFalsy()
    expect(payload.document.metadata.name).toBe('The Paper')
    expect((entityQuery(payload, routeId)!.state.data as HMResource).type).toBe('document')
  })

  it('republish whose target this node does not hold: not found, so discovery can run', async () => {
    const routeId = hmId(SITE_UID, {path: ['paper'], latest: true})
    daemon.putRedirect(routeId, hmId(OTHER_UID, {path: ['2026', 'paper']}), {republish: true})

    await expect(load(routeId)).rejects.toBeInstanceOf(HMNotFoundError)
  })

  it('tombstone: fails loudly instead of rendering', async () => {
    const routeId = hmId(SITE_UID, {path: ['gone'], latest: true})
    daemon.put(routeId, {type: 'tombstone', id: routeId})

    await expect(load(routeId)).rejects.toThrow(/deleted/)
  })

  it('unknown address: not found', async () => {
    await expect(load(hmId(SITE_UID, {path: ['nope'], latest: true}))).rejects.toBeInstanceOf(HMNotFoundError)
  })
})

describe('loadResourceWithDiscovery', () => {
  it('on a gateway, never starts discovery from SSR: reports discovery pending', async () => {
    state.gateway = true
    const discover = vi.fn(async () => null)
    state.discoverDocument = discover
    const {loadResourceWithDiscovery, HMDiscoveryPendingError} = await import('./loaders')
    const {parseRequest} = await import('./request')
    const routeId = hmId(SITE_UID, {path: ['nope'], latest: true})

    await expect(
      loadResourceWithDiscovery(routeId, parseRequest(new Request('https://hyper.media/hm/x/nope'))),
    ).rejects.toBeInstanceOf(HMDiscoveryPendingError)
    expect(discover).not.toHaveBeenCalled()
  })

  it('on a site, discovers the document and loads it once it arrives', async () => {
    const routeId = hmId(SITE_UID, {path: ['late'], latest: true})
    const discover = vi.fn(async () => {
      daemon.putDocument(makeDocument({uid: SITE_UID, path: ['late'], version: 'v1', name: 'Arrived'}))
      return true
    })
    state.discoverDocument = discover
    const {loadResourceWithDiscovery} = await import('./loaders')
    const {parseRequest} = await import('./request')

    const payload = await loadResourceWithDiscovery(routeId, parseRequest(new Request('https://site.example/late')))

    expect(discover).toHaveBeenCalledTimes(1)
    expect(payload.document.metadata.name).toBe('Arrived')
  })
})

describe('hydration invariant', () => {
  it('logs loudly when the route resource would hydrate as something other than the loaded document', async () => {
    daemon.putDocument(makeDocument({uid: SITE_UID, path: ['guide'], version: 'v1'}))
    // The gRPC fetch serves the document, but the universal client (what the prefetch and the
    // browser use) reports the pinned id as not-found — the two surfaces disagree, which is
    // exactly the #1120 shape.
    daemon.request = async (name, input) =>
      name === 'Resource' ? {type: 'not-found', id: input as UnpackedHypermediaId} : null
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const payload = await load(hmId(SITE_UID, {path: ['guide'], latest: true}))

    // The page still gets its document; the log line is the signal.
    expect(payload.document.version).toBe('v1')
    const invariant = consoleError.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('INVARIANT'))
    expect(invariant, 'invariant log line').toBeDefined()
    expect(invariant![0]).toContain('would hydrate as "not-found"')
    expect(invariant![1]).toMatchObject({route: expect.stringContaining('/guide'), version: 'v1'})
    consoleError.mockRestore()
  })

  it('stays silent when the route resource hydrates as the loaded document', async () => {
    daemon.putDocument(makeDocument({uid: SITE_UID, path: ['guide'], version: 'v1'}))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await load(hmId(SITE_UID, {path: ['guide'], latest: true}))

    expect(consoleError.mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('INVARIANT'))).toEqual([])
    consoleError.mockRestore()
  })
})
