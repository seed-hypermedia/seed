// @vitest-environment jsdom
import type {AgentResponse, GetSessionResponse, SessionEvent} from '@seed-hypermedia/agents-protocol'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {SeedAgentsHost} from '../host'
import {SeedAgentsProvider} from '../provider'
import type {SeedAgentsRoute} from '../routes'
import {SeedAgentsView} from '../view'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The whole package from the host's side: the real provider, platform adapter, pages, models and
 * signing, against a fake agents server that checks every envelope's signature. Only the wire is
 * faked.
 */
const key = blobs.nobleKeyPairFromSeed(new Uint8Array(32).fill(7))
const accountUid = blobs.principalToString(key.principal)
const serverUrl = 'http://agents.test'
const now = 1_790_000_000_000

function event(seq: number, payload: SessionEvent['event']): SessionEvent {
  return {id: `e${seq}`, sessionId: 's1', seq, event: payload, createdAt: now + seq}
}

const session: GetSessionResponse = {
  _: 'GetSessionResponse',
  session: {
    id: 's1',
    account: accountUid,
    agentId: 'a1',
    title: 'Fix the screen',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  },
  events: [
    event(1, {type: 'message', role: 'user', content: 'Why did the screen fail?'}),
    event(2, {type: 'tool_call', id: 'c1', name: 'read', input: {address: '~/tools/'}}),
    event(3, {type: 'tool_result', toolCallId: 'c1', name: 'read', output: {tools: ['call']}}),
    event(4, {type: 'message', role: 'assistant', content: 'The bundle was **stale**.'}),
  ],
  systemPromptMarkdown: 'You fix screens.',
}

const actions: string[] = []

function respond(action: {_: string}): AgentResponse | {_: 'Error'; message: string} {
  switch (action._) {
    case 'GetSession':
      return session
    case 'GetAgent':
      return {
        _: 'GetAgentResponse',
        sessionCount: 1,
        agent: {
          id: 'a1',
          account: accountUid,
          definition: {name: 'Fixer'} as never,
          stateDir: '/tmp',
          status: 'idle',
          createdAt: now,
          updatedAt: now,
          accessRole: 'owner' as never,
        },
      }
    case 'ListAgents':
      return {_: 'ListAgentsResponse', agents: []} as never
    case 'ListModelProviders':
      return {_: 'ListModelProvidersResponse', providers: []} as never
    case 'ListSessions':
      return {_: 'ListSessionsResponse', sessions: [session.session]} as never
    default:
      return {_: 'Error', message: `fake server: ${action._} not implemented`}
  }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: {data: unknown}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  actions.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === `${serverUrl}/agents/api/health`) {
        return new Response(JSON.stringify({status: 'ok', uptime: 1, protocol: 3}))
      }
      if (href !== `${serverUrl}/api/message`) return new Response('not found', {status: 404})
      const envelope = cbor.decode<blobs.Blob & {action: {_: string}}>(new Uint8Array(init!.body as ArrayBuffer))
      expect(blobs.verify(envelope)).toBe(true)
      actions.push(envelope.action._)
      const reply = respond(envelope.action)
      return new Response(cbor.encode(reply) as BodyInit, {status: reply._ === 'Error' ? 404 : 200})
    }),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const host: SeedAgentsHost = {serverUrl, signer: {accountUid, sign: (data) => key.sign(data)}}

async function renderAt(route: SeedAgentsRoute, props: Partial<React.ComponentProps<typeof SeedAgentsProvider>> = {}) {
  await act(async () => {
    root.render(
      <SeedAgentsProvider host={host} route={route} {...props}>
        <SeedAgentsView />
      </SeedAgentsProvider>,
    )
  })
}

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  throw new Error(`Timed out waiting for ${what}. Actions: ${actions.join(', ')}\n${container.textContent}`)
}

describe('SeedAgentsView', () => {
  it('renders a session transcript with its tool calls, signing every request', async () => {
    await renderAt({key: 'agent-session', sessionId: 's1', agentId: 'a1', serverUrl})
    await waitFor(() => container.textContent!.includes('stale'), 'the assistant message')
    expect(container.textContent).toContain('Why did the screen fail?')
    expect(actions).toContain('GetSession')
    // Tool work folds under a disclosure, as in Seed's apps; opening it shows the tool row.
    const disclosure = Array.from(container.querySelectorAll('button')).find(
      (el) => el.textContent?.includes('Thought for'),
    )
    expect(disclosure).toBeTruthy()
    await act(async () => disclosure!.click())
    // `read ~/tools/` is summarized the way Seed's apps show it.
    await waitFor(() => container.textContent!.includes('all tools'), 'the read tool row')
  })

  it('shows a sign-in notice without a signer', async () => {
    await act(async () => {
      root.render(
        <SeedAgentsProvider host={{serverUrl, signer: null}}>
          <SeedAgentsView />
        </SeedAgentsProvider>,
      )
    })
    await waitFor(() => /sign in|account/i.test(container.textContent!), 'the no-account notice')
    expect(actions).toEqual([])
  })

  it('follows the host route and reports in-app navigation', async () => {
    const onRouteChange = vi.fn()
    await renderAt({key: 'agent-session', sessionId: 's1', agentId: 'a1', serverUrl}, {onRouteChange})
    await waitFor(() => container.textContent!.includes('stale'), 'the session')
    // The breadcrumb names the agent; following it is in-app navigation the host hears about.
    const link = Array.from(container.querySelectorAll('a,button')).find((el) => el.textContent?.trim() === 'Fixer')
    expect(link).toBeTruthy()
    await act(async () => (link as HTMLElement).click())
    await waitFor(() => onRouteChange.mock.calls.length > 0, 'a route change')
    const [reported] = onRouteChange.mock.calls[0]!
    expect(reported).toMatchObject({key: 'agent', agentId: 'a1'})
    // The host's own server is implied, so stored routes work from any origin.
    expect(reported.serverUrl).toBeUndefined()
  })
})
