import {
  HMBlockNodeSchema,
  HMDocumentInfoSchema,
  HMDocumentSchema,
  type HMResourceDocument,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {DraftBreadcrumbContext} from '@shm/shared/draft-breadcrumb-context'
import {queryKeys} from '@shm/shared/models/query-keys'
import {UniversalAppProvider} from '@shm/shared/routing'
import type {UniversalClient} from '@shm/shared/universal-client'
import {hmId, latestId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'
import {SiteFileBrowser} from '../../src/site-file-browser'
import '../../src/theme.css'
import './sidebar.css'

const home = latestId(hmId('navigation-fixture'))
const guide = latestId(hmId(home.uid, {path: ['guides']}))
const installation = latestId(hmId(home.uid, {path: ['reference', 'install']}))
const archive = latestId(hmId(home.uid, {path: ['archive']}))
const hidden = latestId(hmId(home.uid, {path: ['hidden']}))

function page(id: UnpackedHypermediaId, name: string, links: string[] = []): HMResourceDocument {
  return {
    type: 'document',
    id,
    document: HMDocumentSchema.parse({
      account: id.uid,
      path: `/${id.path?.join('/') ?? ''}`,
      version: 'latest-version',
      metadata: {name},
      authors: [],
      genesis: 'fixture-genesis',
      visibility: 'PUBLIC',
      content: links.map((link, index) =>
        HMBlockNodeSchema.parse({
          block: {id: `card-${index}`, type: 'Embed', link, attributes: {view: 'Card'}},
        }),
      ),
    }),
  }
}

function createFixture() {
  const pages = new Map<string, HMResourceDocument>([
    [
      home.id,
      page(home, 'Field notes', [guide.id, `${installation.id}?v=old-version&l#old-block`, `${archive.id}?v=pinned`]),
    ],
    [guide.id, page(guide, 'Guides', [archive.id])],
    [installation.id, page(installation, 'Install Seed', [guide.id, home.id])],
    [archive.id, page(archive, 'Archive')],
    [hidden.id, page(hidden, 'Unlisted page')],
  ])
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}})
  const resourceRequests: UnpackedHypermediaId[] = []
  const queryRequests: string[] = []
  const client = {
    async request(key: string, request: unknown) {
      if (key === 'Resource') {
        const input = request as UnpackedHypermediaId
        resourceRequests.push(input)
        if (input.id === 'hm://navigation-fixture/old-install')
          return {type: 'redirect', id: input, redirectTarget: installation}
        return pages.get(input.id) ?? {type: 'not-found', id: input}
      }
      if (key === 'Query') {
        const {mode, path} = (request as {includes: [{mode: 'Children' | 'AllDescendants'; path: string}]}).includes[0]
        const parent = path ? path.slice(1).split('/') : []
        queryRequests.push(`${mode} /${parent.join('/')}`)
        return {
          in: home,
          results: Array.from(pages.values())
            .filter(({id}) => {
              const docPath = id.path ?? []
              if (!parent.every((part, index) => docPath[index] === part)) return false
              return mode === 'AllDescendants' ? docPath.length > parent.length : docPath.length === parent.length + 1
            })
            .map(({id, document}) =>
              HMDocumentInfoSchema.parse({
                type: 'document',
                id,
                path: id.path ?? [],
                metadata: document.metadata,
                authors: [],
                createTime: '',
                updateTime: '',
                sortTime: new Date(0),
                genesis: document.genesis,
                version: document.version,
                breadcrumbs: [],
                generationInfo: {genesis: document.genesis, generation: 1n},
                activitySummary: {latestChangeTime: '', latestCommentId: '', commentCount: 0, isUnread: false},
                visibility: 'PUBLIC',
              }),
            ),
        }
      }
      throw new Error(`Unexpected fixture request: ${key}`)
    },
  } as UniversalClient
  return {pages, queryClient, client, resourceRequests, queryRequests}
}

/** Browser regression fixture using the real resource and search directory queries. */
export function TestCardNavigation() {
  const [fixture] = useState(createFixture)
  const [active, setActive] = useState<UnpackedHypermediaId>(home)
  const [destination, setDestination] = useState('Home')
  const [searchVisible, setSearchVisible] = useState(false)
  const [published, setPublished] = useState(false)
  const [requests, setRequests] = useState('')
  const [directoryRequests, setDirectoryRequests] = useState('')
  function publish() {
    const next = page(home, 'Field notes', [archive.id, guide.id])
    fixture.pages.set(home.id, next)
    fixture.queryClient.setQueryData([queryKeys.ENTITY, home.id, undefined, true], next)
    setPublished(true)
  }
  function move() {
    const next = page(home, 'Field notes', ['hm://navigation-fixture/old-install'])
    fixture.pages.set(home.id, next)
    fixture.queryClient.setQueryData([queryKeys.ENTITY, home.id, undefined, true], next)
  }
  return (
    <QueryClientProvider client={fixture.queryClient}>
      <UniversalAppProvider
        universalClient={fixture.client}
        openUrl={() => {}}
        openRoute={(route) => {
          if ('id' in route && route.id) setDestination(`${route.key}: ${route.id.id}`)
        }}
      >
        <DraftBreadcrumbContext.Provider
          value={{
            useDraftsForAccount: () => ({
              data: [
                {
                  id: 'new-draft',
                  metadata: {name: 'Working draft'},
                  locationId: hidden,
                  editId: hmId(home.uid, {path: ['hidden', '-new-draft']}),
                  visibility: 'PUBLIC',
                } as never,
              ],
              isLoading: false,
            }),
          }}
        >
          <div className="sidebar-fixture">
            <aside aria-label="Document navigation" className="bg-background border-border border-r">
              <SiteFileBrowser
                siteId={home}
                activeDocumentId={active}
                showHeader
                searchVisible={searchVisible}
                onSearchVisibleChange={setSearchVisible}
                onNavigate={(id) => {
                  setActive(id)
                  setDestination(`${id.id} | latest=${id.latest ?? false} | version=${id.version ?? ''}`)
                }}
              />
            </aside>
            <main>
              <p className="fixture-eyebrow">FIELD NOTES</p>
              <h1>Document navigation</h1>
              <p>Published Cards connect these pages. Their paths stay in place.</p>
              <output aria-label="Navigation destination">{destination}</output>
              <button onClick={publish}>{published ? 'Home published' : 'Publish new Home version'}</button>
              <button onClick={move}>Link moved page</button>
              <button
                onClick={() => {
                  setRequests(JSON.stringify(fixture.resourceRequests))
                  setDirectoryRequests(JSON.stringify(fixture.queryRequests))
                }}
              >
                Inspect requests
              </button>
              <output aria-label="Resource requests">{requests}</output>
              <output aria-label="Directory requests">{directoryRequests}</output>
            </main>
          </div>
        </DraftBreadcrumbContext.Provider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}
