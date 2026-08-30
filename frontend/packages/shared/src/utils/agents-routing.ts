import {agentRouteSchema, type NavRoute} from '../routes'

// Derived from the route schema so a tab added there (e.g. 'collaborators') is parseable here
// without anyone remembering this file exists.
const AGENT_TABS = agentRouteSchema.shape.tab.unwrap().options

/**
 * Parses a /hm/agents URL into its NavRoute. Mirrors the agent-route cases of `routeToHref` in
 * `routing.tsx`; the web agents page reads its location through this, and `hypermediaUrlToRoute`
 * uses it so a copied agents link opens in-app on the desktop too:
 *
 * - `/hm/agents` → agents
 * - `/hm/agents/server?url=…` → agent-server
 * - `/hm/agents/agent/:agentId?server=…&tab=…&trigger=…&file=…` → agent
 * - `/hm/agents/session/:sessionId?server=…&agent=…` → agent-session
 * - `/hm/agents/run/:runId?server=…&agent=…` → agent-run
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
  if (rest[0] === 'run' && rest[1]) {
    return {
      key: 'agent-run',
      runId: rest[1],
      serverUrl: searchParams.get('server') || undefined,
      agentId: searchParams.get('agent') || undefined,
    }
  }
  return {key: 'agents'}
}

/** True for an absolute http(s) URL whose path is the web agents UI. */
export function isAgentsWebUrl(url: string): boolean {
  return /^https?:\/\/[^/?#]+\/hm\/agents(?:[/?#]|$)/.test(url)
}

/** The route an absolute `https://<host>/hm/agents/…` URL points at, or null when it is not one. */
export function agentsRouteFromAbsoluteUrl(url: string): NavRoute | null {
  if (!isAgentsWebUrl(url)) return null
  try {
    const parsed = new URL(url)
    return agentsRouteFromUrl(parsed.pathname, parsed.searchParams)
  } catch {
    return null
  }
}
