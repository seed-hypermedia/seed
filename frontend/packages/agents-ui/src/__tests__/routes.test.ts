import {describe, expect, it} from 'vitest'
import {seedAgentsRouteFromPath, seedAgentsRouteToPath, seedAgentsRouteToWebUrl, type SeedAgentsRoute} from '../routes'

const routes: [SeedAgentsRoute, string][] = [
  [{key: 'agent', agentId: 'a1'}, 'agent/a1'],
  [
    {
      key: 'agent',
      agentId: 'a1',
      serverUrl: 'https://x.dev/p',
      tab: 'triggers',
      triggerId: 't 1',
      memoryPath: 'notes/a.md',
    },
    'agent/a1?server=https%3A%2F%2Fx.dev%2Fp&tab=triggers&trigger=t%201&file=notes%2Fa.md',
  ],
  [{key: 'agent-session', sessionId: 's1', agentId: 'a1'}, 'session/s1?agent=a1'],
  [{key: 'agent-run', runId: 'r1', serverUrl: 'http://h'}, 'run/r1?server=http%3A%2F%2Fh'],
]

describe('agents routes', () => {
  it.each(routes)('round-trips %j', (route, path) => {
    expect(seedAgentsRouteToPath(route)).toBe(path)
    const parsed = seedAgentsRouteFromPath(path)
    expect(Object.fromEntries(Object.entries(parsed!).filter(([, value]) => value !== undefined))).toEqual(route)
  })

  it('names no route for unknown or empty paths, including the old list and server paths', () => {
    expect(seedAgentsRouteFromPath('nonsense/x')).toBeNull()
    expect(seedAgentsRouteFromPath('/')).toBeNull()
    expect(seedAgentsRouteFromPath('agent/')).toBeNull()
    expect(seedAgentsRouteFromPath('server?url=http%3A%2F%2F127.0.0.1%3A3053')).toBeNull()
  })

  it('accepts a leading slash and drops unknown tabs', () => {
    expect(seedAgentsRouteFromPath('/agent/a1?tab=bogus')).toEqual({
      key: 'agent',
      agentId: 'a1',
      serverUrl: undefined,
      tab: undefined,
      triggerId: undefined,
      memoryPath: undefined,
    })
  })

  it('builds Seed web URLs', () => {
    expect(seedAgentsRouteToWebUrl({key: 'agent', agentId: 'a1'})).toBe('https://hyper.media/hm/agents/agent/a1')
    expect(seedAgentsRouteToWebUrl({key: 'agent-session', sessionId: 's1'}, 'https://seed.example/')).toBe(
      'https://seed.example/hm/agents/session/s1',
    )
  })
})
