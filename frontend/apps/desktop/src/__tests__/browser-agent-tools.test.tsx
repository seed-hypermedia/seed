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
  expect(container.textContent).toContain('Let Helper on agents.example.com read and screenshot https://example.com?')
  expect(state.access).not.toHaveBeenCalled()
  expect(state.send).not.toHaveBeenCalled()
})

it('connects after approval, returns commands through the signed API, and offers draft review', async () => {
  await allowThisWebsite()
  expect(container.textContent).toContain('Browser connected to https://example.com')
  const grant = state.access.mock.calls[0]![0]
  expect(grant).toMatchObject({
    browserId: 42,
    accountUid: 'account',
    enabled: true,
    origins: [{origin: 'https://example.com', level: 'read'}],
  })
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({
      serverUrl: props.serverUrl,
      accountUid: props.accountUid,
      action: {_: 'ConnectSessionBrowser', sessionId: 'session', connectionId: grant.connectionId},
    }),
  )
  await act(async () => button('Allow actions on this website').click())
  expect(state.access).toHaveBeenLastCalledWith({...grant, origins: [{origin: 'https://example.com', level: 'act'}]})
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
  await act(async () => button('Allow reading').click())
  expect(state.access).toHaveBeenLastCalledWith({
    ...grant,
    origins: [
      {origin: 'https://example.com', level: 'read'},
      {origin: 'https://mail.example.org', level: 'read'},
    ],
    enabled: true,
  })
  expect(state.execute).toHaveBeenCalledWith(grant.connectionId, command)
})

it('asks again when the user moves to a website they have not allowed', async () => {
  await allowThisWebsite()
  state.route = {key: 'web', browserId: 42, url: 'https://bank.example/accounts'}
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  expect(container.textContent).toContain('screenshot https://bank.example?')
  expect(state.status).toHaveBeenLastCalledWith('unavailable')
  await act(async () => button('Allow on this website').click())
  expect(state.access).toHaveBeenLastCalledWith(
    expect.objectContaining({
      origins: [
        {origin: 'https://example.com', level: 'read'},
        {origin: 'https://bank.example', level: 'read'},
      ],
      enabled: true,
    }),
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

it('grants action access to a new website only when the user chooses actions', async () => {
  await allowThisWebsite()
  await act(async () => button('Allow actions on this website').click())
  const command = {action: 'navigate', document: 'observed', url: 'https://other.example'}
  await act(async () => deliver({_: 'SessionBrowserResponse', request: {id: 'nav', command}}))
  expect(container.textContent).toContain('click and type as you')
  await act(async () => button('Allow actions').click())
  expect(state.access).toHaveBeenLastCalledWith(
    expect.objectContaining({
      origins: [
        {origin: 'https://example.com', level: 'act'},
        {origin: 'https://other.example', level: 'act'},
      ],
    }),
  )
})

it('keeps a session activity log, shows the last 20, and copies only command metadata', async () => {
  const copy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: copy}})
  await allowThisWebsite()
  state.execute.mockResolvedValue({text: 'private page contents'})
  for (let index = 0; index < 21; index++) {
    await act(async () =>
      deliver({_: 'SessionBrowserResponse', request: {id: String(index), command: {action: 'snapshot'}}}),
    )
  }
  state.route = {key: 'web', browserId: 42, url: 'https://example.com/secret?token=secret'}
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  state.execute.mockRejectedValueOnce(new Error('not acting on it'))
  await act(async () =>
    deliver({
      _: 'SessionBrowserResponse',
      request: {id: 'denied', command: {action: 'type', document: 'doc', ref: 'e1', text: 'private input'}},
    }),
  )
  const disclosure = container.querySelector('details')!
  expect(disclosure.open).toBe(false)
  expect(disclosure.querySelectorAll('li')).toHaveLength(20)
  expect(disclosure.textContent).toContain('snapshot · https://example.com · ok')
  expect(disclosure.textContent).toContain('type · https://example.com · refused')
  expect(disclosure.querySelector('time')?.dateTime).toMatch(/^\d{4}-/)
  await act(async () => button('Copy log').click())
  const log = copy.mock.calls[0]![0]
  expect(log.split('\n')).toHaveLength(22)
  expect(log).not.toMatch(/private|secret|token/)
  expect(container.textContent).toContain('Copied')
  await act(async () => button('Revoke').click())
  expect(container.querySelectorAll('li')).toHaveLength(20)
  // The assistant panel keys this component by server, session and account.
  await act(async () => root.render(<BrowserAgentTools key="another-session" {...props} sessionId="another-session" />))
  expect(container.querySelector('details')).toBeNull()
  expect(container.textContent).toContain('Allow on this website')
})

it('logs denied navigation without running the command, and reports clipboard failures', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {writeText: vi.fn().mockRejectedValue(new Error('denied'))},
  })
  await allowThisWebsite()
  await act(async () =>
    deliver({
      _: 'SessionBrowserResponse',
      request: {
        id: 'nav',
        command: {action: 'navigate', document: 'doc', url: 'https://other.example/private?q=secret'},
      },
    }),
  )
  await act(async () => button('Deny').click())
  expect(state.execute).not.toHaveBeenCalled()
  expect(container.querySelector('details')?.textContent).toContain('navigate · https://other.example · refused')
  await act(async () => button('Copy log').click())
  expect(container.textContent).toContain('Unable to copy log')
})
