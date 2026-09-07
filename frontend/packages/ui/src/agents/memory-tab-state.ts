/**
 * Where the user was in an agent's memory browser: the open file, the expanded folders, and how
 * far the tree and the file were scrolled.
 *
 * The Memory tab unmounts whenever another tab is shown, so without this every switch away and
 * back landed on a collapsed tree with nothing open. The tab restores this on mount (a file named
 * in the route still wins, see {@link AgentMemoryTab}) and records it as the user moves. Kept in
 * localStorage, like the open session (sticky-session.ts), so it also survives a reload; reads and
 * writes are guarded because storage can be missing (SSR) or refused (private mode, quota).
 */

export type AgentMemoryTabState = {
  selectedPath: string | null
  expandedDirs: string[]
  treeScrollTop: number
  fileScrollTop: number
}

function storageKey(serverUrl: string, agentId: string): string {
  return `agents.memoryTab:${serverUrl}:${agentId}`
}

/** The remembered browser state for this agent, or null when there is none (or it is unreadable). */
export function readAgentMemoryTabState(serverUrl: string, agentId: string): AgentMemoryTabState | null {
  try {
    const raw = window.localStorage.getItem(storageKey(serverUrl, agentId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Record<string, unknown>
    return {
      selectedPath: typeof value.selectedPath === 'string' ? value.selectedPath : null,
      expandedDirs: Array.isArray(value.expandedDirs)
        ? value.expandedDirs.filter((dir): dir is string => typeof dir === 'string')
        : [],
      treeScrollTop: typeof value.treeScrollTop === 'number' ? value.treeScrollTop : 0,
      fileScrollTop: typeof value.fileScrollTop === 'number' ? value.fileScrollTop : 0,
    }
  } catch {
    return null
  }
}

/** Records the browser state for this agent. */
export function writeAgentMemoryTabState(serverUrl: string, agentId: string, state: AgentMemoryTabState): void {
  try {
    window.localStorage.setItem(storageKey(serverUrl, agentId), JSON.stringify(state))
  } catch {
    // No storage this page load: the tab simply starts fresh next time.
  }
}
