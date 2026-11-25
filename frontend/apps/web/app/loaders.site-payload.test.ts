/**
 * What the document route ships to the browser: the payload's document copy
 * carries no block content (the dehydrated resource query has it), and the
 * content HTML is only server-rendered when the page can show it.
 */
import type {HMDocument, HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {deserialize} from 'superjson'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const SITE_UID = 'z6MkhzAVoSfE62UVefmbwjvriGk8J2NMXPMwBukkZ3SU288d'
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
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

vi.mock('./client.server', () => ({
  grpcClient: {documents: {getDocument: async () => ({toJson: () => document})}},
  transport: {},
  domainResolver: {},
}))
vi.mock('./site-config.server', () => ({
  getConfig: async () => ({registeredAccountUid: SITE_UID}),
  getServiceConfig: async () => null,
  getHostnames: () => [],
}))
const renderDocumentToHTML = vi.hoisted(() => vi.fn(() => '<div class="ssr-content-placeholder">hello</div>'))
vi.mock('@shm/editor/ssr-render', () => ({renderDocumentToHTML}))
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

async function load(userAgent: string, viewTerm: string | null, opts: {withContent?: boolean} = {}) {
  const {loadSiteResource, loadSiteResourceWithContent} = await import('./loaders')
  const {parseRequest} = await import('./request')
  const parsedRequest = parseRequest(
    new Request(`https://example.com/notes${viewTerm ? `/:${viewTerm}` : ''}`, {headers: {'user-agent': userAgent}}),
  )
  const extra = {viewTerm, isInspect: false}
  const response = opts.withContent
    ? await loadSiteResourceWithContent(parsedRequest, docId, extra)
    : await loadSiteResource(parsedRequest, docId, extra)
  return deserialize<any>(await response.json())
}

describe('document route payload', () => {
  beforeEach(() => {
    renderDocumentToHTML.mockClear()
  })

  it('ships the document without its content; the dehydrated resource query carries it', async () => {
    const payload = await load(BROWSER_UA, null)
    expect(payload.document).not.toHaveProperty('content')
    expect(payload.document.version).toBe(document.version)
    expect(payload.document.metadata).toEqual(document.metadata)
    const entity = payload.dehydratedState.queries.find(
      (q: any) => q.queryKey[0] === queryKeys.ENTITY && q.queryKey[1] === packHmId({...docId, latest: false}),
    )
    expect(entity?.state.data.document.content).toEqual(document.content)
  })

  it('keeps the content in the payload for pages that render it from there', async () => {
    const payload = await load(BROWSER_UA, null, {withContent: true})
    expect(payload.document.content).toEqual(document.content)
  })

  it('renders the content HTML for the document view, for browsers and crawlers', async () => {
    for (const ua of [BROWSER_UA, BOT_UA]) {
      const payload = await load(ua, null)
      expect(payload.ssrContentHTML).toContain('ssr-content-placeholder')
    }
    expect(renderDocumentToHTML).toHaveBeenCalledTimes(2)
  })

  it('keeps rendering it on panel views for browsers, which can switch to the content view', async () => {
    const payload = await load(BROWSER_UA, 'activity')
    expect(payload.ssrContentHTML).toContain('ssr-content-placeholder')
    expect(renderDocumentToHTML).toHaveBeenCalledTimes(1)
  })

  it('skips it on panel views for crawlers, which never see it', async () => {
    for (const viewTerm of ['activity', 'comments', 'directory']) {
      const payload = await load(BOT_UA, viewTerm)
      expect(payload.ssrContentHTML).toBeNull()
      expect(payload.document.version).toBe(document.version)
    }
    expect(renderDocumentToHTML).not.toHaveBeenCalled()
  })
})
