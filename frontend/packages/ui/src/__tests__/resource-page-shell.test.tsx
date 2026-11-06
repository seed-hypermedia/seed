// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {act, Simulate} from 'react-dom/test-utils'
import {createContext, useContext, useState} from 'react'
import {createPortal} from 'react-dom'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ActivityPanelPortal} from '../activity-panel-layout'
import {DocumentViewContent, PageWrapper} from '../resource-page-common'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const layoutState = vi.hoisted(() => ({route: null as any, mobile: false}))
vi.mock('../use-media', () => ({useMedia: () => ({xs: layoutState.mobile})}))

vi.mock('../site-header', () => ({
  SiteHeader: ({
    editNavPane,
    editNavPanePortalRef,
  }: {
    editNavPane?: React.ReactNode
    editNavPanePortalRef?: (node: HTMLDivElement | null) => void
  }) => (
    <div data-testid="site-header">
      <div data-testid="edit-nav-pane-target" ref={editNavPanePortalRef}>
        {editNavPane}
      </div>
    </div>
  ),
}))

vi.mock('../site-file-browser-layout', () => {
  let nextMountId = 0
  return {
    SiteFileBrowserLayout: ({
      children,
      onPrefetch,
    }: {
      children: React.ReactNode
      onPrefetch?: (id: ReturnType<typeof hmId>) => void
    }) => {
      const React = require('react')
      const mountId = React.useRef(++nextMountId)
      return (
        <div
          data-testid="file-browser-layout"
          data-mount-id={mountId.current}
          data-has-prefetch={onPrefetch ? 'true' : 'false'}
        >
          {children}
        </div>
      )
    },
  }
})

vi.mock('@shm/shared/utils/navigation', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/utils/navigation')>('@shm/shared/utils/navigation')
  return {...actual, useNavigate: () => vi.fn(), useNavRouteOrNull: () => layoutState.route}
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  layoutState.route = null
  layoutState.mobile = false
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('PageWrapper', () => {
  it('passes document prefetch intent to the file browser layout', () => {
    const headerData = {
      items: [],
      homeNavigationItems: [],
      directoryItems: [],
      isCenterLayout: false,
      siteHomeDocument: null,
    }

    act(() => {
      root.render(
        <PageWrapper
          siteHomeId={hmId('site')}
          docId={hmId('site')}
          headerData={headerData}
          onPrefetchDocument={vi.fn()}
        >
          <div>Document</div>
        </PageWrapper>,
      )
    })

    expect(container.querySelector('[data-testid="file-browser-layout"]')?.getAttribute('data-has-prefetch')).toBe(
      'true',
    )
  })

  it('keeps the file browser layout mounted when keyed route content changes', () => {
    const siteHomeId = hmId('site')
    const headerData = {
      items: [],
      homeNavigationItems: [],
      directoryItems: [],
      isCenterLayout: false,
      siteHomeDocument: null,
    }

    act(() => {
      root.render(
        <PageWrapper siteHomeId={siteHomeId} docId={hmId('site', {path: ['one']})} headerData={headerData}>
          <div key="one">Document one</div>
        </PageWrapper>,
      )
    })
    const firstMountId = container.querySelector('[data-testid="file-browser-layout"]')?.getAttribute('data-mount-id')

    act(() => {
      root.render(
        <PageWrapper siteHomeId={siteHomeId} docId={hmId('site', {path: ['two']})} headerData={headerData}>
          <div key="two">Document two</div>
        </PageWrapper>,
      )
    })

    expect(container.querySelector('[data-testid="file-browser-layout"]')?.getAttribute('data-mount-id')).toBe(
      firstMountId,
    )
    expect(container.textContent).toContain('Document two')
  })
})

const TestContext = createContext<string | null>(null)

function ContextReader() {
  const value = useContext(TestContext)
  if (!value) throw new Error('missing context')
  return <span>{value}</span>
}

function PortalHarness() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const siteHomeId = hmId('site')
  const headerData = {
    items: [],
    homeNavigationItems: [],
    directoryItems: [],
    isCenterLayout: false,
    siteHomeDocument: null,
  }

  return (
    <PageWrapper siteHomeId={siteHomeId} docId={hmId('site')} headerData={headerData} editNavPanePortalRef={setTarget}>
      <TestContext.Provider value="edit nav context">
        {target ? createPortal(<ContextReader />, target) : null}
        <div>Document body</div>
      </TestContext.Provider>
    </PageWrapper>
  )
}

