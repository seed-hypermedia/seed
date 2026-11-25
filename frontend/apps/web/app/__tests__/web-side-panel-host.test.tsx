// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act, Simulate} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The web side panel host: Activity and Agents share one slot (whichever opens last closes the
 * other), state that survives route changes, persisted for the tab, and a layout that never
 * remounts the page when the panel opens or closes.
 */

const mockState = vi.hoisted(() => ({
  pathname: '/',
  isMobile: false,
  keyPair: {id: 'reader'} as {id: string} | null,
  // What the activity tracker reports: whether the reader can see an agent mounted in this site,
  // and how many orphan agents of their own they have to adopt.
  hasAgents: true,
  orphans: 0,
}))

vi.mock('@remix-run/react', () => ({
  useLocation: () => ({pathname: mockState.pathname, search: '', hash: '', state: null, key: 'k'}),
}))
vi.mock('@shm/ui/use-media', () => ({useMedia: () => ({xs: mockState.isMobile})}))
// The agents panel only exists for a signed-in reader; tests default to signed in.
vi.mock('@/auth', () => ({useLocalKeyPair: () => mockState.keyPair}))
// The panel body is the lazy agents chunk; the host's job is where and whether it renders.
vi.mock('@/client-lazy', () => ({
  clientLazy: () => () => <div data-testid="panel-content">PANEL</div>,
  ClientOnly: ({children}: {children: React.ReactNode}) => <>{children}</>,
}))
// The header's activity tracker is the agents chunk too; the host's job is to mount it and to
// take its word on whether the reader has an agent here.
vi.mock('../web-assistant-activity', () => ({
  default: ({onAgentsChange}: {onAgentsChange: (agents: {usable: boolean; orphans: number}) => void}) => {
    const usable = mockState.hasAgents
    const orphans = mockState.orphans
    React.useEffect(() => {
      onAgentsChange({usable, orphans})
    }, [usable, orphans, onAgentsChange])
    return null
  },
}))

import {ActivityPanelPortal} from '@shm/ui/activity-panel-layout'
import {useAssistantPanelToggle} from '@shm/ui/assistant-panel-toggle'
import {AssistantPanelProvider, useAssistantPanel} from '../assistant-panel-state'
import {publishSiteContext, useSiteContextSnapshot} from '../site-context-bridge'
import {WebSidePanelHost} from '../web-side-panel-host'

const feedPanel = {key: 'feed', tab: 'to-you'}

/** What a mounted page would publish; the host re-provides it to the panel and reads its route. */
function fakeSiteContext(route: any) {
  const openRoute = vi.fn()
  return {
    openRoute,
    snapshot: {
      universal: {openRoute} as any,
      navigation: {
        state: {get: () => ({routes: [route], routeIndex: 0}), subscribe: () => () => {}},
        dispatch: () => {},
      } as any,
    },
  }
}

let container: HTMLDivElement
let root: Root
let mountCount = 0
let controls: ReturnType<typeof useAssistantPanel> | null = null

let headerToggle: ReturnType<typeof useAssistantPanelToggle> = null

function Page() {
  // Stands in for the site header's Agents button, which reads the toggle the host offers.
  headerToggle = useAssistantPanelToggle()
  React.useEffect(() => {
    mountCount += 1
  }, [])
  return <div data-testid="page">PAGE</div>
}

/** A page with a document input and the route-owned Activity view, like DocumentView renders. */
function ActivityPage() {
  const snapshot = useSiteContextSnapshot()
  const route = snapshot?.navigation.state.get().routes[0] as any
  const feedActive = route?.panel?.key === 'feed'
  headerToggle = useAssistantPanelToggle()
  const [text, setText] = React.useState('')
  return (
    <div data-testid="page">
      <input data-testid="page-input" value={text} onChange={(event) => setText(event.target.value)} />
      <ActivityPanelPortal active={feedActive}>
        <button data-testid="activity-content">ACTIVITY</button>
      </ActivityPanelPortal>
    </div>
  )
}

