// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The web assistant panel host: state that survives route changes, persisted like desktop's window
 * state, and a layout that never remounts the page when the panel opens or closes.
 */

const mockState = vi.hoisted(() => ({
  pathname: '/',
  isMobile: false,
}))

vi.mock('@remix-run/react', () => ({
  useLocation: () => ({pathname: mockState.pathname, search: '', hash: '', state: null, key: 'k'}),
}))
vi.mock('@shm/ui/use-media', () => ({useMedia: () => ({xs: mockState.isMobile})}))
// The panel body is the lazy agents chunk; the host's job is where and whether it renders.
vi.mock('@/client-lazy', () => ({
  clientLazy: () => () => <div data-testid="panel-content">PANEL</div>,
}))

import {AssistantPanelProvider, useAssistantAutoOpen, useAssistantPanel} from '../assistant-panel-state'
import {publishSiteContext} from '../site-context-bridge'
import {WebAssistantHost} from '../web-assistant-host'

/** What a mounted page would publish; the host re-provides it to the panel. */
function fakeSiteContext(route: string) {
  return {
    universal: {} as any,
    navigation: {
      state: {get: () => ({routes: [{key: route}], routeIndex: 0}), subscribe: () => () => {}},
      dispatch: () => {},
    } as any,
  }
}

let container: HTMLDivElement
let root: Root
let mountCount = 0
let controls: ReturnType<typeof useAssistantPanel> | null = null
let autoOpenAvailable = false

function Page() {
  React.useEffect(() => {
    mountCount += 1
  }, [])
  return <div data-testid="page">PAGE</div>
}

function Probe() {
  controls = useAssistantPanel()
  // Stands in for the site header, which reports whether a signed-in reader has an agent to use.
  useAssistantAutoOpen(autoOpenAvailable)
  return null
}

// StrictMode on purpose: the dev app runs under it, and its double effect pass is what exposed the
// persisted flag being cleared on load.
function App() {
  return (
    <React.StrictMode>
      <AssistantPanelProvider>
        <Probe />
        <WebAssistantHost>
          <Page />
        </WebAssistantHost>
      </AssistantPanelProvider>
    </React.StrictMode>
  )
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  mockState.pathname = '/'
  mockState.isMobile = false
  mountCount = 0
  controls = null
  autoOpenAvailable = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  publishSiteContext(fakeSiteContext('document'))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('web assistant panel', () => {
  it('renders the page alone until the panel is opened, then adds the divider and aside without remounting the page', () => {
    act(() => root.render(<App />))
    expect(container.querySelector('[data-testid="page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).toBeNull()
    const mountsAtStart = mountCount // StrictMode mounts twice in dev; what matters is no change later.

    act(() => controls!.open())
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).not.toBeNull()
    expect(container.querySelector('[role="separator"][aria-orientation="vertical"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
    expect(mountCount).toBe(mountsAtStart)

    act(() => controls!.close())
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).toBeNull()
    expect(mountCount).toBe(mountsAtStart)
  })

  it('persists open state and the selected session, and restores them on the next mount', () => {
    act(() => root.render(<App />))
    act(() => {
      controls!.open()
      controls!.setSessionId('https://agents.example | s-1')
      controls!.setAgentId('https://agents.example | docs')
    })
    expect(window.localStorage.getItem('seed.assistant.open')).toBe('1')
    expect(window.localStorage.getItem('seed.assistant.session')).toBe('https://agents.example | s-1')
    expect(window.localStorage.getItem('seed.assistant.agent')).toBe('https://agents.example | docs')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true)
    expect(controls!.sessionId).toBe('https://agents.example | s-1')
    expect(controls!.agentId).toBe('https://agents.example | docs')
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).not.toBeNull()

    // Clearing the choice clears the stored key too, so a stale agent does not come back later.
    act(() => controls!.setAgentId(null))
    expect(window.localStorage.getItem('seed.assistant.agent')).toBeNull()
  })

  it('remembers a close as a decision, so the panel stays closed on the next visit', () => {
    act(() => root.render(<App />))
    act(() => controls!.open())
    act(() => controls!.close())
    expect(window.localStorage.getItem('seed.assistant.open')).toBe('0')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(false)
    expect(controls!.openDecided).toBe(true)
  })

  it('stores no open preference until the reader makes one', () => {
    act(() => root.render(<App />))
    expect(controls!.openDecided).toBe(false)
    expect(window.localStorage.getItem('seed.assistant.open')).toBeNull()
  })

  it('opens itself on first arrival once an agent is available, and only until the reader closes it', () => {
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(false)
    // The site header learns there is an agent to use (home loaded, reader signed in).
    autoOpenAvailable = true
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true)
    expect(window.localStorage.getItem('seed.assistant.open')).toBe('1')

    act(() => controls!.close())
    expect(controls!.isOpen).toBe(false)
    // Still available, but the close was a decision: no re-opening on this or a later visit.
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(false)
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(false)
  })

  it('does not overwrite a saved open state with the pre-hydration default', () => {
    window.localStorage.setItem('seed.assistant.open', '1')
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true)
    expect(window.localStorage.getItem('seed.assistant.open')).toBe('1')
  })

  it('a new-chat request opens the panel and bumps the counter, which a route change resets', () => {
    act(() => root.render(<App />))
    act(() => controls!.requestNewChat())
    expect(controls!.isOpen).toBe(true)
    expect(controls!.newChatRequest).toBe(1)
    act(() => controls!.requestNewChat())
    expect(controls!.newChatRequest).toBe(2)

    mockState.pathname = '/some-document'
    act(() => root.render(<App />))
    expect(controls!.newChatRequest).toBe(0)
    expect(controls!.isOpen).toBe(true)
  })

  it('waits for a page to publish its contexts before rendering the panel body', () => {
    publishSiteContext(null)
    act(() => root.render(<App />))
    act(() => controls!.open())
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="panel-content"]')).toBeNull()
    act(() => publishSiteContext(fakeSiteContext('document')))
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })

  it('keeps the same panel element across a page change', () => {
    act(() => root.render(<App />))
    act(() => controls!.open())
    const aside = container.querySelector('[data-testid="web-assistant-panel"]')
    expect(aside).not.toBeNull()
    // A route change: a new page publishes fresh contexts and the outlet re-renders.
    mockState.pathname = '/another-document'
    act(() => {
      publishSiteContext(fakeSiteContext('document'))
      root.render(<App />)
    })
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).toBe(aside)
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })

  it('takes the whole screen on narrow viewports, with a way back to the page', () => {
    mockState.isMobile = true
    act(() => root.render(<App />))
    act(() => controls!.open())
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).toBeNull()
    const full = container.querySelector('[data-testid="web-assistant-panel-fullscreen"]')
    expect(full).not.toBeNull()
    expect(full?.querySelector('[data-testid="panel-content"]')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    const back = full?.querySelector('[aria-label="Back to page"]') as HTMLButtonElement
    expect(back).not.toBeNull()
    act(() => back.click())
    expect(container.querySelector('[data-testid="web-assistant-panel-fullscreen"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    // The page is still there and was never remounted.
    expect(container.querySelector('[data-testid="page"]')).not.toBeNull()
  })
})
