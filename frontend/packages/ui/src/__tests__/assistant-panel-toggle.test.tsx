// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The site header's way into the agents panel: a button beside search on wide layouts and a row in
 * the mobile menu. Both are offered only where a host provides the toggle (web, signed in) and the
 * space has agents, which means mount documents; a deployment default server adds nothing here.
 */

const mockState = vi.hoisted(() => ({
  mounts: [] as Array<{agentId: string; serverUrl: string; name: string; path: string}>,
  askedFor: [] as string[],
}))

vi.mock('../site-agents', () => ({
  useSiteAgentMounts: (siteUid: string) => {
    mockState.askedFor.push(siteUid)
    return {data: mockState.mounts, isInitialLoading: false}
  },
}))

const MOUNT = {agentId: 'hm://space-uid/helper', serverUrl: 'https://agents.example', name: 'Helper', path: '/helper'}

import {
  AssistantPanelHeaderButton,
  AssistantPanelMenuItem,
  AssistantPanelToggleContext,
  type AssistantPanelToggle,
} from '../assistant-panel-toggle'
import {TooltipProvider} from '../tooltip'

let container: HTMLDivElement
let root: Root

function render(toggle: AssistantPanelToggle | null, onMenuClick?: () => void) {
  act(() => {
    root.render(
      <TooltipProvider>
        <AssistantPanelToggleContext.Provider value={toggle}>
          <AssistantPanelHeaderButton siteUid="space-uid" />
          <AssistantPanelMenuItem siteUid="space-uid" onClick={onMenuClick} />
        </AssistantPanelToggleContext.Provider>
      </TooltipProvider>,
    )
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.mounts = []
  mockState.askedFor = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('agents panel entry points in the site header', () => {
  it('offers both entry points on a space with a mounted agent, found through its documents', () => {
    mockState.mounts = [MOUNT]
    render({isOpen: false, toggle: vi.fn()})
    expect(mockState.askedFor).toContain('space-uid')
    expect(container.querySelector('button[aria-label="Agents"]')).not.toBeNull()
    expect(container.textContent).toContain('Agents')
  })

  it('offers nothing on a space with no mounted agents', () => {
    render({isOpen: false, toggle: vi.fn()})
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).not.toContain('Agents')
  })

  it('offers nothing where no host provides the toggle, such as desktop', () => {
    mockState.mounts = [MOUNT]
    render(null)
    expect(container.textContent).not.toContain('Agents')
  })

  it('keeps activity in the header tooltip without showing dots on either entry point', () => {
    mockState.mounts = [MOUNT]
    render({
      isOpen: false,
      toggle: vi.fn(),
      activity: {
        tone: 'agent',
        unread: true,
        serverUrl: 'http://localhost:3051',
        agentId: 'a',
        agentName: 'Researcher',
        sessionId: 's',
        label: 'Researcher replied',
      },
    })
    expect(container.querySelectorAll('[data-testid="agent-activity-dot"]')).toHaveLength(0)
    expect(container.querySelector('button[aria-label="Agents"]')).not.toBeNull()
    expect(container.textContent).toContain('Agents')
  })

  it('toggles the panel, reflects its open state, and lets the mobile menu close itself', () => {
    mockState.mounts = [MOUNT]
    const toggle = vi.fn()
    const onMenuClick = vi.fn()
    render({isOpen: true, toggle}, onMenuClick)

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Agents"]')!
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('Close Agents')

    act(() => button.click())
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(onMenuClick).not.toHaveBeenCalled()

    const row = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
      (el) => el !== button && el.textContent === 'Close Agents' && el.closest('button') !== button,
    )!
    act(() => row.closest('button')!.click())
    expect(toggle).toHaveBeenCalledTimes(2)
    expect(onMenuClick).toHaveBeenCalledTimes(1)
  })
})
