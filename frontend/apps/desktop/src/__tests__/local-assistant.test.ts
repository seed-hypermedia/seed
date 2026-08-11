import {describe, expect, it, vi} from 'vitest'
import type {AgentInfo, ModelProviderInfo, ProviderModelInfo} from '../agents-client'

// The module under test reaches hooks in @/models/agents, which pull in the tRPC/gRPC clients;
// neither exists outside Electron. The functions under test are pure.
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
import {
  buildLocalAssistantDefinition,
  LOCAL_ASSISTANT_NAME,
  resolveLocalAssistantProvisioning,
} from '../models/local-assistant'

/**
 * The provisioning decision for the built-in local Assistant.
 *
 * The regression this guards: a fresh install has zero agents, so every assistant entry point is
 * hidden until something creates one — but creating too eagerly (while lists are still loading, or
 * when the user already has agents, or before a provider exists so `CreateAgent` would 400)
 * either duplicates agents or fails. The decision must fire exactly in the one state where
 * creation is both needed and possible.
 */

const provider = (name: string, type = 'anthropic'): ModelProviderInfo =>
  ({id: `id-${name}`, name, type, hasSecrets: true, createdAt: 1, updatedAt: 1}) as ModelProviderInfo

const model = (id: string): ProviderModelInfo => ({id}) as ProviderModelInfo

const agent = (name: string): AgentInfo =>
  ({
    id: `agent-${name}`,
    definition: {name, systemPrompt: '', modelProvider: 'p', model: 'm'},
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
  }) as AgentInfo

const readyInput = {
  serverUrl: 'http://localhost:3050',
  accountUid: 'z6MkTest',
  agents: [] as AgentInfo[],
  providers: [provider('my-anthropic')],
  providerModels: [model('claude-sonnet-5')],
}

describe('resolveLocalAssistantProvisioning', () => {
  it('creates the Assistant when the server is empty and a provider with models exists', () => {
    const definition = resolveLocalAssistantProvisioning(readyInput)
    expect(definition?.name).toBe(LOCAL_ASSISTANT_NAME)
    expect(definition?.modelProvider).toBe('my-anthropic')
    expect(definition?.model).toBe('claude-sonnet-5')
  })

  it('waits while any prerequisite is still unknown', () => {
    // Undefined means loading or failed — acting on it would double-create on a slow list.
    expect(resolveLocalAssistantProvisioning({...readyInput, agents: undefined})).toBeNull()
    expect(resolveLocalAssistantProvisioning({...readyInput, providers: undefined})).toBeNull()
    expect(resolveLocalAssistantProvisioning({...readyInput, providerModels: undefined})).toBeNull()
    expect(resolveLocalAssistantProvisioning({...readyInput, serverUrl: null})).toBeNull()
    expect(resolveLocalAssistantProvisioning({...readyInput, accountUid: null})).toBeNull()
  })

  it('does nothing when the account already has any agent, not just an Assistant', () => {
    // A user who renamed or replaced the Assistant must not get a second one.
    expect(resolveLocalAssistantProvisioning({...readyInput, agents: [agent('Research Bot')]})).toBeNull()
  })

  it('does nothing before a model provider is configured, because CreateAgent would reject it', () => {
    expect(resolveLocalAssistantProvisioning({...readyInput, providers: []})).toBeNull()
  })

  it('does nothing when the provider offers no usable chat model', () => {
    expect(
      resolveLocalAssistantProvisioning({...readyInput, providerModels: [model('text-embedding-3-large')]}),
    ).toBeNull()
  })
})

describe('buildLocalAssistantDefinition', () => {
  it('grants search-only callables and no signing key; the verbs cover reading', () => {
    const definition = buildLocalAssistantDefinition('p', 'm')
    expect(definition.tools).toEqual(['search'])
    expect(definition.signingKey).toBeUndefined()
    expect(definition.signingKeys).toBeUndefined()
  })
})
