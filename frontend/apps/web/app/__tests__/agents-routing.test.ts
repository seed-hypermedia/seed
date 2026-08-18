import {routeToHref} from '@shm/shared'
import {agentRouteSchema, type NavRoute} from '@shm/shared/routes'
import {describe, expect, it} from 'vitest'
import {agentsRouteFromUrl} from '../agents-routing'

/**
 * The web agents URLs are written by `routeToHref` and read back by `agentsRouteFromUrl`. Those two
 * live in different packages, so nothing but these round trips keeps them agreeing — a link that
 * serializes a field the parser drops silently loses it on reload.
 */
function roundTrip(route: NavRoute): NavRoute {
  const href = routeToHref(route)
  if (typeof href !== 'string') throw new Error(`routeToHref produced no href for ${route.key}`)
  const [pathname, search] = href.split('?')
  return agentsRouteFromUrl(pathname!, new URLSearchParams(search ?? ''))
}

describe('web agents routing', () => {
  it('round-trips the agents list', () => {
    expect(roundTrip({key: 'agents'})).toEqual({key: 'agents'})
  })

  it('round-trips a server, preserving a URL with its own query string', () => {
    const route: NavRoute = {key: 'agent-server', serverUrl: 'https://agents.example.com:8443/base?x=1'}
    expect(roundTrip(route)).toEqual(route)
  })

  it('round-trips an agent with every optional field, including the memory file', () => {
    const route: NavRoute = {
      key: 'agent',
      agentId: 'agent-1',
      serverUrl: 'https://agents.example.com',
      tab: 'memory',
      triggerId: 'trigger-1',
      memoryPath: '~/memory/notes/plan.md',
    }
    expect(roundTrip(route)).toEqual(route)
  })

  it('round-trips a session', () => {
    const route: NavRoute = {
      key: 'agent-session',
      sessionId: 'session 2',
      serverUrl: 'https://agents.example.com',
      agentId: 'agent-1',
    }
    expect(roundTrip(route)).toEqual(route)
  })

  it('round-trips every tab the agent route schema allows', () => {
    for (const tab of agentRouteSchema.shape.tab.unwrap().options) {
      const route: NavRoute = {key: 'agent', agentId: 'agent-1', tab}
      expect(roundTrip(route)).toMatchObject({key: 'agent', agentId: 'agent-1', tab})
    }
  })

  it('drops an unknown tab rather than producing an invalid route', () => {
    const parsed = agentsRouteFromUrl('/hm/agents/agent/agent-1', new URLSearchParams('tab=nonsense'))
    expect(parsed).toMatchObject({key: 'agent', agentId: 'agent-1', tab: undefined})
  })

  it('falls back to the list for unrecognized agents paths', () => {
    expect(agentsRouteFromUrl('/hm/agents/nope', new URLSearchParams())).toEqual({key: 'agents'})
    expect(agentsRouteFromUrl('/hm/agents/server', new URLSearchParams())).toEqual({key: 'agents'})
  })
})
