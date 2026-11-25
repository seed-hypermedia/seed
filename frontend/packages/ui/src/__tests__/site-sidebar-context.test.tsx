// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createContext, useContext, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, it} from 'vitest'
import {
  readSidebarOpen,
  usePersistedSidebarOpen,
  SiteSidebarProvider,
  SiteSidebarPortal,
  useSiteSidebar,
} from '../site-sidebar-context'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => localStorage.clear())

describe('sidebar preferences', () => {
  it('uses platform defaults only when no valid preference exists', () => {
    expect(readSidebarOpen(null, false)).toBe(false)
    expect(readSidebarOpen(null, true)).toBe(true)
    expect(readSidebarOpen('false', true)).toBe(false)
    expect(readSidebarOpen('true', false)).toBe(true)
    expect(readSidebarOpen('invalid', true)).toBe(true)
  })

  it('restores a web preference after remounting', () => {
    const container = document.createElement('div')
    document.body.append(container)
    function Toggle() {
      const [open, setOpen] = usePersistedSidebarOpen(false)
      return (
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          Toggle
        </button>
      )
    }
    let root = createRoot(container)
    act(() => root.render(<Toggle />))
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
    act(() => container.querySelector('button')!.click())
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<Toggle />))
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    act(() => root.unmount())
    container.remove()
  })
})

const PageContext = createContext('missing')

it('keeps page context and browser state when moving document content into the desktop sidebar', () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Slot() {
    const sidebar = useSiteSidebar()!
    return <aside ref={sidebar.setTarget}>{!sidebar.hasPageContent && <span>Fallback</span>}</aside>
  }
  function Browser() {
    const context = useContext(PageContext)
    const [expanded, setExpanded] = useState(false)
    return (
      <button onClick={() => setExpanded(!expanded)}>
        {context}: {expanded ? 'expanded' : 'collapsed'}
      </button>
    )
  }
  function Page({visible}: {visible: boolean}) {
    return (
      <SiteSidebarProvider open setOpen={() => {}}>
        <Slot />
        {visible && (
          <PageContext.Provider value="Page actions">
            <SiteSidebarPortal>
              <Browser />
            </SiteSidebarPortal>
          </PageContext.Provider>
        )}
      </SiteSidebarProvider>
    )
  }
  act(() => root.render(<Page visible />))
  expect(container.querySelector('aside')?.textContent).toBe('Page actions: collapsed')
  act(() => container.querySelector('button')!.click())
  act(() => root.render(<Page visible />))
  expect(container.querySelector('aside')?.textContent).toBe('Page actions: expanded')
  act(() => root.render(<Page visible={false} />))
  expect(container.querySelector('aside')?.textContent).toBe('Fallback')
  act(() => root.unmount())
  container.remove()
})
