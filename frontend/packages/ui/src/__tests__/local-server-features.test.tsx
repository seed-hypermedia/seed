// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {AgentServerHealth} from '../agents/client'
import {useAgentServerOptions} from '../agents/models'
import {setAgentsPlatform, type AgentsPlatform} from '../agents/platform'
import {useOwnAppServerUrl} from '../agents/server-picker'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * What the app does with a local app environment that runs only some things. Out of the box the
 * desktop's own server runs tools and neither apps nor agents, so it must be where a tool on its
 * own runs, and must not be offered as the place for a new app or agent.
 */

const LOCAL = 'http://localhost:3050'
const HOSTED = 'https://hosted.test/hm/api/apps'

const mocks = vi.hoisted(() => ({
  health: {} as Record<string, unknown>,
}))

vi.mock('../agents/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/client')>()),
  getAgentServerHealth: async (serverUrl: string) => {
    const health = mocks.health[serverUrl]
    if (!health) throw new Error('unreachable')
    return health
  },
}))
// No space is on screen, so no mount document adds a server.
vi.mock('../site-agents', () => ({useSiteAgentMounts: () => ({data: []})}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavRouteOrNull: () => null}))

function platform(local: string | null): AgentsPlatform {
  return {
    defaultServerUrl: () => HOSTED,
    getSigner: async () => {
      throw new Error('not signing')
    },
    // The hosted server is the one remembered and used last.
    getSetting: async (key: string) =>
      key === 'agent-server-urls' ? [HOSTED] : key === 'agent-server-url' ? HOSTED : null,
    setSetting: async () => {},
    getLocalServerUrl: async () => local,
  } as unknown as AgentsPlatform
}

const local = (features: AgentServerHealth['features'], codeExec = true) =>
  ({status: 'ok', uptime: 1, codeExec, ...(features ? {features} : {})}) as AgentServerHealth

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.health = {[HOSTED]: {status: 'ok', uptime: 1}}
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Probe() {
  const own = useOwnAppServerUrl()
  const forApps = useAgentServerOptions('apps')
  const forAgents = useAgentServerOptions('agents')
  return (
    <div>
      <span data-testid="tool">{own.isLoading ? 'loading' : own.serverUrl}</span>
      <span data-testid="apps">{forApps?.join(' ')}</span>
      <span data-testid="agents">{forAgents?.join(' ')}</span>
    </div>
  )
}

async function render() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
  })
  // The queries start once the page has rendered, and the local server's health is asked only
  // after its URL is known: each step needs a render of its own.
  for (let step = 0; step < 3; step++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)!.textContent
  return {tool: text('tool'), apps: text('apps'), agents: text('agents')}
}

describe('a local app environment that runs only some things', () => {
  it('runs a tool on its own locally, and is not offered for a new app or agent, when it runs tools only', async () => {
    setAgentsPlatform(platform(LOCAL))
    mocks.health[LOCAL] = local(['tools'])
    expect(await render()).toEqual({tool: LOCAL, apps: HOSTED, agents: HOSTED})
  })

  it('is offered for what the user checked', async () => {
    setAgentsPlatform(platform(LOCAL))
    mocks.health[LOCAL] = local(['tools', 'agents'])
    const shown = await render()
    expect(shown.agents).toBe(`${LOCAL} ${HOSTED}`)
    expect(shown.apps).toBe(HOSTED)
  })

  it('sends a tool to the server used last when the local one does not run tools, or cannot run code', async () => {
    setAgentsPlatform(platform(LOCAL))
    mocks.health[LOCAL] = local(['agents'])
    expect((await render()).tool).toBe(HOSTED)
    act(() => root.unmount())
    root = createRoot(container)
    // Tools are on, but this computer has no virtualization for the sandbox.
    mocks.health[LOCAL] = local(['tools'], false)
    expect((await render()).tool).toBe(HOSTED)
  })

  it('treats a server that lists nothing as one that runs everything, as servers did before the list', async () => {
    setAgentsPlatform(platform(LOCAL))
    mocks.health[LOCAL] = local(undefined)
    expect(await render()).toEqual({tool: LOCAL, apps: `${LOCAL} ${HOSTED}`, agents: `${LOCAL} ${HOSTED}`})
  })

  it('uses the other servers alone when no local one runs', async () => {
    setAgentsPlatform(platform(null))
    expect(await render()).toEqual({tool: HOSTED, apps: HOSTED, agents: HOSTED})
  })
})
