import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

/**
 * Space Settings → Agents.
 *
 * The owner picks a server from the ones this app already talks to and an agent from that server's
 * public agents — neither is typed, and publishing never changes an agent's access. The published
 * order carries one meaning, the default, so the list offers a promote button rather than reordering.
 * The server and the published list are saved together into the space's home document.
 */

const mockState = vi.hoisted(() => ({
  metadata: {} as Record<string, unknown>,
  servers: [] as string[],
  localServerUrl: null as string | null,
  agents: [] as any[],
  isSiteOwner: true,
}))
const mocks = vi.hoisted(() => ({
  updateHome: vi.fn(async () => {}),
  setPublicRead: vi.fn(async () => {}),
  setPublicChat: vi.fn(async () => {}),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/models/site', () => ({
  useUpdateHomeDocument: () => ({mutateAsync: mocks.updateHome, isPending: false}),
}))
vi.mock('@shm/shared/models/capabilities', () => ({
  useIsSiteOwner: () => ({isSiteOwner: mockState.isSiteOwner, isLoading: false}),
}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({
    isInitialLoading: false,
    data: {type: 'document', document: {metadata: mockState.metadata}},
  }),
}))
vi.mock('@shm/ui/agents/account', () => ({useSelectedAccountId: () => 'owner-uid'}))
vi.mock('@shm/ui/agents/client', () => ({
  normalizeAgentServerUrl: (value: string) => new URL(value).origin,
}))
vi.mock('@shm/ui/agents/models', () => ({
  describeAgentServer: (serverUrl: string, localServerUrl: string | null) =>
    localServerUrl === serverUrl ? 'Local Agents' : new URL(serverUrl).host,
  isLocalAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    !!localServerUrl && serverUrl === localServerUrl,
  useAgentList: () => ({data: mockState.agents, isInitialLoading: false, isError: false, error: null}),
  useAgentServerUrls: () => ({data: mockState.servers}),
  useLocalAgentServerUrl: () => ({data: mockState.localServerUrl}),
  useSetAgentPublicRead: () => ({mutateAsync: mocks.setPublicRead, isLoading: false}),
  useSetAgentPublicChat: () => ({mutateAsync: mocks.setPublicChat, isLoading: false}),
}))
vi.mock('@shm/ui/agents/platform', () => ({getAgentsPlatform: () => ({})}))
vi.mock('@shm/ui/toast', () => ({toast: {error: mocks.toastError, success: mocks.toastSuccess}}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => mocks.navigate}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@sentry/electron/renderer', () => ({}))

import {hmId} from '@shm/shared/utils/entity-id-url'
import {TooltipProvider} from '@shm/ui/tooltip'
import {SpaceAgentsSettings} from '@/components/site-settings-agents'

const agent = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  definition: {name},
  status: 'idle',
  accessRole: 'owner',
  publicRead: true,
  publicChat: false,
  ...extra,
})

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(
      <TooltipProvider>
        <SpaceAgentsSettings siteId={hmId('space-uid')} />
      </TooltipProvider>,
    )
  })
}

/**
 * Flushes the promises a click handler kicked off.
 *
 * Note that {@link chooseFromSelect} and {@link click} run their own `act()`, so they must be
 * called outside one: a nested `act` defers the flush and the assertions would read stale DOM.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

function click(element: Element | null | undefined) {
  expect(element).toBeTruthy()
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

/** Every published row's text, top to bottom. */
function publishedRows(): string[] {
  return Array.from(container.querySelectorAll('[data-testid="published-agent"]')).map((row) => row.textContent ?? '')
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
}

