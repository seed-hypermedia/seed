import {describe, expect, it} from 'vitest'
import type {AgentInfo} from '@shm/ui/agents/client'
import type {AgentSessionListEntry} from '@shm/ui/agents/models'
import {
  orderAssistantAgents,
  resolveAssistantSelection,
  type AssistantAgentOption,
} from '@shm/ui/agents/assistant-selection'

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
  it('defaults to the first agent (local server first) as a draft, with its sessions listed', () => {
    // Nothing remembered means a new chat, never whichever chat happens to be newest — for a
    // public agent that is somebody else's conversation.
    const result = resolveAssistantSelection(base)
    expect(result.agent?.agent.id).toBe('assistant')
    expect(result.session).toBeNull()
    expect(result.agentSessions.map((entry) => entry.session.id)).toEqual(['s-a2', 's-a1'])
  })

  it('restores the stored session and enters its agent context', () => {
    const result = resolveAssistantSelection({...base, storedSession: {serverUrl: REMOTE, sessionId: 's-r1'}})
    expect(result.agent?.agent.id).toBe('researcher')
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
  })

  it('lets an explicit agent choice override the stored session, landing on a draft with that agent', () => {
    const result = resolveAssistantSelection({
      ...base,
      storedSession: {serverUrl: LOCAL, sessionId: 's-a1'},
      chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'},
    })
    expect(result.agent?.agent.id).toBe('researcher')
    // Keeping s-a1 here would show one agent's transcript under another agent's header.
    expect(result.session).toBeNull()
    expect(result.agentSessions.map((entry) => entry.session.id)).toEqual(['s-r2', 's-r1'])
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

  it('holds a stored session whose agent has not been listed yet while the lists are still loading', () => {
    // Launch: the local server answered first; the remote one (owning the stored session) has not.
    // Settling on the local agent's newest here would be written back as the remembered selection.
    const result = resolveAssistantSelection({
      ...base,
      agents: [agent(LOCAL, 'assistant', 'Assistant')],
      storedSession: {serverUrl: REMOTE, sessionId: 's-r1'},
      storedSessionAgentId: 'researcher',
      agentsSettled: false,
    })
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
  })

  it('holds a stored session even before any agent is known, so the transcript shows at once', () => {
    const result = resolveAssistantSelection({
      ...base,
      agents: [],
      storedSession: {serverUrl: REMOTE, sessionId: 's-r1'},
      agentsSettled: false,
    })
    expect(result.agent).toBeNull()
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
  })

  it('moves on from a stored session once the lists have settled without its agent', () => {
    const result = resolveAssistantSelection({
      ...base,
      agents: [agent(LOCAL, 'assistant', 'Assistant')],
      storedSession: {serverUrl: REMOTE, sessionId: 's-r1'},
      storedSessionAgentId: 'researcher',
      agentsSettled: true,
    })
    expect(result.agent?.agent.id).toBe('assistant')
    expect(result.session).toBeNull()
  })

  it('gives up a stored session the server refused, instead of holding it until its agent turns up', () => {
    // Deleted from another window: the lists will never name it and its fetch answered 404.
    const result = resolveAssistantSelection({
      ...base,
      sessions,
      storedSession: {serverUrl: LOCAL, sessionId: 's-gone'},
      storedSessionUnavailable: true,
    })
    expect(result.session).toBeNull()
  })

  it('holds the stored session while a remembered agent choice is still loading, then honors the choice', () => {
    const loading = resolveAssistantSelection({
      ...base,
      agents: [agent(LOCAL, 'assistant', 'Assistant')],
      storedSession: {serverUrl: LOCAL, sessionId: 's-a1'},
      chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'},
      agentsSettled: false,
    })
    expect(loading.session).toEqual({serverUrl: LOCAL, sessionId: 's-a1'})

    const settled = resolveAssistantSelection({
      ...base,
      storedSession: {serverUrl: LOCAL, sessionId: 's-a1'},
      chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'},
      agentsSettled: true,
    })
    expect(settled.agent?.agent.id).toBe('researcher')
    expect(settled.session).toBeNull()
  })

  it('a remembered agent with no chats yet opens as an empty context, not another agent', () => {
    const result = resolveAssistantSelection({
      ...base,
      agents: [...agents, agent(REMOTE, 'fresh', 'Fresh')],
      chosenAgent: {serverUrl: REMOTE, agentId: 'fresh'},
    })
    expect(result.agent?.agent.id).toBe('fresh')
    expect(result.session).toBeNull()
  })

  it('after deleting the active session, opens a draft in the same context — not the deleted one', () => {
    // Delete flow: the session is removed from the cached lists and the stored selection cleared.
    const remaining = sessions.filter((entry) => entry.session.id !== 's-a2')
    const result = resolveAssistantSelection({...base, sessions: remaining, storedSession: null})
    expect(result.agent?.agent.id).toBe('assistant')
    expect(result.session).toBeNull()
    expect(result.agentSessions.map((entry) => entry.session.id)).toEqual(['s-a1'])
  })
})

/**
 * A space publishes agents for its readers. Since the default context is the first option, that
 * ordering is what lets someone who just arrived open the panel and find something to talk to.
 */
describe('orderAssistantAgents', () => {
  const SPACE = 'https://agents.space.example'
  const docsBot = agent(SPACE, 'docs', 'Docs Helper')
  const supportBot = agent(SPACE, 'support', 'Support')

  it("puts the space's agents ahead of the user's own, so the default lands on the space", () => {
    const ordered = orderAssistantAgents([docsBot, supportBot], agents)
    expect(ordered.map((option) => option.agent.id)).toEqual(['docs', 'support', 'assistant', 'researcher'])
    expect(resolveAssistantSelection({...base, agents: ordered}).agent?.agent.id).toBe('docs')
  })

  it('leaves the local server leading when no space publishes anything', () => {
    expect(orderAssistantAgents([], agents)).toEqual(agents)
  })

  it('lists an agent that is both published and owned once, in the leading position', () => {
    const ordered = orderAssistantAgents([agent(REMOTE, 'researcher', 'Researcher')], agents)
    expect(ordered.map((option) => option.agent.id)).toEqual(['researcher', 'assistant'])
  })

  it("keeps an explicitly chosen agent over the space's default", () => {
    const ordered = orderAssistantAgents([docsBot], agents)
    const result = resolveAssistantSelection({
      ...base,
      agents: ordered,
      chosenAgent: {serverUrl: LOCAL, agentId: 'assistant'},
    })
    expect(result.agent?.agent.id).toBe('assistant')
  })
})
