// @vitest-environment jsdom
/**
 * Regression: creating a chat from the sidebar draft must land in the NEW session.
 *
 * `CreateSession` returns only an id. Before the optimistic cache seed existed, the selection
 * resolver could not attribute the just-created session to its agent (the session lists were
 * still stale and the session's own fetch had not landed), so with an explicitly chosen agent it
 * fell back to that agent's newest OLD session — and the panel's sync-back effect then persisted
 * the wrong selection. These tests drive the same inputs the panel derives from the caches.
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

import type {SessionInfo} from '@/agents-client'
import {addOptimisticSessionMessage, addOptimisticSessionToCaches, type AgentSessionListEntry} from '@/models/agents'
import {resolveAssistantSelection, type AssistantAgentOption} from '@/models/assistant-selection'
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
    isDraft: false,
  })
}

describe('sidebar new-chat selection after CreateSession', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  it('without the seed, a stale list resolves to the old session (the bug this guards)', () => {
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: session('s-old', 100)}])
    expect(resolveFromCaches('s-new').session).toEqual({serverUrl: SERVER, sessionId: 's-old'})
  })

  it('the seed makes the resolver keep the just-created session over a stale list', () => {
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: session('s-old', 100)}])
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    expect(resolveFromCaches('s-new').session).toEqual({serverUrl: SERVER, sessionId: 's-new'})
  })

  it('keeps attribution through the detail seed even if a stale list refetch drops the entry', () => {
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    // A ListSessions response that raced the creation lands afterwards, without the new session.
    queryClient.setQueryData(listKey, [{serverUrl: SERVER, session: session('s-old', 100)}])
    expect(resolveFromCaches('s-new').session).toEqual({serverUrl: SERVER, sessionId: 's-new'})
  })

  it('lets the optimistic first message attach to the seeded session', () => {
    addOptimisticSessionToCaches(SERVER, ACCOUNT, session('s-new', 200))
    addOptimisticSessionMessage(SERVER, ACCOUNT, 's-new', [{text: 'hello'}])
    const cached = queryClient.getQueryData(sessionKey('s-new')) as {events: Array<{event: {content: string}}>}
    expect(cached.events).toHaveLength(1)
    expect(cached.events[0]!.event.content).toBe('hello')
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
