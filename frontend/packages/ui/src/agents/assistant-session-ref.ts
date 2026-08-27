/**
 * Identity of a session shown in the assistant sidebar.
 *
 * Session ids are only unique per agent server, so the sidebar — which lists sessions from every
 * configured server at once — must carry the server URL alongside the id. The window state that
 * persists the sidebar selection stores a single string, so the pair is serialized rather than
 * widening that IPC contract.
 */
export type AssistantSessionRef = {
  serverUrl: string
  sessionId: string
}

/** Separator chosen because it cannot appear in a normalized http(s) origin or a UUID session id. */
const SEPARATOR = ' | '

/** Serializes a session reference for storage in window state. */
export function encodeAssistantSessionRef(ref: AssistantSessionRef): string {
  return `${ref.serverUrl}${SEPARATOR}${ref.sessionId}`
}

/**
 * Parses a stored sidebar selection.
 *
 * Returns null for anything unparseable, including selections written by an older build that stored
 * a bare session id, so a stale window state degrades to "no session selected" instead of querying a
 * nonsensical server.
 */
export function decodeAssistantSessionRef(value: string | null | undefined): AssistantSessionRef | null {
  if (!value) return null
  const index = value.indexOf(SEPARATOR)
  if (index <= 0) return null
  const serverUrl = value.slice(0, index)
  const sessionId = value.slice(index + SEPARATOR.length)
  if (!serverUrl || !sessionId) return null
  return {serverUrl, sessionId}
}

/**
 * Identity of an agent chosen in the assistant sidebar, serialized the same way as a session ref.
 *
 * The sidebar remembers the agent context the user last picked so a reload (or, on web, a return
 * to the site) reopens in that context even when it holds no session yet — a draft with a freshly
 * created or empty agent would otherwise fall back to whatever agent lists first.
 */
export type AssistantAgentRef = {
  serverUrl: string
  agentId: string
}

/** Serializes an agent reference for storage beside the session ref. */
export function encodeAssistantAgentRef(ref: AssistantAgentRef): string {
  return `${ref.serverUrl}${SEPARATOR}${ref.agentId}`
}

/** Parses a stored agent choice; null for anything unparseable. */
export function decodeAssistantAgentRef(value: string | null | undefined): AssistantAgentRef | null {
  const decoded = decodeAssistantSessionRef(value)
  return decoded ? {serverUrl: decoded.serverUrl, agentId: decoded.sessionId} : null
}
