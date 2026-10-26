/**
 * A comment permalink (/doc/:comments/<author>/<tsid>) whose document is here
 * but whose comment is not: a gateway hands the comment's own IRI to the
 * client-driven discovery shim, a site searches for it before rendering.
 */
import type {HMDocument, HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {Code, ConnectError} from '@connectrpc/connect'
import {hmId} from '@shm/shared'
import {deserialize} from 'superjson'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const SITE_UID = 'z6MkhzAVoSfE62UVefmbwjvriGk8J2NMXPMwBukkZ3SU288d'
const AUTHOR_UID = 'z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4'
const TSID = 'z6KChthu3YwVxv'
const COMMENT_ID = `${AUTHOR_UID}/${TSID}`
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

const document = {
  account: SITE_UID,
  path: '/notes',
  version: 'bafy-notes-v1',
  authors: [SITE_UID],
  metadata: {name: 'Notes'},
  content: [{block: {id: 'b1', type: 'Paragraph', text: 'hello', annotations: [], attributes: {}}, children: []}],
  createTime: '2026-09-01T00:00:00Z',
  updateTime: '2026-09-01T00:00:00Z',
  genesis: 'bafy-genesis',
  visibility: 'PUBLIC',
} as unknown as HMDocument

function daemonResource(id: UnpackedHypermediaId): HMResource {
  if (id.uid === SITE_UID) return {type: 'document', id, document}
  return {type: 'not-found', id}
}

const getComment = vi.hoisted(() => vi.fn())
const discoverDocument = vi.hoisted(() => vi.fn())

vi.mock('./client.server', () => ({
  grpcClient: {documents: {getDocument: async () => ({toJson: () => document})}, comments: {getComment}},
  transport: {},
  domainResolver: {},
}))
vi.mock('./site-config.server', () => ({
  getConfig: async () => ({registeredAccountUid: SITE_UID}),
  getServiceConfig: async () => null,
  getHostnames: () => [],
}))
vi.mock('./utils/discovery', () => ({discoverDocument, discoverMedia: vi.fn()}))
vi.mock('@shm/editor/ssr-render', () => ({renderDocumentToHTML: () => '<div>hello</div>'}))
vi.mock('@shm/editor/comment-editor', () => ({CommentEditor: () => null, HypermediaCommentEditor: () => null}))
vi.mock('@shm/shared/resource-loader', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createResourceFetcher: () => async (id: UnpackedHypermediaId) => daemonResource(id),
    createResourceResolver: () => async (id: UnpackedHypermediaId) => daemonResource(id),
  }
})
vi.mock('./server-universal-client', () => ({
  serverUniversalClient: {
    request: async (name: string, id: UnpackedHypermediaId) => (name === 'Resource' ? daemonResource(id) : null),
    publish: async () => ({cids: []}),
  },
}))

const docId = hmId(SITE_UID, {path: ['notes'], latest: true})

async function loadCommentPermalink(isGateway: boolean) {
  vi.doMock('@shm/shared/constants', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, WEB_IS_GATEWAY: isGateway}
  })
  const {loadSiteResource} = await import('./loaders')
  const {parseRequest} = await import('./request')
  const parsedRequest = parseRequest(
    new Request(`https://example.com/notes/:comments/${COMMENT_ID}`, {headers: {'user-agent': BROWSER_UA}}),
  )
  const response = await loadSiteResource(parsedRequest, docId, {
    viewTerm: 'comments',
    openComment: COMMENT_ID,
    commentVersion: null,
    isInspect: false,
  })
  return {status: response.status, payload: deserialize<any>(await response.json())}
}

describe('comment permalink with a missing comment', () => {
  beforeEach(() => {
    vi.resetModules()
    getComment.mockReset()
    discoverDocument.mockReset()
    getComment.mockRejectedValue(new ConnectError('comment not found', Code.NotFound))
  })

  it('on a gateway, asks the client shim to discover the comment by its own IRI', async () => {
    const {status, payload} = await loadCommentPermalink(true)
    expect(status).toBe(404)
    expect(payload.discoveryPending).toBe(true)
    expect(payload.id.uid).toBe(AUTHOR_UID)
    expect(payload.id.path).toEqual([TSID])
    expect(payload.id.latest).toBe(true)
    expect(discoverDocument).not.toHaveBeenCalled()
  })

  it('on a site, searches the network for the comment and still renders the document', async () => {
    discoverDocument.mockResolvedValue(null)
    const {status, payload} = await loadCommentPermalink(false)
    expect(discoverDocument).toHaveBeenCalledWith(AUTHOR_UID, [TSID], undefined, true)
    expect(status).toBe(200)
    expect(payload.discoveryPending).toBeUndefined()
    expect(payload.document.version).toBe(document.version)
    expect(payload.comment).toBeUndefined()
  })
})
