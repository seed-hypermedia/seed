// @vitest-environment jsdom
import {
  HMDocumentSchema,
  HMBlockNodeSchema,
  type HMDocumentInfo,
  type HMResource,
} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SiteFileBrowser} from '../site-file-browser'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryMock = vi.hoisted(() => vi.fn())
const useDraftsMock = vi.hoisted(() => vi.fn())
const useResourceMock = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: useDirectoryMock,
  useResource: useResourceMock,
}))
vi.mock('@shm/shared/draft-breadcrumb-context', async () => ({
  ...(await vi.importActual<typeof import('@shm/shared/draft-breadcrumb-context')>(
    '@shm/shared/draft-breadcrumb-context',
  )),
  useDraftsForAccountSafe: useDraftsMock,
}))

if (typeof PointerEvent === 'undefined') vi.stubGlobal('PointerEvent', MouseEvent)
let container: HTMLDivElement
let root: Root
let resources: Map<string, HMResource>
let directory: HMDocumentInfo[]
const onNavigate = vi.fn()
const refetch = vi.fn()

function makeDoc(path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const id = hmId('site', {path})
  const document = HMDocumentSchema.parse({metadata: {name}, authors: [], genesis: 'genesis', visibility})
  resources.set(id.id, {type: 'document', id, document})
  return {id, path, metadata: {name}, visibility} as HMDocumentInfo
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

function setCards(parent: string, links: string[]) {
  const resource = resources.get(parent)
  if (resource?.type !== 'document') throw new Error(`Missing fixture ${parent}`)
  resource.document.content = links.map((link, index) =>
    HMBlockNodeSchema.parse({
      block: {id: `card-${index}`, type: 'Embed', link, attributes: {view: 'Card'}},
    }),
  )
}

function render(activeDocumentId: ReturnType<typeof hmId> | null = null) {
  act(() =>
    root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={activeDocumentId} onNavigate={onNavigate} />),
  )
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!button) throw new Error(`Missing button ${label}`)
  act(() => button.click())
}