function Probe() {
  controls = useAssistantPanel()
  return null
}

// StrictMode on purpose: the dev app runs under it, and its double effect pass is what exposed the
// persisted flag being cleared on load.
function App({page}: {page?: React.ReactNode}) {
  return (
    <React.StrictMode>
      <AssistantPanelProvider>
        <Probe />
        <WebSidePanelHost>{page ?? <Page />}</WebSidePanelHost>
      </AssistantPanelProvider>
    </React.StrictMode>
  )
}

const asideSelector = '[data-testid="web-side-panel"]:not([aria-hidden="true"])'

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  window.sessionStorage.clear()
  mockState.pathname = '/'
  mockState.isMobile = false
  mockState.keyPair = {id: 'reader'}
  mockState.hasAgents = true
  mockState.orphans = 0
  mountCount = 0
  controls = null
  headerToggle = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  publishSiteContext(fakeSiteContext({key: 'document'}).snapshot)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('web side panel', () => {
  it('renders the page alone until the panel is opened, then adds the divider and aside without remounting the page', () => {
    act(() => root.render(<App />))
    expect(container.querySelector('[data-testid="page"]')).not.toBeNull()
    expect(container.querySelector(asideSelector)).toBeNull()
    const mountsAtStart = mountCount // StrictMode mounts twice in dev; what matters is no change later.

    act(() => controls!.open())
    expect(container.querySelector(asideSelector)).not.toBeNull()
    expect(container.querySelector('[role="separator"][aria-orientation="vertical"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
    expect(mountCount).toBe(mountsAtStart)

    act(() => controls!.close())
    expect(container.querySelector(asideSelector)).toBeNull()
    expect(mountCount).toBe(mountsAtStart)
  })

  it('takes the closed divider out of the layout so it cannot widen the page past the viewport', () => {
    const separatorDisplay = () =>
      getComputedStyle(container.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]')!).display
    act(() => root.render(<App />))
    expect(separatorDisplay()).toBe('none')
    act(() => controls!.open())
    expect(separatorDisplay()).not.toBe('none')
    act(() => controls!.close())
    expect(separatorDisplay()).toBe('none')

    mockState.isMobile = true
    act(() => root.render(<App />))
    act(() => controls!.open())
    expect(separatorDisplay()).toBe('none')
  })

  it('keeps a focus position when Enter closes the separator', () => {
    act(() => root.render(<App />))
    act(() => controls!.open())
    const separator = container.querySelector<HTMLElement>('[role="separator"]')!
    separator.focus()
    act(() => {
      separator.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}))
    })
    expect(controls!.isOpen).toBe(false)
    expect(document.activeElement).toBe(separator.parentElement)
  })

  it('Enter on the separator closes Activity through the route when it holds the slot', () => {
    const {snapshot, openRoute} = fakeSiteContext({key: 'document', panel: feedPanel})
    act(() => {
      publishSiteContext(snapshot)
      root.render(<App />)
    })
    expect(container.querySelector(asideSelector)?.getAttribute('aria-label')).toBe('Activity')
    const separator = container.querySelector<HTMLElement>('[role="separator"]')!
    act(() => {
      separator.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}))
    })
    expect(openRoute).toHaveBeenCalledWith({key: 'document', panel: null}, false)
  })

  it('persists open state and the selected session, and restores them on the next mount', () => {
    act(() => root.render(<App />))
    act(() => {
      controls!.open()
      controls!.setSessionId('https://agents.example | s-1')
      controls!.setAgentId('https://agents.example | docs')
    })
    expect(window.sessionStorage.getItem('seed.assistant.open')).toBe('1')
    expect(window.sessionStorage.getItem('seed.assistant.session')).toBe('https://agents.example | s-1')
    expect(window.sessionStorage.getItem('seed.assistant.agent')).toBe('https://agents.example | docs')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true)
    expect(controls!.sessionId).toBe('https://agents.example | s-1')
    expect(controls!.agentId).toBe('https://agents.example | docs')
    expect(container.querySelector(asideSelector)).not.toBeNull()

    // Clearing the choice clears the stored key too, so a stale agent does not come back later.
    act(() => controls!.setAgentId(null))
    expect(window.sessionStorage.getItem('seed.assistant.agent')).toBeNull()
  })

  it('remembers a close, so the panel stays closed when the tab reloads', () => {
    act(() => root.render(<App />))
    act(() => controls!.open())
    act(() => controls!.close())
    expect(window.sessionStorage.getItem('seed.assistant.open')).toBe('0')

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(false)
  })

  it('never opens on its own, even for a reader with an agent here and nothing decided', () => {
    act(() => root.render(<App />))
    act(() => root.render(<App />))
    expect(headerToggle).not.toBeNull()
    expect(controls!.isOpen).toBe(false)
    expect(container.querySelector(asideSelector)).toBeNull()
  })

  it('starts a new tab closed, with no chat, whatever an earlier tab or visit left behind', () => {
    // What earlier versions kept in localStorage, shared by every tab and site on the origin.
    window.localStorage.setItem('seed.assistant.open', '1')
    window.localStorage.setItem('seed.assistant.session', 'https://agents.example | s-1')
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(false)
    expect(controls!.sessionId).toBeNull()
  })

  it('does not overwrite a saved open state with the pre-hydration default', () => {
    window.sessionStorage.setItem('seed.assistant.open', '1')
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true)
    expect(window.sessionStorage.getItem('seed.assistant.open')).toBe('1')
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
    expect(container.querySelector(asideSelector)).not.toBeNull()
    expect(container.querySelector('[data-testid="panel-content"]')).toBeNull()
    act(() => publishSiteContext(fakeSiteContext({key: 'document'}).snapshot))
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })

  it('keeps the same panel element across a page change', () => {
    act(() => root.render(<App />))
    act(() => controls!.open())
    const aside = container.querySelector(asideSelector)
    expect(aside).not.toBeNull()
    // A route change: a new page publishes fresh contexts and the outlet re-renders.
    mockState.pathname = '/another-document'
    act(() => {
      publishSiteContext(fakeSiteContext({key: 'document'}).snapshot)
      root.render(<App />)
    })
    expect(container.querySelector(asideSelector)).toBe(aside)
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })

  it('offers the site header a toggle for a signed-in reader, which opens and closes the panel', () => {
    act(() => root.render(<App />))
    expect(headerToggle?.isOpen).toBe(false)
    expect(container.querySelector(asideSelector)).toBeNull()

    act(() => headerToggle!.toggle())
    expect(headerToggle?.isOpen).toBe(true)
    expect(container.querySelector(asideSelector)).not.toBeNull()

    act(() => headerToggle!.toggle())
    expect(headerToggle?.isOpen).toBe(false)
    expect(container.querySelector(asideSelector)).toBeNull()
  })

  it('offers the site header no toggle to a signed-out visitor', () => {
    mockState.keyPair = null
    act(() => root.render(<App />))
    expect(headerToggle).toBeNull()
  })

  it('offers the site header no toggle until the reader has an agent here they can see', () => {
    mockState.hasAgents = false
    act(() => root.render(<App />))
    expect(headerToggle).toBeNull()
    // A mount document alone is not enough; the toggle arrives once an agent answers for this
    // account (shared with them, or public), and goes when none does.
    mockState.hasAgents = true
    act(() => root.render(<App />))
    expect(headerToggle).not.toBeNull()
    mockState.hasAgents = false
    act(() => root.render(<App />))
    expect(headerToggle).toBeNull()
  })

  it('offers the toggle, with the orphan count, to a reader whose only agents are orphans to adopt', () => {
    mockState.hasAgents = false
    mockState.orphans = 3
    act(() => root.render(<App />))
    expect(headerToggle).not.toBeNull()
    expect(headerToggle?.orphans).toBe(3)
    act(() => headerToggle!.toggle())
    expect(container.querySelector(asideSelector)).not.toBeNull()
  })

  it('never shows the agents panel to a signed-out visitor, even with a stored open preference', () => {
    // A previous signed-in visit left the panel open; a signed-out visitor must not see it.
    window.sessionStorage.setItem('seed.assistant.open', '1')
    mockState.keyPair = null
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true) // The preference survives for the next sign-in…
    expect(container.querySelector(asideSelector)).toBeNull() // …but nothing renders.

    // Narrow viewports get no full-screen panel either.
    mockState.isMobile = true
    act(() => root.render(<App />))
    expect(container.querySelector('[data-testid="web-assistant-panel-fullscreen"]')).toBeNull()
    mockState.isMobile = false

    // Signing in surfaces the panel exactly as the preference left it.
    mockState.keyPair = {id: 'reader'}
    act(() => root.render(<App />))
    expect(container.querySelector(asideSelector)).not.toBeNull()
  })

  it('takes the whole screen on narrow viewports, with a way back to the page', () => {
    mockState.isMobile = true
    act(() => root.render(<App />))
    act(() => controls!.open())
    expect(container.querySelector(asideSelector)).toBeNull()
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

  it('never takes over a narrow viewport on its own: a restored open preference waits for the header', () => {
    // A previous (wide) visit left the panel open; arriving on a phone must show the page, not the panel.
    window.sessionStorage.setItem('seed.assistant.open', '1')
    mockState.isMobile = true
    act(() => root.render(<App />))
    expect(controls!.isOpen).toBe(true) // The preference survives for a wider window…
    expect(controls!.openedByReader).toBe(false)
    expect(container.querySelector('[data-testid="web-assistant-panel-fullscreen"]')).toBeNull() // …but nothing covers the page.
    expect(document.body.style.overflow).toBe('')
    // The header button reads closed, and one tap opens the panel instead of closing the invisible one.
    expect(headerToggle?.isOpen).toBe(false)
    act(() => headerToggle!.toggle())
    expect(container.querySelector('[data-testid="web-assistant-panel-fullscreen"]')).not.toBeNull()
    expect(headerToggle?.isOpen).toBe(true)
    act(() => headerToggle!.toggle())
    expect(container.querySelector('[data-testid="web-assistant-panel-fullscreen"]')).toBeNull()
    expect(window.sessionStorage.getItem('seed.assistant.open')).toBe('0')
  })
})

