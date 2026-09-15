/**
 * Regression test for republished documents on web.
 *
 * A republish is a redirect record at the site's own address that points at a document on
 * another site. The loader renders the target's content at the republish's address. The
 * target's version must NOT be pinned onto the republish's id: that address has no such
 * version, so the daemon reports not-found for the SSR prefetch and for every client refetch,
 * and the page shows "Document Not Found" even though the document is listed on the site.
 */
import type {HMDocument, HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const SITE_UID = 'z6MkhzAVoSfE62UVefmbwjvriGk8J2NMXPMwBukkZ3SU288d'
const SOURCE_UID = 'z6MkjtdhPwB2jbdp6V8mn8oobZycbqqEuP6nXouN12EZN4Wa'
const TARGET_VERSION = 'bafyreihidr5nobvaafvnfw6sglwla23wszutzqhaow5bblaxijreowpmjm'

const republishId = hmId(SITE_UID, {path: ['3800935.3830834'], latest: true})
const targetId = hmId(SOURCE_UID, {path: ['2026', '3800935.3830834']})

const targetDocument = {
  account: SOURCE_UID,
  path: '/2026/3800935.3830834',
  version: TARGET_VERSION,
  authors: [SOURCE_UID],
  metadata: {name: 'Republished paper'},
  content: [],
  createTime: '2026-09-01T00:00:00Z',
  updateTime: '2026-09-01T00:00:00Z',
  genesis: 'bafygenesis',
  generationInfo: {generator: 'test', genesis: 'bafygenesis', version: TARGET_VERSION},
} as unknown as HMDocument

// The daemon's answers: the site address is a republish redirect; the target is a document.
function daemonResource(id: UnpackedHypermediaId): HMResource {
  if (id.uid === SITE_UID && id.path?.join('/') === '3800935.3830834') {
    if (id.version) {
      // The target's version does not exist at the republish's address.
      return {type: 'not-found', id}
    }
    return {type: 'redirect', id, redirectTarget: targetId, republish: true}
  }
  if (id.uid === SOURCE_UID) {
    return {type: 'document', id, document: targetDocument}
  }
  return {type: 'not-found', id}
}

vi.mock('./client.server', () => ({grpcClient: {}, transport: {}, domainResolver: {}}))
// site-config.server reads DATA_DIR/config.json at import time and throws without one (CI).
vi.mock('./site-config.server', () => ({
  getConfig: async () => ({registeredAccountUid: SITE_UID}),
  getServiceConfig: async () => null,
  getHostnames: () => [],
}))
vi.mock('@shm/editor/ssr-render', () => ({renderDocumentToHTML: () => ''}))
vi.mock('@shm/editor/comment-editor', () => ({CommentEditor: () => null, HypermediaCommentEditor: () => null}))
vi.mock('@shm/shared/resource-loader', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createResourceFetcher: () => async (id: UnpackedHypermediaId) => daemonResource(id),
    createResourceResolver: () => async (id: UnpackedHypermediaId) => {
      let current = id
      for (let hop = 0; hop < 5; hop++) {
        const res = daemonResource(current)
        if (res.type === 'redirect') {
          current = res.redirectTarget
          continue
        }
        return res
      }
      throw new Error('too many hops')
    },
  }
})

const universalRequest = vi.fn()
vi.mock('./server-universal-client', () => ({
  serverUniversalClient: {
    request: (...args: unknown[]) => universalRequest(...args),
    publish: async () => ({cids: []}),
  },
}))

describe('loadResource for a republished document', () => {
  beforeEach(() => {
    universalRequest.mockReset()
    universalRequest.mockImplementation(async (name: string, id: UnpackedHypermediaId) => {
      if (name === 'Resource') return daemonResource(id)
      return null
    })
  })

  it('keeps the republish address unpinned and hydrates it with the target document', async () => {
    const {loadResource} = await import('./loaders')
    const {parseRequest} = await import('./request')
    const parsedRequest = parseRequest(new Request('https://ht26.hyper.media/3800935.3830834'))

    const payload = await loadResource(republishId, parsedRequest)

    // The route id stays the republish's own address without the target's version.
    expect(payload.id.uid).toBe(SITE_UID)
    expect(payload.id.path).toEqual(['3800935.3830834'])
    expect(payload.id.version).toBeFalsy()
    expect(payload.document.version).toBe(TARGET_VERSION)

    // The dehydrated resource query the client reads for this route holds the target document.
    const entityQuery = payload.dehydratedState?.queries.find(
      (q) => q.queryKey[0] === queryKeys.ENTITY && q.queryKey[1] === packHmId(republishId),
    )
    expect(entityQuery, 'ENTITY query for the republish route').toBeDefined()
    const data = entityQuery!.state.data as HMResource
    expect(data.type).toBe('document')
    expect(data.type === 'document' && data.document.version).toBe(TARGET_VERSION)

    // No dehydrated query for this route resolves as not-found.
    const notFound = payload.dehydratedState?.queries.filter(
      (q) =>
        q.queryKey[0] === queryKeys.ENTITY &&
        q.queryKey[1] === packHmId(republishId) &&
        (q.state.data as HMResource | null)?.type === 'not-found',
    )
    expect(notFound).toEqual([])

    // Nothing asked the daemon for the target's version at the republish's address.
    const pinnedRequests = universalRequest.mock.calls.filter(
      ([name, id]) => name === 'Resource' && id.uid === SITE_UID && id.version === TARGET_VERSION,
    )
    expect(pinnedRequests).toEqual([])
  })
})
