import type {AgentInfo} from './client'
import type {AssistantSessionRef} from './assistant-session-ref'
import type {AgentSessionListEntry} from './models'

/**
 * Selection model for the assistant sidebar.
 *
 * The sidebar is agent-scoped: a dropdown at the top picks which agent context the user is in, and
 * everything below — the session dropdown, the transcript, new chats — belongs to that agent. This
 * module decides, from raw inputs, which agent and which session are active; it is deliberately
 * free of React and fetching so the precedence rules are directly testable.
 */

/** Identity of an agent across servers: ids are only unique per server. */
export type AssistantAgentKey = {serverUrl: string; agentId: string}

/** One selectable agent in the context dropdown. */
export type AssistantAgentOption = {serverUrl: string; agent: AgentInfo}

export type AssistantSelectionInput = {
  /** Every agent on every configured server, in server order (the local server first). */
  agents: AssistantAgentOption[]
  /** Every session across servers, newest first. */
  sessions: AgentSessionListEntry[]
  /** Agent context the user explicitly chose in the dropdown, if any. */
  chosenAgent: AssistantAgentKey | null
  /** Session restored from window state or picked in the session dropdown. */
  storedSession: AssistantSessionRef | null
  /** The stored session's agent as reported by its own fetch, for before the lists include it. */
  storedSessionAgentId?: string
  /** True when the user asked for a new chat: no session is active until the first send. */
  isDraft: boolean
}

export type AssistantSelection = {
  /** Active agent context, or null when no agents exist anywhere. */
  agent: AssistantAgentOption | null
  /** Sessions belonging to the active agent, newest first. */
  agentSessions: AgentSessionListEntry[]
  /** Active session, or null for a draft (composer ready, session created on first send). */
  session: AssistantSessionRef | null
}

function findAgent(agents: AssistantAgentOption[], key: {serverUrl: string; agentId: string}) {
  return agents.find((option) => option.serverUrl === key.serverUrl && option.agent.id === key.agentId) ?? null
}

/**
 * Resolves the active agent and session.
 *
 * Precedence for the agent: the user's explicit dropdown choice, then the agent owning the stored
 * session, then the first known agent (server order puts the local server first, so a fresh
 * install lands on the built-in Assistant). Precedence for the session: none while drafting, the
 * stored session when it belongs to the active agent, otherwise the agent's newest — so switching
 * agent contexts always lands somewhere sensible instead of showing another agent's transcript.
 */
export function resolveAssistantSelection(input: AssistantSelectionInput): AssistantSelection {
  const storedEntry = input.storedSession
    ? input.sessions.find(
        (entry) =>
          entry.serverUrl === input.storedSession!.serverUrl && entry.session.id === input.storedSession!.sessionId,
      ) ?? null
    : null
  const storedAgentId = storedEntry?.session.agentId ?? input.storedSessionAgentId

  const agent =
    (input.chosenAgent ? findAgent(input.agents, input.chosenAgent) : null) ??
    (input.storedSession && storedAgentId
      ? findAgent(input.agents, {serverUrl: input.storedSession.serverUrl, agentId: storedAgentId})
      : null) ??
    input.agents[0] ??
    null

  const agentSessions = agent
    ? input.sessions.filter((entry) => entry.serverUrl === agent.serverUrl && entry.session.agentId === agent.agent.id)
    : []

  if (input.isDraft || !agent) return {agent, agentSessions, session: null}

  const storedBelongsToAgent =
    !!input.storedSession && input.storedSession.serverUrl === agent.serverUrl && storedAgentId === agent.agent.id
  // A stored session whose agent is still unknown (lists and its own fetch both pending) is kept:
  // tearing it down on every launch just to re-select it a moment later would flash the UI.
  const storedUndetermined = !!input.storedSession && !storedAgentId && !input.chosenAgent

  if (input.storedSession && (storedBelongsToAgent || storedUndetermined)) {
    return {agent, agentSessions, session: input.storedSession}
  }

  const newest = agentSessions[0]
  return {
    agent,
    agentSessions,
    session: newest ? {serverUrl: newest.serverUrl, sessionId: newest.session.id} : null,
  }
}
