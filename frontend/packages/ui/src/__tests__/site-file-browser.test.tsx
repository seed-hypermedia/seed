// @vitest-environment jsdom
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SiteFileBrowser} from '../site-file-browser'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useDirectoryMock = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/models/entity', () => ({useDirectory: useDirectoryMock}))

let container: HTMLDivElement
let root: Root

function makeDoc(path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  return {id: hmId('site', {path}), path, metadata: {name}, visibility} as HMDocumentInfo
}

function makeFolder(path: string[], name: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') {
  const doc = makeDoc(path, name, visibility)
  doc.isFolder = true
  return doc
}

beforeEach(() => {
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
  it('marks folders with a grid icon instead of a private icon', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeFolder(['folders'], 'Folders'), makeFolder(['private'], 'Private', 'PRIVATE')],
      isLoading: false,
      isError: false,
    })

    act(() => {
      root.render(<SiteFileBrowser siteId={hmId('site')} activeDocumentId={null} onNavigate={vi.fn()} />)
    })

    expect(container.querySelectorAll('[aria-label="Folder"]')).toHaveLength(2)
    expect(container.querySelector('[aria-label="Private document"]')).toBeNull()
  })

  it('reveals the active document and marks private rows', () => {
    useDirectoryMock.mockReturnValue({
      data: [makeDoc(['guides'], 'Guides'), makeDoc(['guides', 'private'], 'Private guide', 'PRIVATE')],
      isLoading: false,
      isError: false,
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
    const caretButton = container.querySelector('[aria-label="Collapse Guides"]')
    expect(caretButton?.className).toContain('size-6')
    expect(caretButton?.className).toContain('p-0')
    expect(caretButton?.className).not.toContain('min-w-8')
    const activeDocumentButton = container.querySelector('[aria-current="page"]')
    expect(activeDocumentButton?.className).toContain('h-6')
    expect(activeDocumentButton?.className).toContain('text-sm')
    expect(activeDocumentButton?.className).not.toContain('text-xs')
  })

  it('shows title matches as a flat list and navigates', () => {
    const install = makeDoc(['guides', 'install'], 'Install Seed')
    const onNavigate = vi.fn()
    const onPrefetch = vi.fn()
    useDirectoryMock.mockReturnValue({data: [makeDoc(['guides'], 'Guides'), install], isLoading: false, isError: false})

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
    expect(onPrefetch).toHaveBeenNthCalledWith(1, install.id)
    expect(onPrefetch).toHaveBeenNthCalledWith(2, install.id)
    act(() => result.click())
    expect(onNavigate).toHaveBeenCalledWith(install.id)
  })

  it('hides search by default and focuses it when revealed', () => {
    useDirectoryMock.mockReturnValue({data: [], isLoading: false, isError: false})
    const props = {siteId: hmId('site'), activeDocumentId: null, onNavigate: vi.fn()}

    act(() => root.render(<SiteFileBrowser {...props} />))
    expect(container.querySelector('[aria-label="Filter documents"]')).toBeNull()

    act(() => root.render(<SiteFileBrowser {...props} searchVisible />))
    expect(container.querySelector('[aria-label="Filter documents"]')).toBe(document.activeElement)
  })

  it('clears and closes document filtering from the input', () => {
    useDirectoryMock.mockReturnValue({data: [makeDoc(['guides'], 'Guides')], isLoading: false, isError: false})
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
    useDirectoryMock.mockReturnValue({data: [], isLoading: false, isError: false})
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
    useDirectoryMock.mockReturnValue({data: [makeDoc(['guides'], 'Guides')], isLoading: false, isError: false})
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
    expect(home.querySelector('svg')).toBeNull()
    act(() => home.click())
    expect(onNavigate).toHaveBeenCalledWith(hmId('site'))
  })

  it('shows root creation actions only when a creation menu is provided', () => {
    useDirectoryMock.mockReturnValue({data: [], isLoading: false, isError: false})
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
              {key: 'new-document-collection', label: 'Folder', icon: null, onClick: vi.fn()},
              {key: 'new-private-document', label: 'Private', icon: null, onClick: vi.fn()},
            ],
          }}
        />,
      ),
    )
    expect(container.querySelector('[aria-label="Create root document"]')).toBeTruthy()
  })
})
