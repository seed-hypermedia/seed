import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  route: {key: 'web', browserId: 42, url: 'https://example.com'} as Record<string, unknown>,
  send: vi.fn(),
  access: vi.fn(),
  execute: vi.fn(),
  navigate: vi.fn(),
  status: vi.fn(),
}))
vi.mock('@/models/experiments', () => ({useExperiments: () => ({data: {webBrowser: true}})}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => state.navigate}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavRoute: () => state.route}))
vi.mock('@shm/ui/agents/client', () => ({sendAgentAction: state.send}))
vi.mock('@shm/ui/agents/assistant-window-context', () => ({setAssistantBrowserStatus: state.status}))

import {BrowserAgentTools} from '../browser-agent-tools'

let container: HTMLDivElement
let root: Root
let deliver: (response: unknown) => void
const props = {
  serverUrl: 'https://agents.example.com',
  sessionId: 'session',
  accountUid: 'account',
  toolEnabled: true,
  agentName: 'Helper',
  isOwner: true,
  isPublic: false,
}
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((element) => element.textContent === label)!
async function allowThisWebsite() {
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  await act(async () => button('Allow on this website').click())
}

beforeEach(() => {
  vi.clearAllMocks()
  state.route = {key: 'web', browserId: 42, url: 'https://example.com'}
  state.access.mockResolvedValue(undefined)
  state.execute.mockResolvedValue({draftId: 'archive-draft', summary: 'Created draft'})
  window.browserAgent = {access: state.access, execute: state.execute}
  state.send.mockImplementation(({action, signal}) => {
    if (action._ !== 'PollSessionBrowser') return Promise.resolve({_: 'SessionBrowserResponse'})
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Cancelled'))
      signal.addEventListener('abort', abort, {once: true})
      deliver = (response) => {
        signal.removeEventListener('abort', abort)
        resolve(response)
      }
    })
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('stays disconnected until the user allows the visible website', async () => {
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  expect(container.textContent).toContain(
    'Let Helper on agents.example.com read, screenshot and act on https://example.com?',
  )
  expect(state.access).not.toHaveBeenCalled()
  expect(state.send).not.toHaveBeenCalled()
})

it('connects after approval, returns commands through the signed API, and offers draft review', async () => {
  await allowThisWebsite()
  expect(container.textContent).toContain('Browser connected to https://example.com')
  const grant = state.access.mock.calls[0]![0]
  expect(grant).toMatchObject({browserId: 42, accountUid: 'account', enabled: true, origins: ['https://example.com']})
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({
      serverUrl: props.serverUrl,
      accountUid: props.accountUid,
      action: {_: 'ConnectSessionBrowser', sessionId: 'session', connectionId: grant.connectionId},
    }),
  )
  const command = {action: 'archive', document: 'observed'}
  await act(async () => deliver({_: 'SessionBrowserResponse', request: {id: 'request-1', command}}))
  expect(state.execute).toHaveBeenCalledWith(grant.connectionId, command)
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({
      action: expect.objectContaining({
        _: 'ResolveSessionBrowser',
        requestId: 'request-1',
        output: {draftId: 'archive-draft', summary: 'Created draft'},
      }),
    }),
  )
  await act(async () => button('Review archived draft').click())
  expect(state.navigate).toHaveBeenCalledWith({key: 'draft', id: 'archive-draft'})
  await act(async () => button('Pause').click())
  expect(container.textContent).toContain('Browser access paused')
  expect(state.access).toHaveBeenCalledWith({
    connectionId: grant.connectionId,
    browserId: 42,
    accountUid: 'account',
    enabled: false,
  })
  expect(state.status).toHaveBeenCalledWith('paused')
})

it('asks before the agent opens another website and reports a denial to the agent', async () => {
  await allowThisWebsite()
  const grant = state.access.mock.calls[0]![0]
  const command = {action: 'navigate', document: 'observed', url: 'https://mail.example.org/inbox?q=1'}
  await act(async () => deliver({_: 'SessionBrowserResponse', request: {id: 'nav-1', command}}))
  expect(container.textContent).toContain('Helper wants to open https://mail.example.org')
  expect(state.execute).not.toHaveBeenCalled()
  await act(async () => button('Deny').click())
  expect(state.execute).not.toHaveBeenCalled()
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({
      action: expect.objectContaining({
        _: 'ResolveSessionBrowser',
        requestId: 'nav-1',
        error: 'The user did not allow opening https://mail.example.org.',
      }),
    }),
  )
  await act(async () => deliver({_: 'SessionBrowserResponse', request: {id: 'nav-2', command}}))
  await act(async () => button('Allow').click())
  expect(state.access).toHaveBeenLastCalledWith({
    ...grant,
    origins: ['https://example.com', 'https://mail.example.org'],
    enabled: true,
  })
  expect(state.execute).toHaveBeenCalledWith(grant.connectionId, command)
})

it('asks again when the user moves to a website they have not allowed', async () => {
  await allowThisWebsite()
  state.route = {key: 'web', browserId: 42, url: 'https://bank.example/accounts'}
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  expect(container.textContent).toContain('act on https://bank.example?')
  expect(state.status).toHaveBeenLastCalledWith('unavailable')
  await act(async () => button('Allow on this website').click())
  expect(state.access).toHaveBeenLastCalledWith(
    expect.objectContaining({origins: ['https://example.com', 'https://bank.example'], enabled: true}),
  )
})

it('revokes browser access when the window moves to native Seed content', async () => {
  await allowThisWebsite()
  const grant = state.access.mock.calls[0]![0]
  state.route = {key: 'library'}
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  expect(container.textContent).toBe('')
  expect(state.access).toHaveBeenCalledWith({
    connectionId: grant.connectionId,
    browserId: 42,
    accountUid: 'account',
    enabled: false,
  })
  expect(state.execute).not.toHaveBeenCalled()
})

it('never offers the browser to agents the user does not own or to public agents', async () => {
  await act(async () => root.render(<BrowserAgentTools {...props} isOwner={false} />))
  expect(container.textContent).toContain('only available for agents you own')
  await act(async () => root.render(<BrowserAgentTools {...props} isPublic />))
  expect(container.textContent).toContain('not available for public agents')
  expect(state.access).not.toHaveBeenCalled()
  expect(state.send).not.toHaveBeenCalled()
})

it('does not connect when the agent lacks the browser tool grant', async () => {
  await act(async () => root.render(<BrowserAgentTools {...props} toolEnabled={false} />))
  expect(container.textContent).toContain('disabled in this agent’s tool settings')
  expect(state.access).not.toHaveBeenCalled()
  expect(state.send).not.toHaveBeenCalled()
})
