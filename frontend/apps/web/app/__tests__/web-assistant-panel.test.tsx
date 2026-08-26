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
vi.mock('@shm/ui/mobile-panel-sheet', () => ({
  MobilePanelSheet: ({children, title}: {children: React.ReactNode; title: string}) => (
    <div data-testid="mobile-sheet" data-title={title}>
      {children}
    </div>
  ),
}))
// The panel body is the lazy agents chunk; the host's job is where and whether it renders.
vi.mock('@/client-lazy', () => ({
  clientLazy: () => () => <div data-testid="panel-content">PANEL</div>,
}))

import {AssistantPanelProvider, useAssistantPanel} from '../assistant-panel-state'
import {WebAssistantHost} from '../web-assistant-host'

let container: HTMLDivElement
let root: Root
let mountCount = 0
let controls: ReturnType<typeof useAssistantPanel> | null = null

function Page() {
  React.useEffect(() => {
    mountCount += 1
  }, [])
  return <div data-testid="page">PAGE</div>
}

function Probe() {
  controls = useAssistantPanel()
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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
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
    })
    expect(window.localStorage.getItem('seed.assistant.open')).toBe('1')
    expect(window.localStorage.getItem('seed.assistant.session')).toBe('https://agents.example | s-1')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true)
    expect(controls!.sessionId).toBe('https://agents.example | s-1')
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).not.toBeNull()
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

  it('uses the bottom sheet instead of a side panel on narrow screens', () => {
    mockState.isMobile = true
    act(() => root.render(<App />))
    act(() => controls!.open())
    expect(container.querySelector('[data-testid="web-assistant-panel"]')).toBeNull()
    const sheet = document.body.querySelector('[data-testid="mobile-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.getAttribute('data-title')).toBe('Agents')
    expect(sheet?.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })
})
