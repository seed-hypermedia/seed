// @vitest-environment jsdom
import {useState} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CreateSpaceProvider} from '../create-space-context'
import {SiteSidebar} from '../site-sidebar'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const viewer = vi.hoisted(() => ({
  uid: 'own',
  desktop: false,
  joined: ['joined', 'joined', 'older', 'missing'],
  hasSpace: true,
}))
vi.mock('@shm/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get IS_DESKTOP() {
    return viewer.desktop
  },
}))
vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: () => ({data: undefined}),
  useSelectedAccountId: () => viewer.uid || null,
  useResource: (id?: {uid: string}) => ({
    data: id ? {type: id.uid === viewer.uid && !viewer.hasSpace ? 'not-found' : 'document'} : undefined,
    isFetching: false,
  }),
  useAccount: (uid: string) => ({data: {metadata: {name: uid}}}),
  useAccounts: (uids: string[]) => uids.map((uid) => ({data: {metadata: {name: uid}}})),
}))
vi.mock('@shm/shared/models/contacts', () => ({
  useSelectedAccountContacts: () => ({
    data: [
      ...viewer.joined.map((subject) => ({subject, subscribe: {site: true}})),
      {subject: 'person', subscribe: {profile: true}},
    ],
  }),
}))
vi.mock('../hm-icon', () => ({HMIcon: () => null}))
vi.mock('../site-file-browser', () => ({SiteFileBrowser: () => null}))

let queryClient: QueryClient
let activityOrder: string[]
let unread: Record<string, number>
let createSpace: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  activityOrder = []
  unread = {}
  viewer.uid = 'own'
  viewer.desktop = false
  viewer.joined = ['joined', 'joined', 'older', 'missing']
  viewer.hasSpace = true
  createSpace = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  HTMLElement.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  queryClient.clear()
})

function Page({isGateway = true, initialSite = 'current'}: {isGateway?: boolean; initialSite?: string}) {
  const [site, setSite] = useState(initialSite)
  return (
    <QueryClientProvider client={queryClient}>
      <UniversalAppProvider
        isGateway={isGateway}
        openRoute={() => {}}
        openUrl={() => {}}
        universalClient={
          {
            listAccounts: async ({pageToken}: {pageToken: string}) => ({
              accounts: (pageToken ? activityOrder.slice(1) : activityOrder.slice(0, 1)).map((id) => ({id})),
              nextPageToken: !pageToken && activityOrder.length > 1 ? 'next' : '',
            }),
          } as any
        }
      >
        <CreateSpaceProvider open={createSpace}>
          <SiteSidebar siteId={hmId(site)} unreadNotificationsBySite={unread} onNavigate={(id) => setSite(id.uid)}>
            <main>{site} home</main>
          </SiteSidebar>
        </CreateSpaceProvider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}
function openSelector() {
  act(() => root.render(<Page />))
  act(() =>
    container
      .querySelector('[aria-label="Select site"]')!
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
  )
}

describe('site selector', () => {
  it('offers to create a space instead of listing one the account does not have', () => {
    viewer.hasSpace = false
    openSelector()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(options.map((option) => option.textContent)).toEqual(['Create my space', 'joined', 'older', 'missing'])
    act(() => options[0]!.click())
    expect(createSpace).toHaveBeenCalledTimes(1)
    expect(container.querySelector('main')?.textContent).toBe('current home')
  })

  it('replaces the missing own space with a call to action', () => {
    viewer.hasSpace = false
    act(() => root.render(<Page initialSite="own" />))
    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('[aria-label="Select site"]')?.textContent).toContain('Select a space')
    const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === 'Create my space')
    act(() => button!.click())
    expect(createSpace).toHaveBeenCalledTimes(1)
  })

  it.each(['own', ''])('hides site switching on personal domains for viewer %s', (uid) => {
    viewer.uid = uid
    act(() => root.render(<Page isGateway={false} />))
    expect(container.querySelector('[aria-label="Select site"]')).toBeNull()
    expect(container.querySelector('main')?.textContent).toBe('current home')
    expect(container.textContent).toContain('Explore')
  })

  it('keeps site switching available in desktop even without a web gateway', () => {
    viewer.desktop = true
    act(() => root.render(<Page isGateway={false} />))
    expect(container.querySelector('[aria-label="Select site"]')).not.toBeNull()
  })

  it('includes the selected account and joined sites once and navigates to the selected home', () => {
    openSelector()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(options.map((option) => option.textContent)).toEqual(['own', 'joined', 'older', 'missing'])
    act(() => options.find((option) => option.textContent === 'joined')!.click())
    expect(container.querySelector('main')?.textContent).toBe('joined home')
    expect(container.querySelector('[aria-label="Select site"]')?.textContent).toBe('joined')
  })

  it('keeps the own space first, sorts joined spaces by latest activity, and keeps missing sites last', async () => {
    activityOrder = ['other-own', 'older', 'own', 'joined']
    openSelector()
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)).toEqual([
        'own',
        'older',
        'joined',
        'missing',
      ])
    })
    const groups = Array.from(document.querySelectorAll('[role="group"]'))
    expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual(['My Space', 'Joined Spaces'])
    expect(groups[0]?.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    expect(container.querySelector('[aria-label="Select site"]')?.textContent).toBe('current')
    act(() => (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click())
    expect(container.querySelector('main')?.textContent).toBe('older home')
    expect(container.querySelector('[aria-label="Select site"]')?.textContent).toBe('older')
  })

  it('updates membership when switching accounts and leaving sites', () => {
    openSelector()
    viewer.uid = 'other-own'
    viewer.joined = ['current']
    act(() => root.render(<Page />))
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(options.map((option) => option.textContent)).toEqual(['other-own', 'current'])
    expect(options[1]?.getAttribute('aria-current')).toBe('true')
    viewer.joined = []
    act(() => root.render(<Page />))
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)).toEqual([
      'other-own',
    ])
    expect(container.querySelector('[aria-label="Select site"]')?.textContent).toBe('current')
  })

  it('shows the own site only once when it is also joined', () => {
    viewer.joined = ['own', 'own']
    openSelector()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(options.map((option) => option.textContent)).toEqual(['own'])
    act(() => options[0]!.click())
    expect(container.querySelector('main')?.textContent).toBe('own home')
  })

  it('clears a site notification indicator when its unread count is cleared', () => {
    unread = {joined: 2}
    openSelector()
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('2 unread notifications')
    unread = {}
    act(() => root.render(<Page />))
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('unread notifications')
  })

  it('shows no sites when signed out, even with cached contacts', () => {
    viewer.uid = ''
    unread = {current: 3}
    openSelector()
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((option) => option.textContent)).toEqual([])
  })
})
