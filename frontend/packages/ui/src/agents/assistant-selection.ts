import type {AgentInfo} from './client'
import type {AssistantSessionRef} from './assistant-session-ref'
import type {AgentSessionListEntry} from './models'

/**
 * Selection model for the assistant sidebar.
 *
 * The sidebar mirrors the Agents page: the dropdown at the top filters the chat list to one agent
 * or to all of them, the list shows those chats with a composer below it, and opening a chat
 * replaces the list until the back button returns to it. This module decides, from raw inputs,
 * which filter and which open chat are in effect; it is deliberately free of React and fetching so
 * the rules are directly testable.
 */

/** Identity of an agent across servers: ids are only unique per server. */
export type AssistantAgentKey = {serverUrl: string; agentId: string}

/** One selectable agent in the dropdown. */
export type AssistantAgentOption = {serverUrl: string; agent: AgentInfo}

export type AssistantSelectionInput = {
  /** Every agent on every configured server, in dropdown order (see {@link orderAssistantAgents}). */
  agents: AssistantAgentOption[]
  /** Every chat across servers, newest first. */
  sessions: AgentSessionListEntry[]
  /** Agent the list is filtered to; null lists every agent's chats. */
  chosenAgent: AssistantAgentKey | null
  /** Chat restored from window state or opened from the list. */
  storedSession: AssistantSessionRef | null
  /** The stored chat's agent as reported by its own fetch, for before the lists include it. */
  storedSessionAgentId?: string
  /**
   * True once the stored chat's own fetch was answered with a refusal (deleted, or no longer
   * readable): the chat is closed. A fetch that never reached the server leaves this false and the
   * chat open, since the server may just be down.
   */
  storedSessionUnavailable?: boolean
  /**
   * False while any agent list is still loading. A remembered agent choice that has not shown up
   * yet is then pending rather than gone. Defaults to true.
   */
  agentsSettled?: boolean
}

export type AssistantSelection = {
  /** Agent the list is filtered to, or null for all agents. */
  filterAgent: AssistantAgentOption | null
  /** True while a remembered agent choice has not appeared in lists that are still loading. */
  filterPending: boolean
  /** Open chat, or null while the list is showing. */
  session: AssistantSessionRef | null
  /** The open chat's agent, once a list or the chat's own fetch names it. */
  sessionAgent: AssistantAgentOption | null
}

/**
 * Orders the agents in the dropdown (and the composer's agent picker under "All agents").
 *
 * The space in view leads, so a reader on a space finds the agents that space put first at the
 * top, and the composer falls back to them. The user's own agents follow in server order, with
 * the app's local server first. An agent reachable both ways appears once, in the leading position.
 */
export function orderAssistantAgents(
  spaceAgents: AssistantAgentOption[],
  ownAgents: AssistantAgentOption[],
): AssistantAgentOption[] {
  const options: AssistantAgentOption[] = []
  const seen = new Set<string>()
  for (const option of [...spaceAgents, ...ownAgents]) {
    const key = `${option.serverUrl}:${option.agent.id}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push(option)
  }
  return options
}

function findAgent(agents: AssistantAgentOption[], key: {serverUrl: string; agentId: string}) {
  return agents.find((option) => option.serverUrl === key.serverUrl && option.agent.id === key.agentId) ?? null
}

/**
 * Resolves the filter and the open chat.
 *
 * The filter is the agent the user chose, or all agents when they chose none (or chose one that
 * no longer exists once the lists have settled). The open chat is the stored one until its server
 * refuses it: a chat is never opened from the list on the user's behalf, and never closed just
 * because lists are still loading or the filter points elsewhere — the list is one back-press away.
 */
export function resolveAssistantSelection(input: AssistantSelectionInput): AssistantSelection {
  const agentsSettled = input.agentsSettled ?? true
  const filterAgent = input.chosenAgent ? findAgent(input.agents, input.chosenAgent) : null
  const filterPending = !!input.chosenAgent && !filterAgent && !agentsSettled
  const stored = input.storedSession
  if (!stored || input.storedSessionUnavailable) return {filterAgent, filterPending, session: null, sessionAgent: null}
  const entry = input.sessions.find(
    (candidate) => candidate.serverUrl === stored.serverUrl && candidate.session.id === stored.sessionId,
  )
  const agentId = entry?.session.agentId ?? input.storedSessionAgentId
  const sessionAgent = agentId ? findAgent(input.agents, {serverUrl: stored.serverUrl, agentId}) : null
  return {filterAgent, filterPending, session: stored, sessionAgent}
}
