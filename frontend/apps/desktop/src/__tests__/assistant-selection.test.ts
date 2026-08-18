import {describe, expect, it} from 'vitest'
import type {AgentInfo} from '@shm/ui/agents/client'
import type {AgentSessionListEntry} from '@shm/ui/agents/models'
import {resolveAssistantSelection, type AssistantAgentOption} from '../models/assistant-selection'

/**
 * Selection rules for the agent-scoped assistant sidebar.
 *
 * The regressions these guard: landing in another agent's transcript after switching contexts,
 * tearing down a restored session before its metadata loads (UI flash on every launch), and
 * re-selecting whatever the stale list says after the active session was deleted.
 */

const agent = (serverUrl: string, id: string, name: string): AssistantAgentOption =>
  ({
    serverUrl,
    agent: {id, definition: {name, systemPrompt: '', modelProvider: 'p', model: 'm'}} as AgentInfo,
  }) as AssistantAgentOption

const sessionEntry = (serverUrl: string, id: string, agentId: string, updatedAt: number): AgentSessionListEntry =>
  ({
    serverUrl,
    session: {id, agentId, title: `session ${id}`, status: 'idle', createdAt: 1, updatedAt},
  }) as AgentSessionListEntry

const LOCAL = 'http://localhost:3050'
const REMOTE = 'https://agentic.seed.hyper.media'

const agents = [agent(LOCAL, 'assistant', 'Assistant'), agent(REMOTE, 'researcher', 'Researcher')]
const sessions = [
  sessionEntry(REMOTE, 's-r2', 'researcher', 400),
  sessionEntry(LOCAL, 's-a2', 'assistant', 300),
  sessionEntry(LOCAL, 's-a1', 'assistant', 200),
  sessionEntry(REMOTE, 's-r1', 'researcher', 100),
]

const base = {agents, sessions, chosenAgent: null, storedSession: null, isDraft: false}

describe('resolveAssistantSelection', () => {
  it('defaults to the first agent (local server first) and its newest session', () => {
    const result = resolveAssistantSelection(base)
    expect(result.agent?.agent.id).toBe('assistant')
    expect(result.session).toEqual({serverUrl: LOCAL, sessionId: 's-a2'})
    expect(result.agentSessions.map((entry) => entry.session.id)).toEqual(['s-a2', 's-a1'])
  })

  it('restores the stored session and enters its agent context', () => {
    const result = resolveAssistantSelection({...base, storedSession: {serverUrl: REMOTE, sessionId: 's-r1'}})
    expect(result.agent?.agent.id).toBe('researcher')
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
  })

  it("lets an explicit agent choice override the stored session, landing on that agent's newest", () => {
    const result = resolveAssistantSelection({
      ...base,
      storedSession: {serverUrl: LOCAL, sessionId: 's-a1'},
      chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'},
    })
    expect(result.agent?.agent.id).toBe('researcher')
    // Keeping s-a1 here would show one agent's transcript under another agent's header.
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r2'})
  })

  it('drafting keeps the agent context but no active session', () => {
    const result = resolveAssistantSelection({...base, isDraft: true})
    expect(result.agent?.agent.id).toBe('assistant')
    expect(result.session).toBeNull()
  })

  it('keeps a restored session whose agent is not yet known instead of flashing to another one', () => {
    const result = resolveAssistantSelection({
      ...base,
      sessions: [],
      storedSession: {serverUrl: LOCAL, sessionId: 's-unlisted'},
    })
    expect(result.session).toEqual({serverUrl: LOCAL, sessionId: 's-unlisted'})
  })

  it('attributes an unlisted stored session through its own fetch once available', () => {
    const result = resolveAssistantSelection({
      ...base,
      sessions,
      storedSession: {serverUrl: REMOTE, sessionId: 's-r-new'},
      storedSessionAgentId: 'researcher',
    })
    expect(result.agent?.agent.id).toBe('researcher')
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r-new'})
  })

  it('falls back to the agent context with no session when the agent has no chats', () => {
    const result = resolveAssistantSelection({...base, sessions: []})
    expect(result.agent?.agent.id).toBe('assistant')
    expect(result.session).toBeNull()
  })

  it('resolves to nothing when no agents exist anywhere', () => {
    const result = resolveAssistantSelection({...base, agents: [], sessions: []})
    expect(result.agent).toBeNull()
    expect(result.session).toBeNull()
    expect(result.agentSessions).toEqual([])
  })

  it("after deleting the active session, selects the agent's next newest — not the deleted one", () => {
    // Delete flow: the session is removed from the cached lists and the stored selection cleared.
    const remaining = sessions.filter((entry) => entry.session.id !== 's-a2')
    const result = resolveAssistantSelection({...base, sessions: remaining, storedSession: null})
    expect(result.session).toEqual({serverUrl: LOCAL, sessionId: 's-a1'})
  })
})
