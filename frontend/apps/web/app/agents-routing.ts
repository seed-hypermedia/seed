import type {AgentRoute, NavRoute} from '@shm/shared/routes'

const AGENT_TABS: NonNullable<AgentRoute['tab']>[] = ['sessions', 'triggers', 'memory', 'tools', 'prompt', 'settings']

/**
 * Parses a /hm/agents URL into its NavRoute. Mirrors the agent-route cases of `routeToHref` in
 * @shm/shared routing:
 *
 * - `/hm/agents` → agents
 * - `/hm/agents/server?url=…` → agent-server
 * - `/hm/agents/agent/:agentId?server=…&tab=…&trigger=…&file=…` → agent
 * - `/hm/agents/session/:sessionId?server=…&agent=…` → agent-session
 */
export function agentsRouteFromUrl(pathname: string, searchParams: URLSearchParams): NavRoute {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const rest = segments[0] === 'hm' && segments[1] === 'agents' ? segments.slice(2) : []
  if (rest[0] === 'server') {
    const serverUrl = searchParams.get('url')
    if (serverUrl) return {key: 'agent-server', serverUrl}
  }
  if (rest[0] === 'agent' && rest[1]) {
    const tabParam = searchParams.get('tab')
    const tab = AGENT_TABS.find((candidate) => candidate === tabParam)
    return {
      key: 'agent',
      agentId: rest[1],
      serverUrl: searchParams.get('server') || undefined,
      tab,
      triggerId: searchParams.get('trigger') || undefined,
      memoryPath: searchParams.get('file') || undefined,
    }
  }
  if (rest[0] === 'session' && rest[1]) {
    return {
      key: 'agent-session',
      sessionId: rest[1],
      serverUrl: searchParams.get('server') || undefined,
      agentId: searchParams.get('agent') || undefined,
    }
  }
  return {key: 'agents'}
}
