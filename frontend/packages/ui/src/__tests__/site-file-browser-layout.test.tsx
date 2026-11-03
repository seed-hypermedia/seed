// @vitest-environment jsdom
import React, {useState} from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {renderToString} from 'react-dom/server'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared'
import {SiteFileBrowserLayout} from '../site-file-browser-layout'
import {SiteSidebarProvider, SiteSidebarToggle, useSiteSidebar} from '../site-sidebar-context'
import {TooltipProvider} from '../tooltip'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const media = vi.hoisted(() => ({xs: false}))
const navigation = vi.hoisted(() => ({path: 'one'}))
const platform = vi.hoisted(() => ({desktop: false}))
vi.mock('../use-media', () => ({useMedia: () => media}))
vi.mock('@shm/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/constants')>('@shm/shared/constants')
  return {
    ...actual,
    get IS_DESKTOP() {
      return platform.desktop
    },
  }
})
vi.mock('@shm/shared/utils/navigation', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/utils/navigation')>('@shm/shared/utils/navigation')
  return {
    ...actual,
    useNavigate: () => () => {},
    useNavRouteOrNull: () => ({key: 'document', id: hmId('site', {path: [navigation.path]})}),
  }
})
vi.mock('../site-sidebar', () => ({
  SiteSidebar: ({children}: {children: React.ReactNode}) => <aside>{children}</aside>,
  SiteSidebarDocuments: ({onNavigate}: {onNavigate: (id: ReturnType<typeof hmId>) => void}) => (
    <button onClick={() => onNavigate(hmId('site', {path: ['doc']}))}>Open document</button>
  ),
}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  media.xs = false
  navigation.path = 'one'
  platform.desktop = false
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Page({hideBrowser}: {hideBrowser?: boolean}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [path, setPath] = useState('Home')
  return (
    <TooltipProvider>
      <SiteFileBrowserLayout
        siteId={hmId('site')}
        activeDocumentId={null}
        siteName="Site"
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onNavigate={(id) => setPath(id.path!.join('/'))}
        hideBrowser={hideBrowser}
      >
        <SiteSidebarToggle />
        <main>{path}</main>
      </SiteFileBrowserLayout>
    </TooltipProvider>
  )
}

function clickToggle() {
  act(() => container.querySelector<HTMLButtonElement>('[aria-expanded]')!.click())
}

describe('unified site sidebar layout', () => {
  it('starts closed on web and saves explicit toggles', () => {
    act(() => root.render(<Page />))
    expect(container.querySelector('[aria-label="Open sidebar"]')).not.toBeNull()
    clickToggle()
    expect(container.querySelector('[aria-label="Close sidebar"]')).not.toBeNull()
    expect(localStorage.getItem('seed.site-sidebar.open')).toBe('true')
    clickToggle()
    expect(localStorage.getItem('seed.site-sidebar.open')).toBe('false')
  })

  it('closes the mobile drawer when browser history changes the route', () => {
    media.xs = true
    act(() => root.render(<Page />))
    clickToggle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    navigation.path = 'two'
    act(() => root.render(<Page />))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('server renders the page with a closed sidebar', () => {
    const html = renderToString(<Page />)
    expect(html).toContain('Home')
    expect(html).toContain('Open sidebar')
    expect(html).not.toContain('<aside')
  })

  it('keeps the wide-screen preference when a mobile navigation closes the drawer', () => {
    localStorage.setItem('seed.site-sidebar.open', 'true')
    media.xs = true
    act(() => root.render(<Page />))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    clickToggle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click())
    expect(container.querySelector('main')?.textContent).toBe('doc')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(localStorage.getItem('seed.site-sidebar.open')).toBe('true')
  })

  it('closes the mobile drawer with Escape and restores toggle focus', async () => {
    media.xs = true
    act(() => root.render(<Page />))
    const toggle = container.querySelector<HTMLButtonElement>('[aria-expanded]')!
    toggle.focus()
    clickToggle()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(toggle))
  })

  it('leaves the documents out of the open sidebar when the space hides the browser', () => {
    localStorage.setItem('seed.site-sidebar.open', 'true')
    act(() => root.render(<Page hideBrowser />))
    expect(container.querySelector('aside')).not.toBeNull()
    expect(container.textContent).not.toContain('Open document')
  })

  it('keeps the desktop app sidebar from falling back to its own documents when the space hides the browser', () => {
    platform.desktop = true
    // Mirrors the desktop app sidebar, which lists documents itself unless a page fills its slot.
    function AppSidebar() {
      const sidebar = useSiteSidebar()!
      return <div ref={sidebar.setTarget}>{sidebar.hasPageContent ? null : 'Fallback documents'}</div>
    }
    act(() =>
      root.render(
        <SiteSidebarProvider open setOpen={() => {}}>
          <AppSidebar />
          <Page hideBrowser />
        </SiteSidebarProvider>,
      ),
    )
    expect(container.textContent).not.toContain('Fallback documents')
    expect(container.textContent).not.toContain('Open document')
    expect(container.querySelector('main')).not.toBeNull()
  })

  it('leaves the documents out of the mobile drawer when the space hides the browser', () => {
    media.xs = true
    act(() => root.render(<Page hideBrowser />))
    clickToggle()
    expect(document.querySelector('[role="dialog"] aside')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Open document')
  })
})
