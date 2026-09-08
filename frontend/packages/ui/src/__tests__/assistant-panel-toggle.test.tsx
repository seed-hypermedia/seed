// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The site header's way into the agents panel: a button beside search on wide layouts and a row in
 * the mobile menu. Both are offered only where a host provides the toggle (web, signed in) and the
 * reader has an agents server to talk to — the one the space names, or the deployment's default.
 */

const mockState = vi.hoisted(() => ({
  homeMetadata: {} as Record<string, unknown>,
  envServerUrl: undefined as string | undefined,
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: {type: 'document', document: {metadata: mockState.homeMetadata}}}),
}))
vi.mock('@shm/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get SEED_AGENT_SERVER_URL() {
    return mockState.envServerUrl
  },
}))

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
  mockState.homeMetadata = {}
  mockState.envServerUrl = undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('agents panel entry points in the site header', () => {
  it('offers both entry points on a space that names an agents server', () => {
    mockState.homeMetadata = {agentServerUrl: 'https://agents.example'}
    render({isOpen: false, toggle: vi.fn()})
    expect(container.querySelector('button[aria-label="Agents"]')).not.toBeNull()
    expect(container.textContent).toContain('Agents')
  })

  it('offers nothing on a space that names none, on a deployment with no default server', () => {
    mockState.homeMetadata = {name: 'A Space'}
    render({isOpen: false, toggle: vi.fn()})
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).not.toContain('Agents')
  })

  it('treats an empty server setting as none', () => {
    mockState.homeMetadata = {agentServerUrl: ''}
    render({isOpen: false, toggle: vi.fn()})
    expect(container.textContent).not.toContain('Agents')
  })

  it('offers both on any space when the deployment names a default server', () => {
    mockState.envServerUrl = 'http://localhost:3051'
    render({isOpen: false, toggle: vi.fn()})
    expect(container.querySelector('button[aria-label="Agents"]')).not.toBeNull()
    expect(container.textContent).toContain('Agents')
  })

  it('offers nothing where no host provides the toggle, such as desktop', () => {
    mockState.envServerUrl = 'http://localhost:3051'
    mockState.homeMetadata = {agentServerUrl: 'https://agents.example'}
    render(null)
    expect(container.textContent).not.toContain('Agents')
  })

  it('toggles the panel, reflects its open state, and lets the mobile menu close itself', () => {
    mockState.envServerUrl = 'http://localhost:3051'
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