describe('PageWrapper edit navigation pane portal', () => {
  it('exposes a header portal target so provider-bound panes can render in the header', () => {
    act(() => {
      root.render(<PortalHarness />)
    })

    expect(container.querySelector('[data-testid="edit-nav-pane-target"]')?.textContent).toContain('edit nav context')
  })
})

describe('DocumentViewContent', () => {
  function CollectionTable() {
    const [search, setSearch] = useState('')
    return <input aria-label="Search documents" value={search} onChange={(event) => setSearch(event.target.value)} />
  }

  it.each(['comments', 'metadata', 'collaborators', 'activity', 'directory'] as const)(
    'shows %s instead of the collection and restores the same table on return',
    (activeView) => {
      const renderView = (view: typeof activeView | 'content') => {
        act(() => {
          root.render(
            <DocumentViewContent activeView={view} collection={<CollectionTable />}>
              <div data-testid="main-view">{view}</div>
            </DocumentViewContent>,
          )
        })
      }
      renderView('content')
      const table = container.querySelector('input')!
      act(() => {
        table.value = 'Alpha'
        Simulate.change(table)
      })
      expect(table.value).toBe('Alpha')
      expect(table.closest('[hidden]')).toBeNull()
      expect(container.querySelector('[data-testid="main-view"]')).toBeNull()

      renderView(activeView)
      expect(table.closest('[hidden]')).not.toBeNull()
      expect(container.querySelector('[data-testid="main-view"]')?.textContent).toBe(activeView)

      renderView('content')
      expect(container.querySelector('input')).toBe(table)
      expect(table.value).toBe('Alpha')
      expect(table.closest('[hidden]')).toBeNull()
      expect(container.querySelector('[data-testid="main-view"]')).toBeNull()
    },
  )

  it('renders ordinary document content without a collection', () => {
    act(() => {
      root.render(
        <DocumentViewContent activeView="content">
          <p>Document content</p>
        </DocumentViewContent>,
      )
    })
    expect(container.textContent).toBe('Document content')
  })
})

describe('Activity outside the site shell', () => {
  it('keeps document input and file browser state when Activity opens, switches tabs, and closes', () => {
    const siteHomeId = hmId('site')
    const headerData = {
      items: [],
      homeNavigationItems: [],
      directoryItems: [],
      isCenterLayout: false,
      siteHomeDocument: null,
    }
    function Document() {
      const [text, setText] = useState('')
      return (
        <>
          <input value={text} onChange={(event) => setText(event.target.value)} />
          <ActivityPanelPortal active={layoutState.route?.panel?.key === 'feed'}>
            <button>Activity content</button>
          </ActivityPanelPortal>
        </>
      )
    }
    const render = (panel: any) => {
      layoutState.route = {key: 'document', id: siteHomeId, panel}
      act(() =>
        root.render(
          <PageWrapper siteHomeId={siteHomeId} docId={siteHomeId} headerData={headerData}>
            <Document />
          </PageWrapper>,
        ),
      )
    }
    render(null)
    const input = container.querySelector('input')!
    const browser = container.querySelector('[data-testid="file-browser-layout"]')!
    act(() => {
      input.value = 'Unfinished edit'
      Simulate.change(input)
      input.focus()
    })
    for (const panel of [{key: 'feed', tab: 'to-you'}, {key: 'feed', tab: 'all-updates'}, null]) {
      render(panel)
      expect(container.querySelector('input')).toBe(input)
      expect(input.value).toBe('Unfinished edit')
      expect(container.querySelector('[data-testid="file-browser-layout"]')).toBe(browser)
      if (panel) {
        expect(container.querySelector('#activity')?.textContent).toContain('Activity content')
        expect(browser.textContent).not.toContain('Activity content')
        container.querySelector<HTMLButtonElement>('#activity button')!.focus()
      } else {
        expect(document.activeElement).toBe(input)
      }
    }
  })

  it('does not create an outer panel on mobile', () => {
    layoutState.mobile = true
    layoutState.route = {key: 'document', id: hmId('site'), panel: {key: 'feed'}}
    act(() =>
      root.render(
        <PageWrapper
          siteHomeId={hmId('site')}
          docId={hmId('site')}
          headerData={{
            items: [],
            homeNavigationItems: [],
            directoryItems: [],
            isCenterLayout: false,
            siteHomeDocument: null,
          }}
        >
          <input defaultValue="Mobile document" />
        </PageWrapper>,
      ),
    )
    expect(container.querySelector('#activity')).toBeNull()
    expect(container.querySelector('input')?.value).toBe('Mobile document')
  })
})
