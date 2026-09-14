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
const props = {serverUrl: 'https://agents.example.com', sessionId: 'session', accountUid: 'account', toolEnabled: true}

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

it('connects this window, returns commands through the signed API, and offers draft review', async () => {
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  expect(container.textContent).toContain('Browser connected')
  const grant = state.access.mock.calls[0]![0]
  expect(grant).toMatchObject({browserId: 42, accountUid: 'account', enabled: true})
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
  const review = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Review archived draft',
  )!
  await act(async () => review.click())
  expect(state.navigate).toHaveBeenCalledWith({key: 'draft', id: 'archive-draft'})
  const pause = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Pause')!
  await act(async () => pause.click())
  expect(container.textContent).toContain('Browser access paused')
  expect(state.access).toHaveBeenCalledWith({...grant, enabled: false})
  expect(state.status).toHaveBeenCalledWith('paused')
})

it('revokes browser access when the window moves to native Seed content', async () => {
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  const grant = state.access.mock.calls[0]![0]
  state.route = {key: 'library'}
  await act(async () => root.render(<BrowserAgentTools {...props} />))
  expect(container.textContent).toBe('')
  expect(state.access).toHaveBeenCalledWith({...grant, enabled: false})
  expect(state.execute).not.toHaveBeenCalled()
})

it('does not connect when the agent lacks the browser tool grant', async () => {
  await act(async () => root.render(<BrowserAgentTools {...props} toolEnabled={false} />))
  expect(container.textContent).toContain('disabled in this agent’s tool settings')
  expect(state.access).not.toHaveBeenCalled()
  expect(state.send).not.toHaveBeenCalled()
})
