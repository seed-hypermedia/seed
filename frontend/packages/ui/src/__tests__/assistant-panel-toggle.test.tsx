// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The site header's way into the agents panel: a button beside search on wide layouts and a row in
 * the mobile menu. Both go by the toggle the host offers, and nothing else: the host hands one
 * over only to a signed-in reader with an agent they can see in the space (the web host decides
 * that from the mounted agents its activity tracker could fetch), so the header itself asks no
 * document query and no server.
 */

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
          <AssistantPanelHeaderButton />
          <AssistantPanelMenuItem onClick={onMenuClick} />
        </AssistantPanelToggleContext.Provider>
      </TooltipProvider>,
    )
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('agents panel entry points in the site header', () => {
  it('offers both entry points where the host provides a toggle', () => {
    render({isOpen: false, toggle: vi.fn()})
    expect(container.querySelector('button[aria-label="Agents"]')).not.toBeNull()
    expect(container.textContent).toContain('Agents')
  })

  it('offers nothing where no host provides the toggle: desktop, signed out, or no agent the reader can see', () => {
    render(null)
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).not.toContain('Agents')
  })

  it('flags orphan agents with a red dot on both entry points and counts them in the labels', () => {
    render({isOpen: false, toggle: vi.fn(), orphans: 2})
    expect(container.querySelectorAll('[data-testid="agent-orphans-dot"]')).toHaveLength(2)
    expect(container.textContent).toContain('2 orphan agents to adopt')
    render({isOpen: false, toggle: vi.fn(), orphans: 0})
    expect(container.querySelectorAll('[data-testid="agent-orphans-dot"]')).toHaveLength(0)
    expect(container.textContent).not.toContain('to adopt')
  })

  it('keeps activity in the header tooltip without showing activity dots on either entry point', () => {
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
