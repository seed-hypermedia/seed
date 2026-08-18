import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Agents breadcrumbs must present the desktop-managed server as "Local Agents", never as
 * "localhost:<port>" — the port is reassigned every launch, so the address is meaningless to the
 * user and reads like something is misconfigured.
 */

const mockState = vi.hoisted(() => ({
  localServerUrl: 'http://localhost:3051' as string | null,
}))

vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
vi.mock('@shm/ui/agents/navigation', () => ({
  useNavigate: () => vi.fn(),
  useClickNavigate: () => vi.fn(),
  useOpenUrl: () => vi.fn(),
  resolveHypermediaRoute: () => null,
}))
vi.mock('@shm/ui/agents/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/ui/agents/models')>()
  return {
    ...actual,
    useLocalAgentServerUrl: () => ({data: mockState.localServerUrl}),
  }
})

import {AgentBreadcrumb} from '@shm/ui/agents/header'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentBreadcrumb server label', () => {
  it('names the local server "Local Agents" instead of its ephemeral address', () => {
    act(() => {
      root.render(<AgentBreadcrumb serverUrl="http://localhost:3051" agentName="Assistant" agentId="a1" />)
    })
    expect(container.textContent).toContain('Local Agents')
    expect(container.textContent).not.toContain('localhost')
  })

  it('still shows the host for remote servers, whose address is real and stable', () => {
    act(() => {
      root.render(<AgentBreadcrumb serverUrl="https://agentic.seed.hyper.media" />)
    })
    expect(container.textContent).toContain('agentic.seed.hyper.media')
  })
})
