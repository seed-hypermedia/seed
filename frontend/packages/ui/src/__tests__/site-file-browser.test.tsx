// @vitest-environment jsdom
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {UniversalAppContext} from '@shm/shared/routing'
import {useContext, type ReactNode} from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SiteFileBrowser} from '../site-file-browser'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryMock = vi.hoisted(() => vi.fn())
const useDraftsMock = vi.hoisted(() => vi.fn())
const useDocumentInfoMock = vi.hoisted(() => vi.fn())
const useNavRouteOrNullMock = vi.hoisted(() => vi.fn(() => null))
/** Domain-based IDs and the account IDs they resolve to. */
const domains = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: useDirectoryMock,
  useDocumentInfo: useDocumentInfoMock,
  useResolvedHmId: (url: string | undefined) => ({
    id: url ? domains.get(url) ?? null : null,
    isLoading: false,
    error: null,
  }),
}))
vi.mock('@shm/shared/draft-breadcrumb-context', async () => ({
  ...(await vi.importActual<typeof import('@shm/shared/draft-breadcrumb-context')>(
    '@shm/shared/draft-breadcrumb-context',
  )),
  useDraftsForAccountSafe: useDraftsMock,
}))
vi.mock('@shm/shared/utils/navigation', async () => ({
  ...(await vi.importActual<typeof import('@shm/shared/utils/navigation')>('@shm/shared/utils/navigation')),
  useNavRouteOrNull: useNavRouteOrNullMock,
}))

if (typeof PointerEvent === 'undefined') vi.stubGlobal('PointerEvent', MouseEvent)
let container: HTMLDivElement
let root: Root
/** Indexed document info by ID. An ID without an entry fails to load, as an unknown document does. */
let infos: Map<string, HMDocumentInfo>
let directory: HMDocumentInfo[]
const openRoute = vi.fn()
function Routing({children}: {children: ReactNode}) {
  const context = useContext(UniversalAppContext)
  return (
    <UniversalAppContext.Provider value={{...context, originHomeId: hmId('site'), openRoute}}>
      {children}
    </UniversalAppContext.Provider>
  )
}
const refetchInfo = vi.fn()

/** Indexes a document's info, with the navigation Cards the backend derives, and returns it. */
function makeDoc(
  path: string[],
  name: string,
  visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC',
  {space = 'site', navigationCards = []}: {space?: string; navigationCards?: string[]} = {},
) {
  const id = hmId(space, {path})
  const info = {id, path, metadata: {name}, visibility, navigationCards} as unknown as HMDocumentInfo
  infos.set(id.id, info)
  return info
}

/** Indexes a redirect from one address to another, as a moved or republished document leaves behind. */
function redirect(from: string, to: string, republish = false) {
  const id = hmId('site', {path: from.split('/').slice(3)})
  infos.set(id.id, {
    id,
    path: id.path,
    metadata: {},
    visibility: 'PUBLIC',
    redirectInfo: {type: 'redirect', target: to, republish},
  } as unknown as HMDocumentInfo)
}

/** Sets the published documents title search can find, and the local drafts. */
function setDirectory({directory: docs, drafts}: {directory: HMDocumentInfo[]; drafts: unknown[]}) {
  directory = docs
  useDraftsMock.mockReturnValue({data: drafts, isLoading: false})
}

/** The space-wide listing used only by title search. */
function listDirectory(id: ReturnType<typeof hmId> | null) {
  return {data: id ? directory.filter((doc) => doc.id.uid === id.uid) : undefined, isInitialLoading: false}
}

/** Sets the navigation Cards the backend derived for a document. */
function setCards(parent: string, links: string[]) {
  const info = infos.get(parent)
  if (!info) throw new Error(`Missing fixture ${parent}`)
  infos.set(parent, {...info, navigationCards: links})
}

function render(activeDocumentId: ReturnType<typeof hmId> | null = null) {
  act(() =>
    root.render(
      <Routing>
        <SiteFileBrowser siteId={hmId('site')} activeDocumentId={activeDocumentId} />
      </Routing>,
    ),
  )
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLElement>('button, a')).find((b) => b.textContent === label)
  if (!button) throw new Error(`Missing button ${label}`)
  act(() => button.click())
}

