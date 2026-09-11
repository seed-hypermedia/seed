// @vitest-environment jsdom
/**
 * Regression: a chat started from the sidebar's composer must open as the NEW session, with its
 * agent known at once.
 *
 * `CreateSession` returns only an id. The optimistic seed (a list entry and an empty GetSession
 * answer) lets the selection resolver name the new chat's agent before the lists refetch, so the
 * panel's header and the composer's next default follow the right agent. These tests drive the same
 * inputs the panel derives from the caches.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('@/trpc', () => ({
  client: {localAgentsServer: {query: async () => ({url: null})}},
}))
vi.mock('@/grpc-client', () => ({
  grpcClient: {
    daemon: {signData: async () => ({signature: new Uint8Array()})},
    entities: {discoverEntity: async () => ({state: 'noop', version: ''})},
  },
}))

import type {SessionInfo} from '@shm/ui/agents/client'
import {
  addOptimisticSessionMessage,
  addOptimisticSessionToCaches,
  type AgentSessionListEntry,
} from '@shm/ui/agents/models'
import {resolveAssistantSelection, type AssistantAgentOption} from '@shm/ui/agents/assistant-selection'
import {queryClient} from '@shm/shared/models/query-client'

const SERVER = 'http://localhost:3050'
const ACCOUNT = 'test-account'
const AGENT_ID = 'assistant'

const agentOption = {
  serverUrl: SERVER,
  agent: {id: AGENT_ID, definition: {name: 'Assistant', systemPrompt: '', modelProvider: 'p', model: 'm'}},
} as AssistantAgentOption

const session = (id: string, updatedAt: number): SessionInfo => ({
  id,
  account: ACCOUNT,
  agentId: AGENT_ID,
  title: `session ${id}`,
  status: 'idle',
  createdAt: updatedAt,
  updatedAt,
})

const listKey = ['agents', 'sessions', SERVER, ACCOUNT]
const sessionKey = (id: string) => ['agents', 'session', SERVER, ACCOUNT, id]

/** The panel's derivation: list cache entries in, selection out. */
function resolveFromCaches(newSessionId: string) {
  const entries = (queryClient.getQueryData(listKey) as AgentSessionListEntry[] | undefined) ?? []
  const detail = queryClient.getQueryData(sessionKey(newSessionId)) as {session: SessionInfo} | undefined
  return resolveAssistantSelection({
    agents: [agentOption],
    sessions: entries,
    // The user picked this agent in the dropdown before drafting — the case that used to break.
    chosenAgent: {serverUrl: SERVER, agentId: AGENT_ID},
    storedSession: {serverUrl: SERVER, sessionId: newSessionId},
    storedSessionAgentId: detail?.session.agentId,
  })
}

describe('sidebar new-chat selection after CreateSession', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  it('without the seed, the new chat stays open but its agent is unknown until its own fetch lands', () => {
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: session('s-old', 100)}])
    const before = resolveFromCaches('s-new')
    expect(before.session).toEqual({serverUrl: SERVER, sessionId: 's-new'})
    expect(before.sessionAgent).toBeNull()
    queryClient.setQueryData(sessionKey('s-new'), {session: session('s-new', 200)})
    expect(resolveFromCaches('s-new').sessionAgent?.agent.id).toBe(AGENT_ID)
  })

  it("the seed names the just-created chat's agent over a stale list", () => {
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: session('s-old', 100)}])
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    const result = resolveFromCaches('s-new')
    expect(result.session).toEqual({serverUrl: SERVER, sessionId: 's-new'})
    expect(result.sessionAgent?.agent.id).toBe(AGENT_ID)
  })

  it('keeps attribution through the detail seed even if a stale list refetch drops the entry', () => {
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    // A ListSessions response that raced the creation lands afterwards, without the new session.
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: session('s-old', 100)}])
    expect(resolveFromCaches('s-new').sessionAgent?.agent.id).toBe(AGENT_ID)
  })

  it('lets the optimistic first message attach to the seeded session', () => {
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    addOptimisticSessionMessage(SERVER, ACCOUNT, 's-new', [{text: 'hello'}])
    const cached = queryClient.getQueryData(sessionKey('s-new')) as {
      events: {event: {content: string; meta?: {accountId?: string}}}[]
    }
    expect(cached.events).toHaveLength(1)
    expect(cached.events[0]!.event.content).toBe('hello')
    expect(cached.events[0]!.event.meta?.accountId).toBe(ACCOUNT)
  })

  it('does not duplicate a session the list already has, nor clobber a real GetSession cache', () => {
    const real = session('s-new', 300)
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: real}])
    queryClient.setQueryData(sessionKey('s-new'), {
      _: 'GetSessionResponse',
      session: real,
      events: [{id: 'e1'}],
      systemPromptMarkdown: 'real',
    })
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    expect(queryClient.getQueryData(listKey)).toHaveLength(1)
    const cached = queryClient.getQueryData(sessionKey('s-new')) as {events: unknown[]; systemPromptMarkdown: string}
    expect(cached.events).toHaveLength(1)
    expect(cached.systemPromptMarkdown).toBe('real')
  })
})
