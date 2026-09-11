import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The draft composer on the Agents pages starts a session on the agent and model shown under it.
 * A model chosen for one agent must never reach another: the picker offers only the selected
 * agent's models, and switching agents starts from that agent's own default settings.
 */

const mockState = vi.hoisted(() => ({
  badgeProps: null as null | Record<string, any>,
  composerProps: null as null | Record<string, any>,
  createCalls: [] as Array<Record<string, unknown>>,
  missingProvider: null as string | null,
  gateProps: null as null | Record<string, any>,
}))

vi.mock('@shm/ui/agents/models', () => ({
  addOptimisticSessionMessage: (_s: string, _a: string, _id: string, messages: unknown[]) => messages,
  addOptimisticSessionToCaches: vi.fn(),
  describeAgentServer: (serverUrl: string) => serverUrl,
  useCreateAgentSessionOnServer: () => ({
    isLoading: false,
    mutateAsync: async (input: Record<string, unknown>) => {
      mockState.createCalls.push(input)
      return {_: 'CreateSessionResponse', sessionId: `session-${mockState.createCalls.length}`}
    },
  }),
  useMessageAgentSession: () => ({isLoading: false, mutate: vi.fn()}),
}))
vi.mock('@shm/ui/agents/navigation', () => ({useNavigate: () => vi.fn()}))
vi.mock('@shm/ui/agents/rich-message-composer', () => ({
  AgentRichMessageComposer: (props: Record<string, any>) => {
    mockState.composerProps = props
    return null
  },
}))
vi.mock('@shm/ui/agents/header', () => ({
  SessionModelBadge: (props: Record<string, any>) => {
    mockState.badgeProps = props
    return null
  },
}))
vi.mock('@shm/ui/agents/session-provider-gate', () => ({
  useMissingSessionProvider: () => mockState.missingProvider,
  SessionProviderGate: (props: Record<string, any>) => {
    mockState.gateProps = props
    return <div data-testid="provider-gate" />
  },
}))
// Radix menus only mount their content once opened; render every part inline so items are clickable.
vi.mock('@shm/ui/components/dropdown-menu', () => {
  const Inline = ({children, asChild: _asChild, ...props}: any) => <div {...props}>{children}</div>
  return {
    DropdownMenu: Inline,
    DropdownMenuTrigger: Inline,
    DropdownMenuContent: Inline,
    DropdownMenuLabel: Inline,
    DropdownMenuItem: ({children, onClick}: any) => (
      <button type="button" data-testid="agent-option" onClick={onClick}>
        {children}
      </button>
    ),
  }
})
vi.mock('@shm/ui/toast', () => ({toast: {error: vi.fn(), success: vi.fn(), message: vi.fn()}}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

import {choiceForAgent, NewSessionComposer, type NewSessionAgent} from '@shm/ui/agents/new-session-composer'

const SERVER = 'https://agents.example'
function agent(id: string, name: string, provider: string, model: string, enabled?: Array<[string, string]>) {
  return {
    serverUrl: SERVER,
    agent: {
      id,
      account: 'owner',
      stateDir: '',
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      accessRole: 'owner',
      definition: {
        name,
        systemPrompt: '',
        modelProvider: provider,
        model,
        ...(enabled ? {enabledModels: enabled.map(([p, m]) => ({provider: p, model: m}))} : {}),
      },
    },
  } as unknown as NewSessionAgent
}
const ALPHA = agent('alpha', 'Alpha', 'openai', 'gpt-a', [
  ['openai', 'gpt-a'],
  ['openai', 'gpt-a-mini'],
])
const BRAVO = agent('bravo', 'Bravo', 'anthropic', 'claude-b')
const AGENTS = [ALPHA, BRAVO]
const ALPHA_MINI = {provider: 'openai', model: 'gpt-a-mini'}

let container: HTMLDivElement
let root: Root

function render(defaultAgent?: {serverUrl: string; agentId: string}) {
  act(() => {
    root.render(
      <NewSessionComposer agents={AGENTS} accountUid="account-1" localServerUrl={null} defaultAgent={defaultAgent} />,
    )
  })
}

function pickAgent(name: string) {
  const option = Array.from(container.querySelectorAll('[data-testid="agent-option"]')).find(
    (node) => node.textContent?.includes(name),
  ) as HTMLButtonElement | undefined
  if (!option) throw new Error(`no agent option named ${name}`)
  act(() => option.click())
}

async function send() {
  await act(async () => {
    mockState.composerProps!.onSend({text: 'hello', blocks: []})
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return mockState.createCalls.at(-1)!
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.badgeProps = null
  mockState.composerProps = null
  mockState.createCalls = []
  mockState.missingProvider = null
  mockState.gateProps = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('choiceForAgent', () => {
  it("keeps an override from the agent's own list and drops any other", () => {
    expect(choiceForAgent({modelOverride: ALPHA_MINI, thoroughness: 'deep'}, ALPHA.agent)).toEqual({
      modelOverride: ALPHA_MINI,
      thoroughness: 'deep',
    })
    expect(choiceForAgent({modelOverride: ALPHA_MINI, thoroughness: 'deep'}, BRAVO.agent)).toEqual({
      thoroughness: 'deep',
    })
    // The agent's own pair counts even when it has no enabled-models list.
    expect(choiceForAgent({modelOverride: {provider: 'anthropic', model: 'claude-b'}}, BRAVO.agent)).toEqual({
      modelOverride: {provider: 'anthropic', model: 'claude-b'},
    })
  })
})

describe('NewSessionComposer model choice', () => {
  it('sends the model picked for the selected agent', async () => {
    render()
    expect(mockState.badgeProps!.agent.id).toBe('alpha')
    act(() => mockState.badgeProps!.draft.onChange({modelOverride: ALPHA_MINI}))
    expect(mockState.badgeProps!.modelOverride).toEqual(ALPHA_MINI)

    const created = await send()
    expect(created).toMatchObject({serverUrl: SERVER, agentId: 'alpha', modelOverride: ALPHA_MINI})
  })

  it("switching agents resets to the new agent's default, even if a stale commit arrives", async () => {
    render()
    act(() => mockState.badgeProps!.draft.onChange({modelOverride: ALPHA_MINI, thoroughness: 'deep'}))
    const alphaBadgeOnChange = mockState.badgeProps!.draft.onChange

    pickAgent('Bravo')
    expect(mockState.badgeProps!.agent.id).toBe('bravo')
    expect(mockState.badgeProps!.modelOverride).toBeUndefined()
    expect(mockState.badgeProps!.thoroughness).toBeUndefined()

    // A debounced reasoning commit from Alpha's badge landing after the switch.
    act(() => alphaBadgeOnChange({modelOverride: ALPHA_MINI}))
    expect(mockState.badgeProps!.modelOverride).toBeUndefined()

    const created = await send()
    expect(created).toMatchObject({agentId: 'bravo'})
    expect(created).not.toHaveProperty('modelOverride')
    expect(created).not.toHaveProperty('thoroughness')
  })

  it('switching back does not restore the earlier choice', () => {
    render()
    act(() => mockState.badgeProps!.draft.onChange({modelOverride: ALPHA_MINI}))
    pickAgent('Bravo')
    pickAgent('Alpha')
    expect(mockState.badgeProps!.agent.id).toBe('alpha')
    expect(mockState.badgeProps!.modelOverride).toBeUndefined()
  })

  it('an agent whose provider is gone gets the provider gate instead of the editor', () => {
    mockState.missingProvider = 'OpenAI'
    render()
    expect(container.querySelector('[data-testid="provider-gate"]')).not.toBeNull()
    // Nothing to send from and no model to pick until a provider exists.
    expect(mockState.composerProps).toBeNull()
    expect(mockState.badgeProps).toBeNull()
    expect(mockState.gateProps).toMatchObject({agentId: 'alpha', missingProvider: 'OpenAI', canAddProvider: true})
    expect(mockState.gateProps).not.toHaveProperty('sessionId')
    // The agent picker stays, so another agent can still be chosen.
    expect(container.querySelectorAll('[data-testid="agent-option"]')).toHaveLength(2)
  })

  it('keeps the first default agent when the most recent session changes', async () => {
    render({serverUrl: SERVER, agentId: 'alpha'})
    act(() => mockState.badgeProps!.draft.onChange({modelOverride: ALPHA_MINI}))
    // Activity on another agent's session moves it to the top of the list.
    render({serverUrl: SERVER, agentId: 'bravo'})
    expect(mockState.badgeProps!.agent.id).toBe('alpha')
    expect(mockState.badgeProps!.modelOverride).toEqual(ALPHA_MINI)

    const created = await send()
    expect(created).toMatchObject({agentId: 'alpha', modelOverride: ALPHA_MINI})
  })
})