beforeEach(() => {
  domains.clear()
  infos = new Map()
  makeDoc([], 'Home')
  makeDoc(['guides'], 'Guides')
  setDirectory({directory: [], drafts: []})
  useDirectoryMock.mockImplementation(listDirectory)
  useDocumentInfoMock.mockImplementation((id: ReturnType<typeof hmId>) => {
    const info = infos.get(hmId(id.uid, {path: id.path}).id)
    return {data: info, isInitialLoading: false, isError: !info, refetch: refetchInfo}
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('SiteFileBrowser', () => {
  it('builds navigation from indexed Cards', () => {
    makeDoc([], 'Home', 'PUBLIC', {navigationCards: ['hm://site/zebra', 'hm://site/alpha']})
    makeDoc(['zebra'], 'Zebra', 'PUBLIC', {navigationCards: ['hm://site/zebra/child']})
    makeDoc(['alpha'], 'Alpha')
    makeDoc(['zebra', 'child'], 'Child')
    render(hmId('site', {path: ['zebra', 'child']}))
    const links = Array.from(container.querySelectorAll('[role="treeitem"] > div > a'))
    expect(links.map((link) => link.textContent)).toEqual(['Zebra', 'Child', 'Alpha'])
  })

  it('resolves a domain-based Card target before loading it', () => {
    setCards('hm://site', ['hm://example.com/guides', 'hm://unknown.example/page'])
    domains.set('hm://example.com/guides', hmId('site', {path: ['guides']}))
    render()
    expect(container.textContent).toContain('Guides')
    expect(container.textContent).toContain('Could not resolve hm://unknown.example/page.')
    const queried = useDocumentInfoMock.mock.calls.flatMap(([id]) => (id ? [id.uid] : []))
    expect(queried.some((uid) => uid.includes('.'))).toBe(false)
  })

  it('uses Card order instead of path order and does not include unembedded pages', () => {
    const alpha = makeDoc(['alpha'], 'Alpha')
    const zebra = makeDoc(['elsewhere', 'zebra'], 'Zebra')
    const hidden = makeDoc(['hidden'], 'Hidden')
    setDirectory({directory: [alpha, hidden, zebra], drafts: []})
    setCards('hm://site', [zebra.id.id, alpha.id.id])
    render()
    const links = Array.from(container.querySelectorAll('[role="treeitem"] > div > a'))
    expect(links.map((link) => link.textContent)).toEqual(['Zebra', 'Alpha'])
    expect(container.textContent).not.toContain('Hidden')
  })

  it('reads and navigates latest versions even when the active page names a version', () => {
    makeDoc(['page'], 'Latest title')
    setCards('hm://site', ['hm://site/page'])
    render(hmId('site', {path: ['page'], version: 'old'}))
    expect(useDocumentInfoMock.mock.calls.every(([id]) => !id.version && !id.blockRef)).toBe(true)
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain('Latest title')
    click('Latest title')
    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: latestId(hmId('site', {path: ['page']}))}, undefined)
  })

  it('does not overlay unpublished edits on published navigation', () => {
    const guide = makeDoc(['guides'], 'Published guide')
    setDirectory({
      directory: [guide],
      drafts: [{id: 'edit', editId: guide.id, metadata: {name: 'Draft title'}}],
    })
    setCards('hm://site', [guide.id.id])
    render()
    expect(container.textContent).toContain('Published guide')
    expect(container.textContent).not.toContain('Draft title')
  })

  it('updates navigation when the latest published parent changes', () => {
    makeDoc(['new'], 'New page')
    setCards('hm://site', ['hm://site/guides'])
    render()
    expect(container.textContent).toContain('Guides')
    setCards('hm://site', ['hm://site/new'])
    render()
    expect(container.textContent).toContain('New page')
    expect(container.textContent).not.toContain('Guides')
  })

  it('follows cross-path Cards lazily and stops cycles', () => {
    makeDoc(['group'], 'Group')
    makeDoc(['elsewhere', 'child'], 'Child')
    makeDoc(['deep'], 'Deep page')
    setCards('hm://site', ['hm://site/group'])
    setCards('hm://site/group', ['hm://site', 'hm://site/elsewhere/child'])
    setCards('hm://site/elsewhere/child', ['hm://site/group', 'hm://site/deep'])
    render()
    expect(useDocumentInfoMock.mock.calls.some(([id]) => id.id === 'hm://site/elsewhere/child')).toBe(false)
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Group"]')!.click())
    expect(container.textContent).toContain('Child')
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2)
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Child"]')!.click())
    expect(container.textContent).toContain('Deep page')
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(3)
  })

  it('opens the target of a moved Card and shows its Cards', () => {
    const moved = makeDoc(['new', 'page'], 'Moved page', 'PUBLIC', {navigationCards: ['hm://site/guides']})
    redirect('hm://site/old/page', moved.id.id)
    setCards('hm://site', ['hm://site/old/page'])
    render(hmId('site', {path: ['old', 'page']}))
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Moved page')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Moved page"]')!.click())
    expect(container.textContent).toContain('Guides')
    click('Moved page')
    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: latestId(moved.id)}, undefined)
  })

  it('keeps a republished Card on its own address while showing the target', () => {
    const target = makeDoc(['target'], 'Target page', 'PUBLIC', {navigationCards: ['hm://site/guides']})
    redirect('hm://site/republished', target.id.id, true)
    setCards('hm://site', ['hm://site/republished'])
    render()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Target page"]')!.click())
    expect(container.textContent).toContain('Guides')
    click('Target page')
    expect(openRoute).toHaveBeenCalledWith(
      {key: 'document', id: latestId(hmId('site', {path: ['republished']}))},
      undefined,
    )
  })

  it('follows redirect chains and gives up on cycles', () => {
    makeDoc(['final'], 'Final page')
    redirect('hm://site/first', 'hm://site/second')
    redirect('hm://site/second', 'hm://site/final')
    redirect('hm://site/loop-a', 'hm://site/loop-b')
    redirect('hm://site/loop-b', 'hm://site/loop-a')
    setCards('hm://site', ['hm://site/first', 'hm://site/loop-a'])
    render()
    expect(container.textContent).toContain('Final page')
    expect(container.textContent).toContain('Could not load page.')
  })

  it('stops a moved address that resolves back to an ancestor', () => {
    redirect('hm://site/old-home', 'hm://site')
    setCards('hm://site', ['hm://site/old-home'])
    render()
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(0)
  })

  it('follows Cards into another space', () => {
    const step = makeDoc(['guide', 'step'], 'Other step', 'PUBLIC', {space: 'other'})
    const guide = makeDoc(['guide'], 'Other guide', 'PUBLIC', {space: 'other', navigationCards: [step.id.id]})
    setCards('hm://site', [guide.id.id])
    render()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Other guide"]')!.click())
    click('Other step')
    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: latestId(step.id)}, undefined)
  })

  it('shows retry for a Card target without document info', () => {
    setCards('hm://site', ['hm://site/guides', 'hm://other/guide'])
    render()
    expect(container.textContent).toContain('Guides')
    expect(container.textContent).toContain('Could not load page.')
  })

  it('keeps unlinked unpublished drafts accessible without creating path-tree entries', () => {
    setDirectory({
      directory: [],
      drafts: [
        {
          id: 'draft-1',
          locationId: hmId('site', {path: ['unlinked']}),
          editId: hmId('site', {path: ['unlinked', '-draft-1']}),
          metadata: {name: 'New draft'},
        },
        {id: 'draft-2', locationId: hmId('site'), metadata: {}},
      ],
    })
    render()
    expect(container.querySelector('[aria-label="Unpublished drafts"]')?.textContent).toContain('New draft')
    expect(container.textContent).toContain('Untitled Document')
    expect(container.textContent).not.toContain('-draft-2')
    click('New draft')
    expect(openRoute).toHaveBeenCalledWith(
      {key: 'document', id: hmId('site', {path: ['unlinked', '-draft-1']})},
      undefined,
    )
  })

  it('shows retry when navigation cannot be loaded', () => {
    infos.delete('hm://site')
    render()
    expect(container.textContent).toContain('Could not load navigation')
    expect(container.querySelector('[role="treeitem"]')).toBeNull()
    click('Retry')
    expect(refetchInfo).toHaveBeenCalledOnce()
  })

  it('shows loading rather than an empty sidebar while the root is loading', () => {
    useDocumentInfoMock.mockReturnValue({isInitialLoading: true})
    render()
    expect(container.querySelector('[aria-label="Loading navigation"]')).not.toBeNull()
    expect(container.textContent).not.toContain('No pages in navigation')
  })

  it('marks Home active only when the home document is selected', () => {
    render()
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
    render(hmId('site'))
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Home')
  })

  it('preserves document kinds and private indicators', () => {
    const collection = makeDoc(['collection'], 'Collection')
    collection.isCollection = true
    const agent = makeDoc(['helper'], 'Helper')
    agent.metadata.type = 'hm://hyper.media/agent'
    const privatePage = makeDoc(['private'], 'Private', 'PRIVATE')
    setDirectory({
      directory: [collection, agent, privatePage],
      drafts: [],
    })
    setCards('hm://site', [collection.id.id, agent.id.id, privatePage.id.id])
    render()
    expect(container.querySelector('[aria-label="Collection"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Agent"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Private document"]')).not.toBeNull()
  })

  it('expands a row whose Card target is the active page', () => {
    makeDoc(['group'], 'Group')
    const child = makeDoc(['elsewhere', 'child'], 'Child')
    setCards('hm://site', ['hm://site/group'])
    setCards('hm://site/group', [child.id.id])
    render(child.id)
    expect(container.querySelector('[aria-label="Collapse Group"]')).not.toBeNull()
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Child')
  })

  it('reads the space listing only while searching', () => {
    setCards('hm://site', ['hm://site/guides'])
    act(() => root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} searchVisible />))
    // The All documents count always fetches with siteId; the search query uses null until typing.
    expect(useDirectoryMock.mock.calls.some(([id]) => id !== null)).toBe(true)
    const input = container.querySelector('input')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'guides')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(useDirectoryMock).toHaveBeenLastCalledWith(hmId('site'), {mode: 'AllDescendants'})
  })

  it('shows title matches as a flat list and navigates', () => {
    const install = makeDoc(['guides', 'install'], 'Install Seed')
    install.id = hmId('site', {path: ['guides', 'install'], version: 'listed-version', latest: false})
    const onPrefetch = vi.fn()
    setDirectory({
      directory: [makeDoc(['guides'], 'Guides'), install],
      drafts: [],
    })

    act(() => {
      root.render(
        <Routing>
          <SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onPrefetch={onPrefetch} searchVisible />
        </Routing>,
      )
    })
    const input = container.querySelector('input')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'INSTALL')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(container.textContent).not.toContain('Guides')
    const result = Array.from(container.querySelectorAll('a')).find(
      (link) => link.textContent?.includes('Install Seed'),
    )!
    act(() => result.dispatchEvent(new MouseEvent('pointerover', {bubbles: true})))
    act(() => result.focus())
    expect(onPrefetch).toHaveBeenNthCalledWith(1, latestId(install.id))
    expect(onPrefetch).toHaveBeenNthCalledWith(2, latestId(install.id))
    act(() => result.click())
    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: latestId(install.id)}, undefined)
  })

  it('hides search by default and focuses it when revealed', () => {
    setDirectory({directory: [], drafts: []})
    const props = {siteId: hmId('site'), activeDocumentId: null}

    act(() => root.render(<SiteFileBrowser {...props} />))
    expect(container.querySelector('[aria-label="Filter documents"]')).toBeNull()

    act(() => root.render(<SiteFileBrowser {...props} searchVisible />))
    expect(container.querySelector('[aria-label="Filter documents"]')).toBe(document.activeElement)
  })

  it('clears and closes document filtering from the input', () => {
    setDirectory({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [],
    })
    setCards('hm://site', ['hm://site/guides'])
    const onSearchVisibleChange = vi.fn()
    act(() =>
      root.render(
        <SiteFileBrowser
          siteId={hmId('site')}
          activeDocumentId={null}
          searchVisible
          onSearchVisibleChange={onSearchVisibleChange}
        />,
      ),
    )

    const input = container.querySelector<HTMLInputElement>('[aria-label="Filter documents"]')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'missing')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(container.textContent).toContain('No documents found')

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close document search"]')?.click())

    expect(onSearchVisibleChange).toHaveBeenCalledWith(false)
    expect(container.textContent).toContain('Guides')
  })

  it('closes document filtering with Escape while the input is focused', () => {
    setDirectory({directory: [], drafts: []})
    const onSearchVisibleChange = vi.fn()
    act(() =>
      root.render(
        <SiteFileBrowser
          siteId={hmId('site')}
          activeDocumentId={null}
          searchVisible
          onSearchVisibleChange={onSearchVisibleChange}
        />,
      ),
    )

    const input = container.querySelector<HTMLInputElement>('[aria-label="Filter documents"]')!
    const escapeEvent = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})
    act(() => input.dispatchEvent(escapeEvent))

    expect(onSearchVisibleChange).toHaveBeenCalledWith(false)
    expect(escapeEvent.defaultPrevented).toBe(true)
  })

  it('keeps Home above filtered documents and navigates to the site root', () => {
    setDirectory({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [],
    })
    act(() =>
      root.render(
        <Routing>
          <SiteFileBrowser siteId={hmId('site')} activeDocumentId={hmId('site', {path: ['guides']})} searchVisible />
        </Routing>,
      ),
    )

    const input = container.querySelector<HTMLInputElement>('[aria-label="Filter documents"]')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'missing')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const home = Array.from(container.querySelectorAll('a')).find((link) => link.textContent === 'Home')!
    expect(home).toBeTruthy()
    act(() => home.click())
    expect(openRoute).toHaveBeenCalledWith({key: 'document', id: latestId(hmId('site'))}, undefined)
  })

  it('shows root creation actions only when a creation menu is provided', () => {
    setDirectory({directory: [], drafts: []})
    const createDocument = vi.fn()
    const props = {siteId: hmId('site'), activeDocumentId: null}

    act(() => root.render(<SiteFileBrowser {...props} />))
    expect(container.querySelector('[aria-label="Create root document"]')).toBeNull()

    act(() =>
      root.render(
        <SiteFileBrowser
          {...props}
          createMenuItem={{
            key: 'new',
            label: 'New',
            icon: null,
            children: [
              {key: 'new-document', label: 'Document', icon: null, onClick: createDocument},
              {key: 'new-document-collection', label: 'Collection', icon: null, onClick: vi.fn()},
              {key: 'new-private-document', label: 'Private', icon: null, onClick: vi.fn()},
            ],
          }}
        />,
      ),
    )
    expect(container.querySelector('[aria-label="Create root document"]')).toBeTruthy()
  })

  it('offers Agent from the root creation menu when the New menu has it', () => {
    setDirectory({directory: [], drafts: []})
    const createAgent = vi.fn()
    act(() =>
      root.render(
        <SiteFileBrowser
          siteId={hmId('site')}
          activeDocumentId={null}
          createMenuItem={{
            key: 'new',
            label: 'New',
            icon: null,
            children: [
              {key: 'new-document', label: 'Document', icon: null, onClick: vi.fn()},
              {key: 'new-agent', label: 'Agent', icon: null, onClick: createAgent},
              {key: 'import', label: 'Import', icon: null, onClick: vi.fn()},
            ],
          }}
        />,
      ),
    )
    const trigger = container.querySelector('[aria-label="Create root document"]') as HTMLElement
    act(() => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0}))
    })
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim())
    expect(items).toEqual(['Document', 'Agent'])
    act(() => (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click())
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('renders the All documents entry with a count', () => {
    setDirectory({directory: [makeDoc(['a'], 'A'), makeDoc(['b'], 'B')], drafts: []})
    render()
    const entry = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('All documents'))
    expect(entry).toBeTruthy()
    expect(entry?.getAttribute('href')).toContain(':all-documents')
    expect(entry?.textContent).toContain('2')
  })

  it('sidebar count excludes the home doc and drafts of published docs', () => {
    // Home doc (empty path) + two published docs + a draft editing an already-published doc + a new draft
    setDirectory({
      directory: [makeDoc([], 'Home'), makeDoc(['a'], 'A'), makeDoc(['b'], 'B')],
      drafts: [
        {
          id: 'draft-edit',
          locationId: hmId('site', {path: ['a']}),
          editId: hmId('site', {path: ['a']}),
          metadata: {name: 'A (edited)'},
        },
        {
          id: 'draft-new',
          locationId: hmId('site', {path: []}),
          editId: hmId('site', {path: ['-draft-new']}),
          metadata: {name: 'New draft'},
        },
      ],
    })
    render()
    const entry = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('All documents'))
    // Count = 2 published (A, B) + 1 new draft (draft-new) = 3
    // Home excluded; draft-edit (editing published A) excluded because it's not a placeholder path
    expect(entry?.textContent).toContain('3')
  })

  it('highlights All documents and not Home when on the all-documents route', () => {
    useNavRouteOrNullMock.mockReturnValue({key: 'all-documents', id: hmId('site')} as never)
    render()
    const allDocumentsEntry = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.includes('All documents'),
    )
    expect(allDocumentsEntry?.getAttribute('aria-current')).toBe('page')
    const homeEntry = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.trim() === 'Home')
    expect(homeEntry?.getAttribute('aria-current')).toBeNull()
  })
})
