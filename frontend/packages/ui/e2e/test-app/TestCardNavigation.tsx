import {HMDocumentInfoSchema, type HMDocumentInfo, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {DraftBreadcrumbContext} from '@shm/shared/draft-breadcrumb-context'
import {documentInfoQueryKey} from '@shm/shared/models/query-keys'
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
const oldInstall = latestId(hmId(home.uid, {path: ['old-install']}))

/** Document info as the indexer returns it, with the navigation Cards it derived from the published content. */
function info(id: UnpackedHypermediaId, name: string, navigationCards: string[] = [], extra: object = {}) {
  return HMDocumentInfoSchema.parse({
    type: 'document',
    id,
    path: id.path ?? [],
    metadata: {name},
    authors: [],
    createTime: '',
    updateTime: '',
    sortTime: new Date(0),
    genesis: 'fixture-genesis',
    version: 'latest-version',
    breadcrumbs: [],
    generationInfo: {genesis: 'fixture-genesis', generation: 1n},
    activitySummary: {latestChangeTime: '', latestCommentId: '', commentCount: 0, isUnread: false},
    navigationCards,
    visibility: 'PUBLIC',
    ...extra,
  })
}

function createFixture() {
  const pages = new Map<string, HMDocumentInfo>([
    [home.id, info(home, 'Field notes', [guide.id, installation.id])],
    [guide.id, info(guide, 'Guides', [archive.id])],
    [installation.id, info(installation, 'Install Seed', [guide.id, home.id])],
    [archive.id, info(archive, 'Archive')],
    [hidden.id, info(hidden, 'Unlisted page')],
    [oldInstall.id, info(oldInstall, '', [], {redirectInfo: {type: 'redirect', target: installation.id}})],
  ])
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}})
  const requests: string[] = []
  const queryRequests: string[] = []
  const client = {
    async request(key: string, request: unknown) {
      if (key === 'DocumentInfo') {
        const input = request as UnpackedHypermediaId
        requests.push(`${key} ${input.id}`)
        const found = pages.get(latestId(input).id)
        if (!found) throw new Error(`Not found: ${input.id}`)
        return found
      }
      if (key === 'Query') {
        const {mode, path} = (request as {includes: [{mode: 'Children' | 'AllDescendants'; path: string}]}).includes[0]
        const parent = path ? path.slice(1).split('/') : []
        queryRequests.push(`${mode} /${parent.join('/')}`)
        return {
          in: home,
          results: Array.from(pages.values()).filter(({id, redirectInfo}) => {
            const docPath = id.path ?? []
            if (redirectInfo || !parent.every((part, index) => docPath[index] === part)) return false
            return mode === 'AllDescendants' ? docPath.length > parent.length : docPath.length === parent.length + 1
          }),
        }
      }
      requests.push(key)
      throw new Error(`Unexpected fixture request: ${key}`)
    },
  } as UniversalClient
  return {pages, queryClient, client, requests, queryRequests}
}

/** Browser regression fixture using the real document info and search directory queries. */
export function TestCardNavigation() {
  const [fixture] = useState(createFixture)
  const [active, setActive] = useState<UnpackedHypermediaId>(home)
  const [destination, setDestination] = useState('Home')
  const [searchVisible, setSearchVisible] = useState(false)
  const [published, setPublished] = useState(false)
  const [requests, setRequests] = useState('')
  const [directoryRequests, setDirectoryRequests] = useState('')
  function setHomeCards(navigationCards: string[]) {
    const next = info(home, 'Field notes', navigationCards)
    fixture.pages.set(home.id, next)
    fixture.queryClient.setQueryData(documentInfoQueryKey(home.id), next)
  }
  function publish() {
    setHomeCards([archive.id, guide.id])
    setPublished(true)
  }
  return (
    <QueryClientProvider client={fixture.queryClient}>
      <UniversalAppProvider
        universalClient={fixture.client}
        openUrl={() => {}}
        openRoute={(route) => {
          if (!('id' in route) || !route.id) return
          const id = route.id
          setActive(id)
          setDestination(`${id.id} | latest=${id.latest ?? false} | version=${id.version ?? ''}`)
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
              />
            </aside>
            <main>
              <p className="fixture-eyebrow">FIELD NOTES</p>
              <h1>Document navigation</h1>
              <p>Published Cards connect these pages. Their paths stay in place.</p>
              <output aria-label="Navigation destination">{destination}</output>
              <button onClick={publish}>{published ? 'Home published' : 'Publish new Home version'}</button>
              <button onClick={() => setHomeCards([oldInstall.id])}>Link moved page</button>
              <button
                onClick={() => {
                  setRequests(JSON.stringify(fixture.requests))
                  setDirectoryRequests(JSON.stringify(fixture.queryRequests))
                }}
              >
                Inspect requests
              </button>
              <output aria-label="Info requests">{requests}</output>
              <output aria-label="Directory requests">{directoryRequests}</output>
            </main>
          </div>
        </DraftBreadcrumbContext.Provider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}
