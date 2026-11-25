// @vitest-environment jsdom
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../tooltip', async () => {
  const React = await import('react')
  return {
    Tooltip: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: (uid: string) => ({data: {metadata: {name: uid}}}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'document'}),
}))

import {DocumentTopBar} from '../document-top-bar'

let container: HTMLDivElement
let root: Root
const openRoute = vi.fn()
let observers: Array<{
  target?: Element
  emit: (isIntersecting: boolean) => void
  disconnected: boolean
}>

beforeEach(() => {
  openRoute.mockClear()
  vi.stubGlobal('PointerEvent', MouseEvent)
  observers = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      target?: Element
      disconnected = false
      constructor(private callback: IntersectionObserverCallback) {
        observers.push(this)
      }
      observe(target: Element) {
        this.target = target
      }
      disconnect() {
        this.disconnected = true
      }
      emit(isIntersecting: boolean) {
        this.callback(
          [{target: this.target, isIntersecting} as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={openRoute}
        openUrl={vi.fn()}
        universalClient={{request: vi.fn(), publish: vi.fn()} as any}
      >
        {node}
      </UniversalAppProvider>,
    )
  })
}

function openPathMenu() {
  act(() => {
    container
      .querySelector('[aria-label="Document path"]')!
      .dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: 0, ctrlKey: false}))
  })
}