describe('the shared slot', () => {
  it('opening Agents while Activity is in the route replaces the route panel away', () => {
    const feed = fakeSiteContext({key: 'document', panel: feedPanel})
    act(() => {
      publishSiteContext(feed.snapshot)
      root.render(<App />)
    })
    expect(container.querySelector(asideSelector)?.getAttribute('aria-label')).toBe('Activity')

    act(() => controls!.open())
    expect(feed.openRoute).toHaveBeenCalledWith({key: 'document', panel: null}, true)

    // The navigation commits: Agents holds the slot.
    act(() => publishSiteContext(fakeSiteContext({key: 'document', panel: null}).snapshot))
    expect(container.querySelector(asideSelector)?.getAttribute('aria-label')).toBe('Agents')
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })

  it('opening Activity while Agents is open closes Agents and shows the outlet', () => {
    act(() => root.render(<App page={<ActivityPage />} />))
    act(() => controls!.open())
    expect(container.querySelector(asideSelector)?.getAttribute('aria-label')).toBe('Agents')

    act(() => publishSiteContext(fakeSiteContext({key: 'document', panel: feedPanel}).snapshot))
    expect(controls!.isOpen).toBe(false)
    const aside = container.querySelector(asideSelector)
    expect(aside?.getAttribute('aria-label')).toBe('Activity')
    expect(aside?.querySelector('[data-testid="activity-content"]')).not.toBeNull()
    // Agents stays mounted, hidden, so an open chat would survive the switch.
    expect(container.querySelector('[data-testid="panel-content"]')).not.toBeNull()
  })

  it('a restored assistant loses the slot to an Activity route at arrival, without touching the route', () => {
    window.sessionStorage.setItem('seed.assistant.open', '1')
    const feed = fakeSiteContext({key: 'document', panel: feedPanel})
    act(() => {
      publishSiteContext(feed.snapshot)
      root.render(<App />)
    })
    expect(container.querySelector(asideSelector)?.getAttribute('aria-label')).toBe('Activity')
    expect(controls!.isOpen).toBe(false)
    expect(feed.openRoute).not.toHaveBeenCalled()
  })

  it('shows Activity to a signed-out reader whose route carries it', () => {
    mockState.keyPair = null
    act(() => {
      publishSiteContext(fakeSiteContext({key: 'document', panel: feedPanel}).snapshot)
      root.render(<App page={<ActivityPage />} />)
    })
    const aside = container.querySelector(asideSelector)
    expect(aside?.getAttribute('aria-label')).toBe('Activity')
    expect(aside?.querySelector('[data-testid="activity-content"]')).not.toBeNull()
  })

  it('reads the header toggle as closed while Activity holds the slot', () => {
    const feed = fakeSiteContext({key: 'document', panel: feedPanel})
    act(() => {
      publishSiteContext(feed.snapshot)
      root.render(<App />)
    })
    expect(container.querySelector(asideSelector)?.getAttribute('aria-label')).toBe('Activity')
    expect(headerToggle?.isOpen).toBe(false)
    // Toggling opens Agents — and the slot closes Activity for it. While the route still carries
    // the feed panel the toggle keeps reading closed; once the navigation commits Agents is on
    // screen and it reads open.
    act(() => headerToggle!.toggle())
    expect(feed.openRoute).toHaveBeenCalledWith({key: 'document', panel: null}, true)
    expect(headerToggle?.isOpen).toBe(false)
    act(() => publishSiteContext(fakeSiteContext({key: 'document', panel: null}).snapshot))
    expect(headerToggle?.isOpen).toBe(true)
  })
})

