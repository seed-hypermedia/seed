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
  /**
   * True once the stored session's own fetch was answered with a refusal (deleted, or no longer
   * readable): there is nothing left to wait for, so the selection moves on. A fetch that never
   * reached the server leaves this false and the session held, since the server may just be down.
   */
  storedSessionUnavailable?: boolean
  /**
   * False while any agent list is still loading. A stored session (or chosen agent) whose agent is
   * not in the lists yet is then held rather than replaced — the lists arrive one server at a time,
   * and settling on whichever agent showed up first would make the remembered selection sticky
   * for the wrong agent. Defaults to true.
   */
  agentsSettled?: boolean
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

/**
 * Orders the agents offered in the context dropdown.
 *
 * The space in view leads, because the default context is the first option (see
 * {@link resolveAssistantSelection}): a reader who opens the panel on a space should land in the
 * agent that space put first, without picking one. The user's own agents follow in server order,
 * with the app's local server first, so a desktop user away from any space still opens on the
 * built-in Assistant. An agent reachable both ways appears once, in the leading position.
 *
 * This only sets the default. An agent the user explicitly chose outranks it.
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
 * Resolves the active agent and session.
 *
 * Precedence for the agent: the user's explicit dropdown choice, then the agent owning the stored
 * session, then the first known agent (server order puts the local server first, so a fresh
 * install lands on the built-in Assistant). The session is the stored one when it belongs to the
 * active agent, and otherwise none — a draft, ready for a new chat. Nothing is ever auto-selected
 * from the list: a public agent's list is everybody's chats, and opening a fresh panel onto some
 * stranger's conversation (or, after switching agents, onto whichever chat happened to be newest)
 * is not where anyone wants to land. Earlier chats are one dropdown away.
 */
export function resolveAssistantSelection(input: AssistantSelectionInput): AssistantSelection {
  const agentsSettled = input.agentsSettled ?? true
  const storedEntry = input.storedSession
    ? input.sessions.find(
        (entry) =>
          entry.serverUrl === input.storedSession!.serverUrl && entry.session.id === input.storedSession!.sessionId,
      ) ?? null
    : null
  const storedAgentId = storedEntry?.session.agentId ?? input.storedSessionAgentId

  const chosen = input.chosenAgent ? findAgent(input.agents, input.chosenAgent) : null
  const storedAgent =
    input.storedSession && storedAgentId
      ? findAgent(input.agents, {serverUrl: input.storedSession.serverUrl, agentId: storedAgentId})
      : null
  const agent = chosen ?? storedAgent ?? input.agents[0] ?? null

  const agentSessions = agent
    ? input.sessions.filter((entry) => entry.serverUrl === agent.serverUrl && entry.session.agentId === agent.agent.id)
    : []

  if (input.isDraft) return {agent, agentSessions, session: null}

  const storedBelongsToAgent = !!agent && !!storedAgent && storedAgent === agent
  // A stored session is kept while its place is still undetermined: its agent is unknown (lists and
  // its own fetch both pending), or the lists are still arriving and have not named its agent —
  // or the agent the user chose — yet. Tearing it down on every launch just to re-select it a
  // moment later would flash the UI, and worse, the replacement would be written back as the
  // remembered selection. A refusal from the server settles it the other way.
  const chosenPending = !!input.chosenAgent && !chosen && !agentsSettled
  const storedUndetermined =
    !!input.storedSession &&
    !input.storedSessionUnavailable &&
    (chosenPending || (!input.chosenAgent && (!storedAgentId || !agentsSettled)))

  if (input.storedSession && (storedBelongsToAgent || storedUndetermined)) {
    return {agent, agentSessions, session: input.storedSession}
  }
  return {agent, agentSessions, session: null}
}
