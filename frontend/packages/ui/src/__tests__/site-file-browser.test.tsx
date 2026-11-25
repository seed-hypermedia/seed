// @vitest-environment jsdom
import type {HMDocumentInfo, HMListedDraft} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {DocumentActionsProvider, type DocumentActionsContextValue} from '@shm/shared/document-actions-context'
import {latestId} from '@shm/shared/utils/entity-id-url'
import type {ReactNode} from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SiteFileBrowser} from '../site-file-browser'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryWithDraftsMock = vi.hoisted(() => vi.fn())
const useUnreferencedDocumentsMock = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/models/entity', () => ({useDirectoryWithDrafts: useDirectoryWithDraftsMock}))
vi.mock('@shm/shared/models/capabilities', () => ({
  roleCanWrite: () => true,
  useSelectedAccountCapability: () => ({id: '_owner', accountUid: 'site', role: 'owner'}),
}))
vi.mock('@shm/shared/models/unreferenced-documents', () => ({
  useUnreferencedDocuments: useUnreferencedDocumentsMock,
}))
vi.mock('../tooltip', () => ({
  Tooltip: ({content, children}: {content: string; children: ReactNode}) => (
    <span data-tooltip-content={content}>{children}</span>
  ),
}))

if (typeof PointerEvent === 'undefined') {
  vi.stubGlobal('PointerEvent', MouseEvent)
}

let container: HTMLDivElement
let root: Root

function makeDoc(path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  return {id: hmId('site', {path}), path, metadata: {name}, visibility} as unknown as HMDocumentInfo
}