describe('Activity in the side panel', () => {
  it('keeps the page input and focus across Activity opening, switching tabs, and closing', () => {
    act(() => root.render(<App page={<ActivityPage />} />))
    const input = container.querySelector<HTMLInputElement>('[data-testid="page-input"]')!
    act(() => {
      input.value = 'Unfinished edit'
      Simulate.change(input)
      input.focus()
    })
    const publish = (panel: any) => act(() => publishSiteContext(fakeSiteContext({key: 'document', panel}).snapshot))
    for (const panel of [{key: 'feed', tab: 'to-you'}, {key: 'feed', tab: 'all-updates'}, null]) {
      publish(panel)
      expect(container.querySelector('[data-testid="page-input"]')).toBe(input)
      expect(input.value).toBe('Unfinished edit')
      const aside = container.querySelector(asideSelector)
      if (panel) {
        expect(aside?.querySelector('[data-testid="activity-content"]')).not.toBeNull()
        // The portal keeps the content out of the page itself.
        expect(container.querySelector('[data-testid="page"] [data-testid="activity-content"]')).toBeNull()
        aside?.querySelector<HTMLButtonElement>('[data-testid="activity-content"]')!.focus()
      } else {
        expect(document.activeElement).toBe(input)
      }
    }
  })

  it('renders nothing in the aside on narrow screens — Activity stays in the page', () => {
    mockState.isMobile = true
    act(() => {
      publishSiteContext(fakeSiteContext({key: 'document', panel: feedPanel}).snapshot)
      root.render(<App page={<ActivityPage />} />)
    })
    expect(container.querySelector(asideSelector)).toBeNull()
    expect(container.querySelector('[data-testid="activity-content"]')).toBeNull()
    expect(container.querySelector('[data-testid="page-input"]')).not.toBeNull()
  })
})
