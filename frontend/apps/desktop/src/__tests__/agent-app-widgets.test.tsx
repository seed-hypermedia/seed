import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {webcrypto, createHash} from 'node:crypto'

const mocks = vi.hoisted(() => ({request: vi.fn(), send: vi.fn(), open: vi.fn(), navigate: vi.fn()}))
vi.mock('@shm/ui/agents/client', () => ({sendAgentAction: mocks.request}))
vi.mock('@shm/ui/agents/models', () => ({useMessageAgentSession: () => ({mutateAsync: mocks.send, isLoading: false})}))
vi.mock('@shm/ui/agents/platform', () => ({
  getAgentsPlatform: () => ({openAgentApp: mocks.open, useNavigate: () => mocks.navigate}),
}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: null})}))

import {AgentAppWidget, loadAgentApp, parseAppWidget} from '@shm/ui/agents/app-widgets'
import {Markdown, MarkdownAssetContext} from '@shm/ui/agents/markdown'
import {normalizeStoredAgentTools} from '@shm/ui/agents/agent-tools'
import {deriveAssistantWindowContext, formatWindowContextLines} from '@shm/ui/agents/assistant-window-context'

const app = {version: 1, title: 'Calculator', html: '<button>Calculate</button>'}
const data = new TextEncoder().encode(JSON.stringify(app))
const id = createHash('sha256').update(data).digest('hex')
const reference = `seed-app:${id}`
const scope = {serverUrl: 'https://agents.test', accountUid: 'owner', sessionId: 'session', agentId: 'agent'}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mocks.request.mockReset().mockResolvedValue({
    _: 'ReadSessionAttachmentResponse',
    attachment: {id, mimeType: 'application/vnd.seed.app+json'},
    data,
  })
  mocks.send.mockReset().mockResolvedValue({})
  mocks.open.mockReset().mockResolvedValue('http://127.0.0.1:4567/local-app')
  mocks.navigate.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text)
  expect(button).toBeTruthy()
  await act(async () => {
    button!.click()
  })
  if (text === 'Run widget')
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelector('iframe')).not.toBeNull()
    })
  if (text === 'Open in browser')
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(mocks.navigate).toHaveBeenCalled()
    })
}

describe('agent apps', () => {
  it('requires explicit Run, keeps its iframe on transcript rerender, and stops on request', async () => {
    const markdown = '```seed-widget\n' + JSON.stringify({app: reference}) + '\n```'
    const render = (suffix = '') => (
      <MarkdownAssetContext.Provider value={scope}>
        <Markdown>{markdown + suffix}</Markdown>
      </MarkdownAssetContext.Provider>
    )
    act(() => root.render(render()))
    expect(mocks.request).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')).toBeNull()
    await click('Run widget')
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.srcdoc).toContain('frame-src data:')
    act(() => root.render(render('\n\nMore text streamed')))
    expect(container.querySelector('iframe')).toBe(frame)
    await click('Stop widget')
    expect(container.querySelector('iframe')).toBeNull()
  })
  it('only accepts its own frame results and sends them after a user click with disclosed context', async () => {
    act(() => root.render(<AgentAppWidget reference={reference} height={400} scope={scope} />))
    await click('Run widget')
    const frame = container.querySelector('iframe')!
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {source: window, data: {type: 'seed-app-result', value: 'spoof'}}),
      ),
    )
    expect(container.textContent).not.toContain('spoof')
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {type: 'seed-app-result', value: {answer: 42}},
        }),
      ),
    )
    expect(container.textContent).toContain('42')
    expect(mocks.send).not.toHaveBeenCalled()
    // The first proposal stays frozen while the user reviews it.
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {type: 'seed-app-result', value: 'replacement'},
        }),
      ),
    )
    expect(container.textContent).not.toContain('replacement')
    await click('Send to agent')
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session',
        message: expect.objectContaining({
          contextLines: expect.arrayContaining(['## App widget', `App: ${reference}`]),
          text: expect.stringContaining('42'),
        }),
      }),
    )
    expect(container.textContent).toContain('Sent')
  })
  it('opens through the integrated browser and identifies the app in window context', async () => {
    act(() => root.render(<AgentAppWidget reference={reference} height={400} scope={scope} />))
    await click('Open in browser')
    expect(mocks.open).toHaveBeenCalledWith(app)
    const route = {key: 'web' as const, url: 'http://127.0.0.1:4567/local-app', title: app.title}
    expect(mocks.navigate).toHaveBeenCalledWith(route)
    expect(formatWindowContextLines(deriveAssistantWindowContext(route, undefined))).toContain(`App: ${reference}`)
  })
  it('rejects wrong revisions, wrong media types, missing scope, and malformed widgets', async () => {
    mocks.request.mockResolvedValueOnce({
      _: 'ReadSessionAttachmentResponse',
      attachment: {mimeType: 'application/vnd.seed.app+json'},
      data: new TextEncoder().encode('changed'),
    })
    await expect(loadAgentApp(scope, reference)).rejects.toThrow('integrity')
    mocks.request.mockResolvedValueOnce({_: 'ReadSessionAttachmentResponse', attachment: {mimeType: 'text/html'}, data})
    await expect(loadAgentApp(scope, reference)).rejects.toThrow('not a Seed app')
    await expect(loadAgentApp(null, reference)).rejects.toThrow('original')
    for (const source of [
      '{',
      JSON.stringify({app: 'https://evil.test'}),
      JSON.stringify({app: reference, height: 99999}),
    ])
      expect(parseAppWidget(source)).toBeNull()
    expect(normalizeStoredAgentTools(['apps', 'browser', 'execute_code', 'unknown'])).toEqual([
      'apps',
      'browser',
      'execute',
    ])
  })
})
