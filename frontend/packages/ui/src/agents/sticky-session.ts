/**
 * The session left open on an agent's Sessions tab.
 *
 * Opening a session is a place the user was, not just a page: switching to Tools and back should
 * land on that transcript again, the way a browser tab remembers its scroll. So the session page
 * records itself here, the Sessions tab (when another tab is active) routes to the recorded session
 * instead of the list, and showing the list — the back button, or clicking Sessions while it is
 * already active — forgets it. Kept in localStorage so it survives reloads and, on desktop, window
 * relaunches; reads and writes are guarded because storage can be missing (SSR) or refused
 * (private mode, quota).
 */

function storageKey(serverUrl: string, agentId: string): string {
  return `agents.openSession:${serverUrl}:${agentId}`
}

/** The session id the agent's Sessions tab should reopen, or null when the list is the destination. */
export function readStickyAgentSession(serverUrl: string, agentId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(serverUrl, agentId))
  } catch {
    return null
  }
}

/** Records `sessionId` as the agent's open session; null forgets it. */
export function writeStickyAgentSession(serverUrl: string, agentId: string, sessionId: string | null): void {
  try {
    const key = storageKey(serverUrl, agentId)
    if (sessionId === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, sessionId)
  } catch {
    // No storage this page load: the tab simply falls back to the sessions list.
  }
}
