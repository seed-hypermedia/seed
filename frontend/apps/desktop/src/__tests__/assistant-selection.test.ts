import {describe, expect, it} from 'vitest'
import type {AgentInfo} from '@shm/ui/agents/client'
import type {AgentSessionListEntry} from '@shm/ui/agents/models'
import {
  orderAssistantAgents,
  resolveAssistantSelection,
  type AssistantAgentOption,
} from '@shm/ui/agents/assistant-selection'

/**
 * Selection rules for the assistant sidebar, which mirrors the Agents page: a filter (one agent or
 * all of them) over the chat list, and an open chat that replaces the list until the user goes back.
 *
 * The regressions these guard: tearing down a restored chat before its metadata loads (a flash on
 * every launch, and the wrong chat written back as remembered), treating a remembered agent that is
 * still loading as "all agents", and keeping a chat the server has refused.
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

const base = {agents, sessions, chosenAgent: null, storedSession: null}

describe('resolveAssistantSelection', () => {
  it('lists every agent by default, with no chat open', () => {
    // Nothing remembered means the list, never whichever chat happens to be newest — for a public
    // agent that is somebody else's conversation.
    const result = resolveAssistantSelection(base)
    expect(result.filterAgent).toBeNull()
    expect(result.filterPending).toBe(false)
    expect(result.session).toBeNull()
    expect(result.sessionAgent).toBeNull()
  })

  it('filters to the chosen agent', () => {
    const result = resolveAssistantSelection({...base, chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'}})
    expect(result.filterAgent?.agent.id).toBe('researcher')
    expect(result.session).toBeNull()
  })

  it('restores the stored chat and names its agent', () => {
    const result = resolveAssistantSelection({...base, storedSession: {serverUrl: REMOTE, sessionId: 's-r1'}})
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
    expect(result.sessionAgent?.agent.id).toBe('researcher')
    expect(result.filterAgent).toBeNull()
  })

  it('keeps a chat open whatever the filter, since back returns to the filtered list', () => {
    const result = resolveAssistantSelection({
      ...base,
      chosenAgent: {serverUrl: LOCAL, agentId: 'assistant'},
      storedSession: {serverUrl: REMOTE, sessionId: 's-r1'},
    })
    expect(result.filterAgent?.agent.id).toBe('assistant')
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
    expect(result.sessionAgent?.agent.id).toBe('researcher')
  })

  it('keeps a restored chat whose agent is not yet known instead of closing it', () => {
    const result = resolveAssistantSelection({
      ...base,
      sessions: [],
      storedSession: {serverUrl: LOCAL, sessionId: 's-unlisted'},
    })
    expect(result.session).toEqual({serverUrl: LOCAL, sessionId: 's-unlisted'})
    expect(result.sessionAgent).toBeNull()
  })

  it("names an unlisted chat's agent through its own fetch", () => {
    const result = resolveAssistantSelection({
      ...base,
      storedSession: {serverUrl: REMOTE, sessionId: 's-r-new'},
      storedSessionAgentId: 'researcher',
    })
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r-new'})
    expect(result.sessionAgent?.agent.id).toBe('researcher')
  })

  it('keeps a restored chat while the agent lists are still loading, even before any agent is known', () => {
    // Launch: the remote server, which owns the stored chat, has not answered yet.
    const result = resolveAssistantSelection({
      ...base,
      agents: [],
      storedSession: {serverUrl: REMOTE, sessionId: 's-r1'},
      agentsSettled: false,
    })
    expect(result.session).toEqual({serverUrl: REMOTE, sessionId: 's-r1'})
  })

  it('closes a chat the server refused', () => {
    // Deleted from another window: its fetch answered with a refusal.
    const result = resolveAssistantSelection({
      ...base,
      storedSession: {serverUrl: LOCAL, sessionId: 's-gone'},
      storedSessionUnavailable: true,
    })
    expect(result.session).toBeNull()
    expect(result.sessionAgent).toBeNull()
  })

  it('treats a remembered agent that has not loaded yet as pending, not as all agents', () => {
    const result = resolveAssistantSelection({
      ...base,
      agents: [agent(LOCAL, 'assistant', 'Assistant')],
      chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'},
      agentsSettled: false,
    })
    expect(result.filterAgent).toBeNull()
    expect(result.filterPending).toBe(true)
  })

  it('falls back to all agents once the lists settle without the remembered agent', () => {
    const result = resolveAssistantSelection({
      ...base,
      agents: [agent(LOCAL, 'assistant', 'Assistant')],
      chosenAgent: {serverUrl: REMOTE, agentId: 'researcher'},
      agentsSettled: true,
    })
    expect(result.filterAgent).toBeNull()
    expect(result.filterPending).toBe(false)
  })

  it('a remembered agent with no chats yet is still the filter', () => {
    const result = resolveAssistantSelection({
      ...base,
      agents: [...agents, agent(REMOTE, 'fresh', 'Fresh')],
      chosenAgent: {serverUrl: REMOTE, agentId: 'fresh'},
    })
    expect(result.filterAgent?.agent.id).toBe('fresh')
    expect(result.session).toBeNull()
  })
})

/**
 * A space publishes agents for its readers. The dropdown (and the composer's agent picker under
 * "All agents") lists them first, so someone who just arrived finds something to talk to at once.
 */
describe('orderAssistantAgents', () => {
  const SPACE = 'https://agents.space.example'
  const docsBot = agent(SPACE, 'docs', 'Docs Helper')
  const supportBot = agent(SPACE, 'support', 'Support')

  it("puts the space's agents ahead of the user's own", () => {
    const ordered = orderAssistantAgents([docsBot, supportBot], agents)
    expect(ordered.map((option) => option.agent.id)).toEqual(['docs', 'support', 'assistant', 'researcher'])
  })

  it('leaves the local server leading when no space publishes anything', () => {
    expect(orderAssistantAgents([], agents)).toEqual(agents)
  })

  it('lists an agent that is both published and owned once, in the leading position', () => {
    const ordered = orderAssistantAgents([agent(REMOTE, 'researcher', 'Researcher')], agents)
    expect(ordered.map((option) => option.agent.id)).toEqual(['researcher', 'assistant'])
  })

  it("keeps an explicitly chosen agent as the filter, whatever the space's order", () => {
    const ordered = orderAssistantAgents([docsBot], agents)
    const result = resolveAssistantSelection({
      ...base,
      agents: ordered,
      chosenAgent: {serverUrl: LOCAL, agentId: 'assistant'},
    })
    expect(result.filterAgent?.agent.id).toBe('assistant')
  })
})
