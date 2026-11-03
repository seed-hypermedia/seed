import type {NavRoute} from '@shm/shared/routes'
import {routeToHref} from '@shm/shared/routing'
import {agentsRouteFromUrl} from '@shm/shared/utils/agents-routing'

/** One tab of the agent page, or one of the pages under Settings (`prompt`, `permissions`,
 * `identities`, `mcp`). `tools` is the old name of the permissions page. */
export type SeedAgentTab =
  | 'sessions'
  | 'triggers'
  | 'memory'
  | 'tools'
  | 'prompt'
  | 'permissions'
  | 'identities'
  | 'mcp'
  | 'collaborators'
  | 'settings'

/** A place in the agents UI. Mirrors Seed's agent NavRoutes, so links are interchangeable with the apps. */
export type SeedAgentsRoute =
  /** One agent, on one of its tabs. */
  | {
      key: 'agent'
      agentId: string
      serverUrl?: string
      tab?: SeedAgentTab
      triggerId?: string
      /** Memory tab: the file to open. */
      memoryPath?: string
    }
  /** One session (a conversation). */
  | {key: 'agent-session'; sessionId: string; serverUrl?: string; agentId?: string}
  /** One durable run (a script or delegated model run). */
  | {key: 'agent-run'; runId: string; serverUrl?: string; agentId?: string}

type AgentNavRoute = Extract<NavRoute, {key: SeedAgentsRoute['key']}>
// Fails to compile if Seed's agent routes and this public mirror drift apart, in either direction.
const _routesMatch: [SeedAgentsRoute, AgentNavRoute] = [{} as AgentNavRoute, {} as SeedAgentsRoute]
void _routesMatch

const ROUTE_KEYS = new Set<string>(['agent', 'agent-session', 'agent-run'])

/** True when a Seed NavRoute is one the agents UI renders itself. */
export function isSeedAgentsRoute(route: {key: string}): route is SeedAgentsRoute {
  return ROUTE_KEYS.has(route.key)
}

const PREFIX = '/hm/agents'

/**
 * The route as a relative path with query, e.g. `session/<id>?agent=<id>`. It is the part after
 * `/hm/agents/` in Seed's web URLs, so a host can mount it anywhere.
 */
export function seedAgentsRouteToPath(route: SeedAgentsRoute): string {
  const href = routeToHref(route as NavRoute) ?? PREFIX
  return href.startsWith(PREFIX) ? href.slice(PREFIX.length).replace(/^\//, '') : ''
}

/** Parses a path produced by {@link seedAgentsRouteToPath}; null for a path that names no place. */
export function seedAgentsRouteFromPath(path: string): SeedAgentsRoute | null {
  const [pathname = '', search = ''] = path.replace(/^\/+/, '').split('?', 2)
  const route = agentsRouteFromUrl(`${PREFIX}/${pathname}`, new URLSearchParams(search))
  return route && isSeedAgentsRoute(route) ? route : null
}

/** Seed's public web URL for a route, e.g. to open it in the Seed web app. */
export function seedAgentsRouteToWebUrl(route: SeedAgentsRoute, gatewayUrl = 'https://hyper.media'): string {
  const path = seedAgentsRouteToPath(route)
  return `${gatewayUrl.replace(/\/+$/, '')}${PREFIX}${path ? `/${path}` : ''}`
}