beforeEach(() => {
  resources = new Map()
  makeDoc([], 'Home')
  makeDoc(['guides'], 'Guides')
  setDirectory({directory: [], drafts: []})
  useDirectoryMock.mockImplementation(listDirectory)
  useResourceMock.mockImplementation((id: ReturnType<typeof hmId>) => ({
    data: resources.get(id.id) ?? {type: 'not-found', id},
    isInitialLoading: false,
    isError: false,
    refetch,
  }))
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
  it('uses Card order instead of path order and does not include unembedded pages', () => {
    const alpha = makeDoc(['alpha'], 'Alpha')
    const zebra = makeDoc(['elsewhere', 'zebra'], 'Zebra')
    const hidden = makeDoc(['hidden'], 'Hidden')
    setDirectory({directory: [alpha, hidden, zebra], drafts: []})
    setCards('hm://site', [zebra.id.id, alpha.id.id])
    render()
    const buttons = Array.from(container.querySelectorAll('[role="treeitem"] > div > button:last-child'))
    expect(buttons.map((button) => button.textContent)).toEqual(['Zebra', 'Alpha'])
    expect(container.textContent).not.toContain('Hidden')
    expect(container.querySelector('a')).toBeNull()
  })

  it('reads and navigates latest versions even when the active page and a latest Card name a version', () => {
    makeDoc(['page'], 'Latest title')
    setCards('hm://site', ['hm://site/page?v=old&l#block'])
    render(hmId('site', {path: ['page'], version: 'old'}))
    expect(useResourceMock.mock.calls.every(([id]) => id.latest && !id.version && !id.blockRef)).toBe(true)
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain('Latest title')
    click('Latest title')
    expect(onNavigate).toHaveBeenCalledWith(latestId(hmId('site', {path: ['page']})))
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

  it('leaves Cards pinned to a version out of navigation', () => {
    makeDoc(['pinned'], 'Pinned page')
    setCards('hm://site', ['hm://site/pinned?v=old', 'hm://site/guides'])
    render()
    expect(container.textContent).not.toContain('Pinned page')
    expect(container.textContent).toContain('Guides')
    expect(useResourceMock.mock.calls.some(([id]) => id.id === 'hm://site/pinned')).toBe(false)
  })

  it('follows cross-path Cards lazily and stops cycles', () => {
    makeDoc(['group'], 'Group')
    makeDoc(['elsewhere', 'child'], 'Child')
    makeDoc(['deep'], 'Deep page')
    setCards('hm://site', ['hm://site/group'])
    setCards('hm://site/group', ['hm://site', 'hm://site/elsewhere/child'])
    setCards('hm://site/elsewhere/child', ['hm://site/group', 'hm://site/deep'])
    render()
    expect(useResourceMock.mock.calls.some(([id]) => id.id === 'hm://site/elsewhere/child')).toBe(false)
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Group"]')!.click())
    expect(container.textContent).toContain('Child')
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(2)
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Child"]')!.click())
    expect(container.textContent).toContain('Deep page')
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(3)
  })

  it('follows moved targets through the existing redirect resolver', () => {
    const moved = makeDoc(['new', 'page'], 'Moved page')
    resources.set('hm://site/old/page', resources.get(moved.id.id)!)
    setCards('hm://site', ['hm://site/old/page'])
    render(moved.id)
    click('Moved page')
    expect(onNavigate).toHaveBeenCalledWith(latestId(moved.id))
  })

  it('stops a moved address that resolves back to an ancestor', () => {
    resources.set('hm://site/old-home', resources.get('hm://site')!)
    setCards('hm://site', ['hm://site/old-home'])
    render()
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(0)
    expect(useResourceMock.mock.calls.filter(([id]) => id.id === 'hm://site/old-home')).toHaveLength(1)
  })

  it('follows Cards into another space', () => {
    const otherDoc = (path: string[], name: string, links: string[] = []) => {
      const id = hmId('other', {path})
      const document = HMDocumentSchema.parse({metadata: {name}, authors: [], genesis: 'other', visibility: 'PUBLIC'})
      document.content = links.map((link, index) =>
        HMBlockNodeSchema.parse({block: {id: `card-${index}`, type: 'Embed', link, attributes: {view: 'Card'}}}),
      )
      resources.set(id.id, {type: 'document', id, document})
      return id
    }
    const step = otherDoc(['guide', 'step'], 'Other step')
    const guide = otherDoc(['guide'], 'Other guide', [step.id])
    setCards('hm://site', [guide.id])
    render()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Expand Other guide"]')!.click())
    click('Other step')
    expect(onNavigate).toHaveBeenCalledWith(latestId(step))
  })

  it('does not subscribe sidebar rows in this or another space', () => {
    setCards('hm://site', ['hm://site/guides', 'hm://other/guide'])
    render()
    const ids = useResourceMock.mock.calls.map(([id]) => id.id)
    expect(ids).toEqual(expect.arrayContaining(['hm://site', 'hm://site/guides', 'hm://other/guide']))
    expect(useResourceMock.mock.calls.every(([, options]) => !options?.subscribed)).toBe(true)
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
    expect(onNavigate).toHaveBeenCalledWith(hmId('site', {path: ['unlinked', '-draft-1']}))
  })

  it('shows retry when navigation cannot be loaded', () => {
    resources.delete('hm://site')
    render()
    expect(container.textContent).toContain('Could not load navigation')
    expect(container.querySelector('a')).toBeNull()
    click('Retry')
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('shows loading rather than an empty sidebar while the root is loading', () => {
    useResourceMock.mockReturnValue({isInitialLoading: true})
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
    const collectionResource = resources.get(collection.id.id)!
    if (collectionResource.type === 'document')
      collectionResource.document.content = [
        HMBlockNodeSchema.parse({block: {id: 'query', type: 'Query', attributes: {}}}),
      ]
    const agent = makeDoc(['helper'], 'Helper')
    const resource = resources.get(agent.id.id)!
    if (resource.type === 'document') resource.document.metadata.type = 'hm://hyper.media/agent'
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
    act(() =>
      root.render(
        <SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={onNavigate} searchVisible />,
      ),
    )
    expect(useDirectoryMock.mock.calls.every(([id]) => id === null)).toBe(true)
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
    const onNavigate = vi.fn()
    const onPrefetch = vi.fn()
    setDirectory({
      directory: [makeDoc(['guides'], 'Guides'), install],
      drafts: [],
    })

    act(() => {
      root.render(
        <SiteFileBrowser
          siteId={hmId('site')}
          activeDocumentId={null}
          onNavigate={onNavigate}
          onPrefetch={onPrefetch}
          searchVisible
        />,
      )
    })
    const input = container.querySelector('input')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'INSTALL')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(container.textContent).not.toContain('Guides')
    const result = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Install Seed'),
    )!
    act(() => result.dispatchEvent(new MouseEvent('pointerover', {bubbles: true})))
    act(() => result.focus())
    expect(onPrefetch).toHaveBeenNthCalledWith(1, latestId(install.id))
    expect(onPrefetch).toHaveBeenNthCalledWith(2, latestId(install.id))
    act(() => result.click())
    expect(onNavigate).toHaveBeenCalledWith(latestId(install.id))
  })

  it('hides search by default and focuses it when revealed', () => {
    setDirectory({directory: [], drafts: []})
    const props = {siteId: hmId('site'), activeDocumentId: null, onNavigate: vi.fn()}

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
          onNavigate={vi.fn()}
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
          onNavigate={vi.fn()}
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
    const onNavigate = vi.fn()
    setDirectory({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [],
    })
    act(() =>
      root.render(
        <SiteFileBrowser
          siteId={hmId('site')}
          activeDocumentId={hmId('site', {path: ['guides']})}
          onNavigate={onNavigate}
          searchVisible
        />,
      ),
    )

    const input = container.querySelector<HTMLInputElement>('[aria-label="Filter documents"]')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'missing')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    const home = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Home')!
    expect(home).toBeTruthy()
    act(() => home.click())
    expect(onNavigate).toHaveBeenCalledWith(latestId(hmId('site')))
  })

  it('shows root creation actions only when a creation menu is provided', () => {
    setDirectory({directory: [], drafts: []})
    const createDocument = vi.fn()
    const props = {siteId: hmId('site'), activeDocumentId: null, onNavigate: vi.fn()}

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
          onNavigate={vi.fn()}
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
})