/** The option labels a Radix Select offers, found by its trigger text. */
function selectOptions(triggerText: string): string[] {
  const trigger = Array.from(container.querySelectorAll('[data-slot="select-trigger"]')).find(
    (element) => element.textContent?.includes(triggerText),
  )
  expect(trigger, `no select trigger showing "${triggerText}"`).toBeTruthy()
  act(() => {
    trigger!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
  return Array.from(document.querySelectorAll('[data-slot="select-item"]')).map((item) => item.textContent ?? '')
}

/** Opens a Radix Select by its trigger text and picks the option labeled `option`. */
function chooseFromSelect(triggerText: string, option: string) {
  const trigger = Array.from(container.querySelectorAll('[data-slot="select-trigger"]')).find(
    (element) => element.textContent?.includes(triggerText),
  )
  expect(trigger, `no select trigger showing "${triggerText}"`).toBeTruthy()
  act(() => {
    // Radix opens on click when it has not seen a mouse pointerdown, which jsdom never sends.
    trigger!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
  const item = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find(
    (element) => element.textContent === option,
  )
  expect(item, `no option labeled "${option}"`).toBeTruthy()
  act(() => {
    item!.dispatchEvent(new PointerEvent('pointermove', {bubbles: true}))
    item!.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0}))
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom implements none of these; Radix's Select trigger calls them on open.
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
  if (!(globalThis as any).PointerEvent) {
    ;(globalThis as any).PointerEvent = class extends MouseEvent {
      readonly pointerId = 1
      readonly pointerType = 'mouse'
      readonly isPrimary = true
    }
  }
  mockState.metadata = {}
  mockState.servers = []
  mockState.localServerUrl = null
  mockState.agents = []
  mockState.isSiteOwner = true
  mocks.updateHome.mockClear()
  mocks.setPublicRead.mockClear()
  mocks.setPublicChat.mockClear()
  mocks.toastError.mockClear()
  mocks.toastSuccess.mockClear()
  mocks.navigate.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SpaceAgentsSettings', () => {
  it('renders published agents in order, naming them from the server rather than the document', () => {
    // Agent ids are uuids, which is why they are never rendered: they name nothing a person knows.
    const docsId = '2b9d0c5a-1f4e-4d55-9b1c-7c1e2f3a4b5c'
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {[docsId]: 0, support: 1}}
    mockState.agents = [agent('support', 'Support'), agent(docsId, 'Docs Helper')]
    render()
    // The document stores ids and order only; a rename on the server shows up here immediately.
    expect(publishedRows()[0]).toContain('Docs Helper')
    expect(publishedRows()[1]).toContain('Support')
    expect(container.textContent).not.toContain(docsId)
  })

  it('tags the first published agent as the default and offers to promote the rest', () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0, support: 1}}
    mockState.agents = [agent('docs', 'Docs Helper'), agent('support', 'Support')]
    render()
    expect(publishedRows()[0]).toContain('Default')
    expect(publishedRows()[1]).not.toContain('Default')
    // Only the non-default rows can be promoted.
    expect(container.querySelectorAll('[data-testid="published-agent"]')[0]!.textContent).not.toContain('Make default')
    expect(publishedRows()[1]).toContain('Make default')
  })

  it('opens the agent page when a published row is clicked', () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0}}
    mockState.agents = [agent('docs', 'Docs Helper')]
    render()
    click(container.querySelector('[data-testid="published-agent"]'))
    expect(mocks.navigate).toHaveBeenCalledWith({
      key: 'agent',
      agentId: 'docs',
      serverUrl: 'https://agents.example',
    })
  })

  it('does not navigate when a row control is used', () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0, support: 1}}
    mockState.agents = [agent('docs', 'Docs Helper'), agent('support', 'Support')]
    render()
    click(buttonByText('Make default'))
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(publishedRows()[0]).toContain('Support')
  })

  it('warns when a published agent is private, because no reader can see it', () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0}}
    mockState.agents = [agent('docs', 'Docs Helper', {publicRead: false})]
    render()
    expect(container.textContent).toContain('Private — readers of this space cannot see it')
  })

  it('promotes and removes, then saves the server and the published order together', async () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0, support: 1, extra: 2}}
    mockState.agents = [agent('docs', 'Docs Helper'), agent('support', 'Support'), agent('extra', 'Extra')]
    render()

    // Nothing to save until something is edited.
    expect(buttonByText('Save')?.disabled).toBe(true)

    // "Make default" on the second row; the first row has no such button.
    click(container.querySelectorAll('[data-testid="published-agent"]')[1]!.querySelector('button'))
    expect(publishedRows()[0]).toContain('Support')

    click(container.querySelectorAll('[aria-label="Remove from this space"]')[2])
    expect(publishedRows()).toHaveLength(2)

    click(buttonByText('Save'))
    await settle()
    expect(mocks.updateHome).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        agentServerUrl: 'https://agents.example',
        // Renumbered densely; the dropped agent is absent, which the change diff turns into a removal.
        spaceAgents: {support: 0, docs: 1},
      }),
    })
  })

  it('offers only public agents, and says how many are held back', () => {
    // A private agent is not publishable and publishing never makes one public: opening an agent to
    // the world is a decision made on the agent, not a side effect of listing it on a space.
    mockState.metadata = {agentServerUrl: 'https://agents.example'}
    mockState.agents = [agent('secret', 'Secret', {publicRead: false})]
    render()
    expect(container.textContent).toContain('No public agents to add')
    expect(container.textContent).toContain('One agent on this server is private')

    mockState.agents = [agent('secret', 'Secret', {publicRead: false}), agent('open', 'Open')]
    render()
    expect(container.textContent).toContain('Add an agent…')
  })

  it('offers nothing more once every public agent is published', () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {mine: 0}}
    mockState.agents = [agent('mine', 'Mine')]
    render()
    expect(container.textContent).toContain('No public agents to add')
  })

  it("publishes without touching the agent's access", async () => {
    mockState.metadata = {agentServerUrl: 'https://agents.example'}
    mockState.agents = [agent('docs', 'Docs Helper')]
    render()

    chooseFromSelect('Add an agent…', 'Docs Helper')
    await settle()
    expect(mocks.setPublicRead).not.toHaveBeenCalled()
    expect(mocks.setPublicChat).not.toHaveBeenCalled()
    expect(publishedRows()[0]).toContain('Docs Helper')
  })

  it('empties the published list when the server changes, and restores it on switching back', () => {
    // Published ids name agents on one particular server and mean nothing on another.
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0}}
    mockState.servers = ['https://agents.example', 'https://other.example']
    mockState.agents = [agent('docs', 'Docs Helper')]
    render()
    expect(publishedRows()).toHaveLength(1)

    chooseFromSelect('agents.example', 'other.example')
    expect(publishedRows()).toHaveLength(0)

    chooseFromSelect('other.example', 'agents.example')
    expect(publishedRows()).toHaveLength(1)
  })

  it('leaves the local server out of the options, since no visitor can reach this computer', () => {
    mockState.localServerUrl = 'http://localhost:3050'
    mockState.servers = ['http://localhost:3050', 'https://agents.example']
    mockState.metadata = {}
    render()
    expect(selectOptions('No agents server')).toEqual(['No agents server', 'agents.example'])
  })

  it('still explains a space that already advertises this computer', () => {
    // Not selectable, but a space that somehow holds that value has to be told why it is broken.
    mockState.localServerUrl = 'http://localhost:3050'
    mockState.metadata = {agentServerUrl: 'http://localhost:3050'}
    render()
    expect(container.textContent).toContain('Local Agents runs only on this computer')
  })

  it('hides the published list until a server is chosen', () => {
    // The ids name agents on one particular server; without one they are addresses to nowhere.
    mockState.metadata = {}
    mockState.servers = ['https://agents.example']
    mockState.agents = [agent('docs', 'Docs Helper')]
    render()
    expect(container.textContent).not.toContain('Published agents')

    chooseFromSelect('No agents server', 'agents.example')
    expect(container.textContent).toContain('Published agents')
    expect(container.textContent).toContain('Add an agent…')
  })

  it('leaves everything to the space owner', () => {
    mockState.isSiteOwner = false
    mockState.metadata = {agentServerUrl: 'https://agents.example', spaceAgents: {docs: 0}}
    render()
    expect(container.textContent).toContain('Only the space owner can edit these settings')
    expect(buttonByText('Save')).toBeUndefined()
  })
})