function makeCollection(path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const doc = makeDoc(path, name, visibility)
  doc.isCollection = true
  return doc
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useUnreferencedDocumentsMock.mockReturnValue({documents: [], isLoading: false, indexIncomplete: false})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('SiteFileBrowser', () => {
  it('marks Home active only when the home document is selected', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: [], drafts: [], isLoading: false})
    const props = {siteId: hmId('site'), onNavigate: vi.fn()}
    act(() => root.render(<SiteFileBrowser {...props} activeDocumentId={null} />))
    expect(container.querySelector('[aria-current="page"]')).toBeNull()
    act(() => root.render(<SiteFileBrowser {...props} activeDocumentId={hmId('site')} />))
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Home')
  })

  it('does not load or render unreferenced documents', () => {
    const install = makeDoc(['guides', 'install'], 'Install Seed', 'PRIVATE')
    useDirectoryWithDraftsMock.mockReturnValue({directory: [install], drafts: [], isLoading: false})
    useUnreferencedDocumentsMock.mockReturnValue({documents: [install], isLoading: false, indexIncomplete: false})

    act(() => root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />))

    expect(useUnreferencedDocumentsMock).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Unreferenced documents"]')).toBeNull()
  })
  it('keeps published metadata when an editing draft has no title override', () => {
    const published = makeDoc(['guides'], 'Published guide')
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [published],
      drafts: [
        {
          id: 'draft-1',
          metadata: {},
          editId: published.id,
        } as unknown as HMListedDraft,
      ],
      isLoading: false,
    })

    act(() => {
      root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />)
    })

    expect(container.textContent).toContain('Published guide')
    expect(container.textContent).not.toContain('Untitled Document')
  })

  it('renders unpublished drafts in their parent directory', () => {
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [
        {
          id: 'draft-1',
          metadata: {name: 'Unpublished guide'},
          locationId: hmId('site', {path: ['guides']}),
          editId: hmId('site', {path: ['guides', '-draft-1']}),
        } as unknown as HMListedDraft,
      ],
      isLoading: false,
    })

    act(() => {
      root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />)
    })

    act(() => (container.querySelector('[aria-label="Expand Guides"]') as HTMLButtonElement).click())

    const draftRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Unpublished guide'),
    )
    expect(draftRow?.querySelector('[aria-label="Unpublished draft"]')?.getAttribute('class')).toContain(
      'text-yellow-500',
    )
  })

  it('labels an unnamed unpublished draft Untitled Document instead of its placeholder slug', () => {
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [
        {
          id: 'draft-2',
          metadata: {},
          locationId: hmId('site', {path: ['guides']}),
          editId: hmId('site', {path: ['guides', '-draft-2']}),
        } as unknown as HMListedDraft,
      ],
      isLoading: false,
    })

    act(() => {
      root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />)
    })
    act(() => (container.querySelector('[aria-label="Expand Guides"]') as HTMLButtonElement).click())

    const labels = Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '')
    expect(labels.some((label) => label.includes('Untitled Document'))).toBe(true)
    expect(labels.some((label) => label.includes('-draft-2'))).toBe(false)
  })

  it('marks collections with a grid icon instead of a private icon', () => {
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [
        makeCollection(['collections'], 'Collections'),
        makeCollection(['private'], 'Private', 'PRIVATE'),
        makeDoc(['document'], 'Document'),
      ],
      drafts: [],
      isLoading: false,
    })

    act(() => {
      root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />)
    })

    expect(container.querySelectorAll('[aria-label="Collection"]')).toHaveLength(2)
    expect(container.querySelector('[aria-label="Private document"]')).toBeNull()
    expect(container.querySelector('[aria-label="Document"]')).toBeTruthy()
  })

  it('marks mounted agents with an agent icon', () => {
    const agent = makeDoc(['helper'], 'Helper')
    agent.metadata = {name: 'Helper', type: 'hm://hyper.media/agent'}
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [agent, makeCollection(['collections'], 'Collections'), makeDoc(['document'], 'Document')],
      drafts: [],
      isLoading: false,
    })

    act(() => {
      root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />)
    })

    expect(container.querySelectorAll('[aria-label="Agent"]')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-label="Collection"]')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-label="Document"]')).toHaveLength(1)
  })

  it('reveals the active document and marks private rows', () => {
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [makeDoc(['guides'], 'Guides'), makeDoc(['guides', 'private'], 'Private guide', 'PRIVATE')],
      drafts: [],
      isLoading: false,
    })

    act(() => {
      root.render(
        <SiteFileBrowser
          siteId={hmId('site')}
          activeDocumentId={hmId('site', {path: ['guides', 'private']})}
          onNavigate={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('Private guide')
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Private document"]')).toBeTruthy()
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain('Private guide')
  })

  it('shows title matches as a flat list and navigates', () => {
    const install = makeDoc(['guides', 'install'], 'Install Seed')
    install.id = hmId('site', {path: ['guides', 'install'], version: 'listed-version', latest: false})
    const onNavigate = vi.fn()
    const onPrefetch = vi.fn()
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [makeDoc(['guides'], 'Guides'), install],
      drafts: [],
      isLoading: false,
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
    useDirectoryWithDraftsMock.mockReturnValue({directory: [], drafts: [], isLoading: false})
    const props = {siteId: hmId('site'), activeDocumentId: null, onNavigate: vi.fn()}

    act(() => root.render(<SiteFileBrowser {...props} />))
    expect(container.querySelector('[aria-label="Filter documents"]')).toBeNull()

    act(() => root.render(<SiteFileBrowser {...props} searchVisible />))
    expect(container.querySelector('[aria-label="Filter documents"]')).toBe(document.activeElement)
  })

  it('clears and closes document filtering from the input', () => {
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [],
      isLoading: false,
    })
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
    useDirectoryWithDraftsMock.mockReturnValue({directory: [], drafts: [], isLoading: false})
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
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [makeDoc(['guides'], 'Guides')],
      drafts: [],
      isLoading: false,
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
    expect(onNavigate).toHaveBeenCalledWith(hmId('site'))
  })

  it('shows root creation actions only when a creation menu is provided', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: [], drafts: [], isLoading: false})
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
    useDirectoryWithDraftsMock.mockReturnValue({directory: [], drafts: [], isLoading: false})
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

