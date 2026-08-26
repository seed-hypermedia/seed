import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * A site can advertise an agents server in its home document. While one of its documents is on
 * screen, that server joins the list the agents UI connects to — after the app's local server,
 * ahead of the user's own configured servers — without ever being written into the configured
 * list. Outside a document (or a navigation provider) nothing is advertised.
 */

const mockState = vi.hoisted(() => ({
  route: null as null | Record<string, unknown>,
  homeMetadata: {} as Record<string, unknown>,
  resourceRequests: [] as string[],
  configured: ['https://mine.example'] as string[],
}))

vi.mock('@shm/ui/agents/platform', () => ({
  getAgentsPlatform: () => ({
    defaultServerUrl: () => null,
    getSetting: async (key: string) => (key === 'agent-server-urls' ? mockState.configured : null),
    setSetting: vi.fn(),
    getLocalServerUrl: async () => 'http://localhost:4200',
  }),
  setAgentsPlatform: vi.fn(),
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavRouteOrNull: () => mockState.route}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: {uid: string} | undefined) => {
    if (id) mockState.resourceRequests.push(id.uid)
    return id ? {data: {type: 'document', document: {metadata: mockState.homeMetadata}}} : {data: undefined}
  },
}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

import {useAgentServerUrls} from '@shm/ui/agents/models'

let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useAgentServerUrls> | null = null

function Probe() {
  latest = useAgentServerUrls()
  return null
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
  // Let the settings and local-server queries resolve.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mockState.route = null
  mockState.homeMetadata = {}
  mockState.resourceRequests = []
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('site-advertised agent server', () => {
  it('adds the server of the site on screen after the local server and ahead of configured ones', async () => {
    mockState.route = {key: 'document', id: {uid: 'site-uid', path: ['about']}}
    mockState.homeMetadata = {name: 'A Site', agentServerUrl: 'https://agents.site.example/'}
    await render()
    expect(mockState.resourceRequests).toContain('site-uid')
    expect(latest!.advertisedServerUrl).toBe('https://agents.site.example')
    expect(latest!.data).toEqual(['http://localhost:4200', 'https://agents.site.example', 'https://mine.example'])
  })

  it('advertises nothing without a document route or when the home document has no server', async () => {
    mockState.route = {key: 'agents'}
    await render()
    expect(latest!.advertisedServerUrl).toBeNull()
    expect(latest!.data).toEqual(['http://localhost:4200', 'https://mine.example'])

    mockState.route = {key: 'document', id: {uid: 'site-uid', path: []}}
    mockState.homeMetadata = {name: 'A Site'}
    await render()
    expect(latest!.advertisedServerUrl).toBeNull()
  })

  it('ignores an advertised value that is not an http(s) URL and dedupes one the user already configured', async () => {
    mockState.route = {key: 'document', id: {uid: 'site-uid', path: []}}
    mockState.homeMetadata = {agentServerUrl: 'not a url'}
    await render()
    expect(latest!.advertisedServerUrl).toBeNull()

    mockState.homeMetadata = {agentServerUrl: 'https://mine.example'}
    await render()
    expect(latest!.data).toEqual(['http://localhost:4200', 'https://mine.example'])
  })

  it("uses a draft's edit target as the site", async () => {
    mockState.route = {key: 'draft', id: 'draft-1', editUid: 'site-uid'}
    mockState.homeMetadata = {agentServerUrl: 'https://agents.site.example'}
    await render()
    expect(latest!.advertisedServerUrl).toBe('https://agents.site.example')
  })
})
