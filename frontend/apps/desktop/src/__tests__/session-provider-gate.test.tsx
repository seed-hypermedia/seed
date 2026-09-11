import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * An agent whose provider is gone must stop before a send, and the gate must always leave a way
 * forward: a picker when the server has providers, and for the owner an "Add provider" step when
 * it has none (an empty picker is a dead end).
 */

const mockState = vi.hoisted(() => ({
  providers: [] as Array<{id: string; name: string; type: string}>,
  pickerProps: null as null | Record<string, any>,
  openAddProvider: vi.fn(),
}))

vi.mock('@shm/ui/agents/models', () => ({
  useModelProviders: () => ({data: mockState.providers, isFetching: false}),
  useUpdateAgent: () => ({isLoading: false, mutateAsync: vi.fn()}),
  useUpdateAgentSession: () => ({isLoading: false, mutateAsync: vi.fn()}),
}))
vi.mock('@shm/ui/agents/provider-model-select', () => ({
  ProviderModelSelect: (props: Record<string, any>) => {
    mockState.pickerProps = props
    return <div data-testid="picker" />
  },
}))
vi.mock('@shm/ui/agents/dialogs', () => ({AddModelProviderDialog: () => null}))
vi.mock('@shm/ui/universal-dialog', () => ({
  useAppDialog: () => ({content: null, open: mockState.openAddProvider, close: vi.fn()}),
}))
vi.mock('@shm/ui/agents/reasoning-select', () => ({coerceReasoningLevel: () => undefined}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

import {SessionProviderGate} from '@shm/ui/agents/session-provider-gate'

const definition = {name: 'Agent', systemPrompt: '', modelProvider: 'OpenAI', model: 'gpt'} as any
let container: HTMLDivElement
let root: Root

function render(props: Partial<React.ComponentProps<typeof SessionProviderGate>> = {}) {
  act(() => {
    root.render(
      <SessionProviderGate
        serverUrl="https://agents.example"
        accountUid="owner"
        agentId="agent-1"
        definition={definition}
        missingProvider="OpenAI"
        canWrite
        {...props}
      />,
    )
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.providers = []
  mockState.pickerProps = null
  mockState.openAddProvider = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SessionProviderGate', () => {
  it('asks the owner to add a provider when the server has none', () => {
    render({canAddProvider: true})
    expect(container.textContent).toContain('Choose a model to start')
    expect(container.textContent).toContain('No model providers are configured on this server')
    expect(mockState.pickerProps).toBeNull()
    const add = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Add provider'))
    expect(add).toBeDefined()
    act(() => add!.click())
    expect(mockState.openAddProvider).toHaveBeenCalledWith({
      serverUrl: 'https://agents.example',
      selectedAccountId: 'owner',
    })
  })

  it('tells a writer who cannot add providers that the owner must', () => {
    render({canAddProvider: false})
    expect(container.textContent).toContain('The agent’s owner needs to add a provider first.')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Add provider'))).toBe(
      false,
    )
  })

  it('offers the picker, with Add provider for the owner, when other providers exist', () => {
    mockState.providers = [{id: 'p1', name: 'Anthropic', type: 'anthropic'}]
    render({canAddProvider: true, sessionId: 'session-1'})
    expect(container.textContent).toContain('Choose a model to continue')
    expect(container.textContent).toContain('this session was using')
    expect(mockState.pickerProps?.onAddProvider).toBeTypeOf('function')

    render({canAddProvider: false, sessionId: 'session-1'})
    expect(mockState.pickerProps?.onAddProvider).toBeUndefined()
  })
})