// Pins must live in the same browser as the sidebar's document tree.
describe('sidebar pins', () => {
  const pin = {siteUid: 'site', path: ['guide'], title: 'Saved guide', seenVersion: 'v1', createdAt: '2026-01-01'}
  const guide = {...makeDoc(['guide'], 'Guide'), version: 'v2'}

  function renderBrowser(
    actions: DocumentActionsContextValue,
    props: Partial<React.ComponentProps<typeof SiteFileBrowser>> = {},
  ) {
    act(() =>
      root.render(
        <DocumentActionsProvider {...actions}>
          <SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} {...props} />
        </DocumentActionsProvider>,
      ),
    )
  }

  it('pins a published tree row without navigating and excludes unpublished drafts', () => {
    useDirectoryWithDraftsMock.mockReturnValue({
      directory: [guide],
      drafts: [{id: 'draft', metadata: {name: 'Draft'}, locationId: hmId('site')}],
      isLoading: false,
    })
    const pinDocument = vi.fn()
    const onNavigate = vi.fn()
    renderBrowser({pinDocument}, {onNavigate})
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Pin Guide"]')
    expect(button).not.toBeNull()
    act(() => button!.click())
    expect(pinDocument).toHaveBeenCalledWith(latestId(guide.id), 'Guide', 'v2')
    expect(onNavigate).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Pin Draft"]')).toBeNull()
  })

  it('shows compact pins above the tree and opens the latest document', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: [guide], drafts: [], isLoading: false})
    const getPinsForSite = vi.fn(() => [pin])
    const onNavigate = vi.fn()
    renderBrowser({getPinsForSite}, {onNavigate})
    const section = container.querySelector('[aria-label="Pinned documents"]')!
    expect(section).not.toBeNull()
    expect(section.compareDocumentPosition(container.querySelector('[aria-label="Space documents"]')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(section.querySelector('[aria-label="Document updated"]')).not.toBeNull()
    act(() =>
      Array.from(section.querySelectorAll('button'))
        .find((b) => b.textContent === 'Guide')!
        .click(),
    )
    expect(onNavigate).toHaveBeenCalledWith(latestId(guide.id))
    expect(getPinsForSite).toHaveBeenCalledWith('site')
  })

  it('does not mark pins missing while the directory is unavailable', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: undefined, drafts: [], isLoading: false})
    renderBrowser({getPinsForSite: () => [pin]})
    expect(container.textContent).toContain('Saved guide')
    expect(container.querySelector('[aria-label="Document unavailable"]')).toBeNull()
  })

  it('retains the saved title for missing documents and supports collapsing pins', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: [], drafts: [], isLoading: false})
    renderBrowser({getPinsForSite: () => [pin], unpinDocument: vi.fn()})
    expect(container.querySelector('[aria-label="Document unavailable"]')).not.toBeNull()
    const heading = container.querySelector<HTMLButtonElement>('[aria-label="Collapse pinned documents"]')!
    expect(heading).not.toBeNull()
    act(() => heading.click())
    expect(container.textContent).not.toContain('Saved guide')
    expect(container.querySelector('[aria-label="Expand pinned documents"]')).not.toBeNull()
  })

  it('hides pins while filtering and scopes pins to the selected site', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: [guide], drafts: [], isLoading: false})
    const getPinsForSite = (uid: string) => (uid === 'site' ? [pin] : [])
    renderBrowser({getPinsForSite}, {searchVisible: true})
    const input = container.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Guide')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(container.querySelector('[aria-label="Pinned documents"]')).toBeNull()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(container.querySelector('[aria-label="Pinned documents"]')).not.toBeNull()
    renderBrowser({getPinsForSite}, {siteId: hmId('other')})
    expect(container.querySelector('[aria-label="Pinned documents"]')).toBeNull()
  })

  it('separates personal pins from the tree and supports keyboard ordering', () => {
    useDirectoryWithDraftsMock.mockReturnValue({directory: [guide], drafts: [], isLoading: false})
    const movePin = vi.fn()
    const onNavigate = vi.fn()
    renderBrowser({getPinsForSite: () => [pin, {...pin, path: ['notes'], title: 'Notes'}], movePin}, {onNavigate})
    expect(container.querySelector('[data-slot="separator"]')).not.toBeNull()
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Guide"]')
    expect(handle).not.toBeNull()
    act(() => handle!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', altKey: true, bubbles: true})))
    expect(movePin).toHaveBeenCalledWith('site', 0, 1)
    expect(onNavigate).not.toHaveBeenCalled()
    movePin.mockClear()
    act(() => handle!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', altKey: true, bubbles: true})))
    expect(movePin).not.toHaveBeenCalled()
  })

  it('reorders with native drag events, ignores outside drops, and keeps navigation separate', () => {
    const notes = {...makeDoc(['notes'], 'Notes'), version: 'v1'}
    useDirectoryWithDraftsMock.mockReturnValue({directory: [guide, notes], drafts: [], isLoading: false})
    const movePin = vi.fn()
    const onNavigate = vi.fn()
    renderBrowser({getPinsForSite: () => [pin, {...pin, path: ['notes'], title: 'Notes'}], movePin}, {onNavigate})
    const source = container.querySelector<HTMLElement>('[data-pin-id="site:guide"]')!
    const target = container.querySelector<HTMLElement>('[data-pin-id="site:notes"]')!
    const handle = source.querySelector('[aria-label="Reorder Guide"]')!
    const data = new Map<string, string>()
    const dataTransfer = {
      setData: (key: string, value: string) => data.set(key, value),
      getData: (key: string) => data.get(key),
      types: [],
      setDragImage: vi.fn(),
    }
    const hitTest = vi.fn(() => [handle])
    const original = document.elementsFromPoint
    document.elementsFromPoint = hitTest
    const dragEvent = (element: Element, type: string, y = 10) => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: 10, clientY: y})
      Object.defineProperty(event, 'dataTransfer', {value: dataTransfer})
      act(() => element.dispatchEvent(event))
    }
    try {
      dragEvent(source, 'dragstart')
      dragEvent(target, 'dragenter')
      expect(target.querySelector('[data-drop-edge="after"]')).not.toBeNull()
      dragEvent(target, 'drop')
      dragEvent(source, 'dragend')
      expect(movePin).toHaveBeenCalledWith('site', 0, 1)
      expect(target.querySelector('[data-drop-edge]')).toBeNull()
      expect(onNavigate).not.toHaveBeenCalled()
      movePin.mockClear()
      hitTest.mockReturnValue([target.querySelector('[aria-label="Reorder Notes"]')!])
      dragEvent(target, 'dragstart')
      dragEvent(source, 'dragenter', -1)
      expect(source.querySelector('[data-drop-edge="before"]')).not.toBeNull()
      dragEvent(source, 'drop', -1)
      dragEvent(target, 'dragend')
      expect(movePin).toHaveBeenCalledWith('site', 1, 0)
      movePin.mockClear()
      hitTest.mockReturnValue([handle])
      dragEvent(source, 'dragstart')
      dragEvent(target, 'dragenter')
      dragEvent(source, 'dragend')
      expect(movePin).not.toHaveBeenCalled()
      expect(target.querySelector('[data-drop-edge]')).toBeNull()
      dragEvent(source, 'dragstart')
      dragEvent(document.body, 'dragenter')
      dragEvent(document.body, 'drop')
      dragEvent(source, 'dragend')
      expect(movePin).not.toHaveBeenCalled()
    } finally {
      document.elementsFromPoint = original
    }
  })

  it('keeps status and removal actions without ordering menu items', () => {
    const second = {...makeDoc(['notes'], 'Notes'), version: 'v1'}
    useDirectoryWithDraftsMock.mockReturnValue({directory: [guide, second], drafts: [], isLoading: false})
    const movePin = vi.fn()
    const acknowledgePin = vi.fn()
    const unpinDocument = vi.fn()
    renderBrowser({
      getPinsForSite: () => [pin, {...pin, path: ['notes'], title: 'Notes'}],
      movePin,
      acknowledgePin,
      unpinDocument,
    })
    function select(title: string, label: string) {
      const trigger = container.querySelector(`[aria-label="Pin options for ${title}"]`)!
      act(() => trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0})))
      const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (item) => item.textContent === label,
      )!
      expect(item).toBeDefined()
      act(() => item.click())
    }
    const trigger = container.querySelector('[aria-label="Pin options for Guide"]')!
    act(() => trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0})))
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)).toEqual([
      'Mark as up to date',
      'Unpin',
    ])
    act(() => (document.querySelector('[role="menuitem"]') as HTMLElement).click())
    select('Guide', 'Mark as up to date')
    expect(acknowledgePin).toHaveBeenCalledWith(latestId(guide.id), 'v2', 'Guide')
    select('Guide', 'Unpin')
    expect(unpinDocument).toHaveBeenCalledWith(latestId(guide.id))
  })
})