describe('DocumentTopBar', () => {
  it('shows Collapse only while the inline control is offscreen and performs the collapse action', () => {
    const inlineButton = document.createElement('button')
    function Page() {
      const [expanded, setExpanded] = React.useState(true)
      return (
        <>
          <DocumentTopBar
            collapseAction={
              expanded
                ? {
                    inlineButton,
                    title: 'Comments',
                    onCollapse: () => setExpanded(false),
                  }
                : undefined
            }
          />
          <div>{expanded ? 'Expanded comments' : 'Document with comments panel'}</div>
        </>
      )
    }
    render(<Page />)
    const collapse = () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse Comments"]')
    expect(collapse()).toBeNull()
    act(() => observers[0]!.emit(true))
    expect(collapse()).toBeNull()
    act(() => observers[0]!.emit(false))
    expect(collapse()).not.toBeNull()
    act(() => observers[0]!.emit(true))
    expect(collapse()).toBeNull()
    act(() => observers[0]!.emit(false))
    act(() => collapse()!.click())
    expect(container.textContent).toContain('Document with comments panel')
    expect(collapse()).toBeNull()
    expect(observers[0]!.disconnected).toBe(true)
  })

  it('does not carry offscreen state over to a different inline button', () => {
    const action = {inlineButton: document.createElement('button'), title: 'Comments', onCollapse: () => {}}
    render(<DocumentTopBar collapseAction={action} />)
    act(() => observers[0]!.emit(false))
    expect(container.querySelector('[aria-label="Collapse Comments"]')).not.toBeNull()
    render(
      <DocumentTopBar collapseAction={{...action, title: 'People', inlineButton: document.createElement('button')}} />,
    )
    expect(container.querySelector('[aria-label="Collapse People"]')).toBeNull()
    expect(observers[0]!.disconnected).toBe(true)
    act(() => observers[1]!.emit(false))
    expect(container.querySelector('[aria-label="Collapse People"]')).not.toBeNull()
    render(<DocumentTopBar />)
    expect(container.querySelector('[aria-label="Collapse People"]')).toBeNull()
  })

  it('renders the location trail and the page actions', () => {
    render(
      <DocumentTopBar
        breadcrumbs={[
          {id: hmId('site'), metadata: {name: 'Home'}},
          {id: hmId('site', {path: ['doc']}), metadata: {name: 'Doc'}},
        ]}
        actions={<button type="button">Publish</button>}
      />,
    )

    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull()
    expect(container.querySelector('[data-document-top-bar]')?.className).toContain('z-40')
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Doc')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Publish')).toBe(true)
  })

  it('renders document status beside breadcrumbs and before page actions', () => {
    render(
      <DocumentTopBar
        breadcrumbs={[{id: hmId('site'), metadata: {name: 'Site'}}]}
        status={<span>Private</span>}
        actions={<button type="button">Publish</button>}
      />,
    )

    const status = container.querySelector('[data-document-status]')
    const breadcrumbs = container.querySelector('nav[aria-label="Breadcrumb"]')
    expect(container.querySelector('[data-document-top-bar]')?.className).toContain('relative')
    expect(container.querySelector('[data-document-top-bar]')?.className).toContain('z-40')
    expect(status?.textContent).toBe('Private')
    expect(status?.parentElement?.contains(breadcrumbs)).toBe(true)
    expect(breadcrumbs?.className).not.toContain('flex-1')
    expect(status!.compareDocumentPosition(container.querySelector('button')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('renders a home document as its own single crumb', () => {
    render(<DocumentTopBar breadcrumbs={[{id: hmId('site'), metadata: {name: 'Site'}}]} />)

    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('replaces mobile crumbs with a path menu in hierarchy order and marks the current document', () => {
    render(
      <DocumentTopBar
        isMobile
        breadcrumbs={[
          {id: hmId('site'), metadata: {name: 'Site'}},
          {id: hmId('site', {path: ['projects']}), metadata: {name: 'Projects'}},
          {id: hmId('site', {path: ['projects', 'mobile']}), metadata: {name: 'Mobile'}},
          {id: hmId('site', {path: ['projects', 'mobile', 'navigation']}), metadata: {name: 'Navigation guidelines'}},
        ]}
      />,
    )
    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull()
    expect(container.querySelector('[aria-label="Document path"]')).not.toBeNull()
    openPathMenu()
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual(['Home', 'Projects', 'Mobile', 'Navigation guidelines'])
    expect(items.slice(0, 3).every((item) => item.tagName === 'A')).toBe(true)
    expect(items.map((item) => (item as HTMLElement).style.paddingLeft)).toEqual(['8px', '22px', '36px', '50px'])
    const current = items[3]!
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.tagName).toBe('DIV')
    expect(current.className).toContain('font-semibold')
    expect(current.querySelector('svg.lucide-check')).not.toBeNull()
    act(() => (items[2] as HTMLElement).click())
    expect(openRoute).toHaveBeenCalledWith(
      {key: 'document', id: hmId('site', {path: ['projects', 'mobile']})},
      undefined,
    )
  })

  it('omits the mobile path button at home and for empty breadcrumbs', () => {
    for (const breadcrumbs of [[], [{id: hmId('site'), metadata: {name: 'Site'}}]]) {
      render(<DocumentTopBar isMobile breadcrumbs={breadcrumbs} />)
      expect(container.querySelector('[aria-label="Document path"]')).toBeNull()
      expect(container.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull()
    }
  })

  it('preserves draft, loading, missing and error labels in the mobile menu', () => {
    render(
      <DocumentTopBar
        isMobile
        breadcrumbs={[
          {id: hmId('site'), metadata: {}},
          {id: hmId('site', {path: ['loading']}), metadata: {}, isLoading: true},
          {id: hmId('site', {path: ['missing']}), metadata: {}, isNotFound: true, fallbackName: 'Missing parent'},
          {id: hmId('site', {path: ['error']}), metadata: {name: 'Unavailable'}, isError: true},
          {id: hmId('site', {path: ['draft']}), metadata: {name: 'Draft parent'}, draftId: 'draft-parent'},
          {label: 'Unpublished section'},
          {
            id: hmId('site', {path: ['current']}),
            metadata: {name: 'Private draft'},
            isUnpublishedDraft: true,
            draftId: 'current',
          },
        ]}
      />,
    )
    openPathMenu()
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)).toEqual([
      'Home',
      'Loading…',
      'Missing parent',
      'Unavailable',
      'Draft parent',
      'Unpublished section',
      'Private draft',
    ])
    expect(document.querySelector('[aria-current="page"] .italic')).not.toBeNull()
    const draftParent = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'Draft parent',
    )!
    act(() => draftParent.click())
    expect(openRoute).toHaveBeenCalledWith({key: 'draft', id: 'draft-parent'}, undefined)
  })
})
