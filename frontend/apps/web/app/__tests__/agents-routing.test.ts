import {routeToHref} from '@shm/shared'
import {agentRouteSchema, type NavRoute} from '@shm/shared/routes'
import {describe, expect, it} from 'vitest'
import {agentsRouteFromUrl} from '../agents-routing'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'

/**
 * The web agents URLs are written by `routeToHref` and read back by `agentsRouteFromUrl`. Those two
 * live in different packages, so nothing but these round trips keeps them agreeing — a link that
 * serializes a field the parser drops silently loses it on reload.
 */
function roundTrip(route: NavRoute): NavRoute | null {
  const href = routeToHref(route)
  if (typeof href !== 'string') throw new Error(`routeToHref produced no href for ${route.key}`)
  const [pathname, search] = href.split('?')
  return agentsRouteFromUrl(pathname!, new URLSearchParams(search ?? ''))
}

describe('web agents routing', () => {
  it('round-trips a run with its server and agent', () => {
    const route: NavRoute = {
      key: 'agent-run',
      runId: 'firing-123',
      serverUrl: 'https://agents.example.com',
      agentId: 'agent-1',
    }
    expect(roundTrip(route)).toEqual(route)
    expect(roundTrip({key: 'agent-run', runId: 'r2'})).toEqual({
      key: 'agent-run',
      runId: 'r2',
      serverUrl: undefined,
      agentId: undefined,
    })
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

  it('names no route for the old index and server URLs, or any unrecognized agents path', () => {
    expect(agentsRouteFromUrl('/hm/agents', new URLSearchParams())).toBeNull()
    expect(agentsRouteFromUrl('/hm/agents/nope', new URLSearchParams())).toBeNull()
    expect(agentsRouteFromUrl('/hm/agents/server', new URLSearchParams('url=https%3A%2F%2Fx'))).toBeNull()
  })
})

describe('agents links as absolute URLs', () => {
  it('a copied trigger link resolves to its route through hypermediaUrlToRoute', () => {
    const route: NavRoute = {
      key: 'agent',
      agentId: 'agent-1',
      serverUrl: 'https://agents.example.com',
      tab: 'triggers',
      triggerId: 'trig/1',
    }
    expect(hypermediaUrlToRoute(`https://hyper.media${routeToHref(route)}`)).toEqual(route)
    // The old index URL is no agents route; it falls through to the ordinary hypermedia parsing.
    expect(hypermediaUrlToRoute('https://hyper.media/hm/agents')).not.toMatchObject({key: 'agent'})
  })
})
