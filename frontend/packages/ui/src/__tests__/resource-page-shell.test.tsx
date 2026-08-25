// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {act} from 'react-dom/test-utils'
import {createContext, useContext, useState} from 'react'
import {createPortal} from 'react-dom'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {PageWrapper} from '../resource-page-common'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../use-media', () => ({useMedia: () => ({xs: false})}))

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
  return {...actual, useNavigate: () => vi.fn()}
})

let container: HTMLDivElement
let root: Root

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
