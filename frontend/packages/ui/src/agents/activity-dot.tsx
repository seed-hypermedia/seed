/** Which kind of agent activity a summary describes. */
export type AgentActivityTone = 'agent' | 'user' | 'busy'

/**
 * What the agents entry point should show about recent activity, or null for nothing. Computed
 * by `summarizeAgentActivity` in ./activity; kept here, import-light, so the site header can
 * receive the activity without pulling the agents models into the initial bundle.
 */
export type AgentActivityIndicator = {
  tone: AgentActivityTone
  /** True for an unread message (agent or user tone); false while merely busy. */
  unread: boolean
  serverUrl: string
  agentId: string
  agentName: string
  sessionId: string
  /** One sentence for tooltips and screen readers, e.g. "Researcher replied". */
  label: string
}
