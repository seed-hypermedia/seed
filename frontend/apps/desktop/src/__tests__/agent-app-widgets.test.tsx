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
/** Clicks a button by its text or accessible name; the info popover portals out of the container. */
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === text || button.getAttribute('aria-label') === text,
  )
  expect(button).toBeTruthy()
  await act(async () => {
    button!.click()
  })
  if (text === 'Open in browser')
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(mocks.navigate).toHaveBeenCalled()
    })
}
/** The widget's sandbox frame, once the app has loaded and started. */
async function runningFrame() {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.querySelector('iframe')).not.toBeNull()
  })
  return container.querySelector('iframe')!
}

describe('agent apps', () => {
  it('runs on sight as a bare bubble, keeps its iframe on transcript rerender, and explains itself on request', async () => {
    const markdown = '```seed-widget\n' + JSON.stringify({app: reference}) + '\n```'
    const render = (suffix = '') => (
      <MarkdownAssetContext.Provider value={scope}>
        <Markdown>{markdown + suffix}</Markdown>
      </MarkdownAssetContext.Provider>
    )
    act(() => root.render(render()))
    const frame = await runningFrame()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.srcdoc).toContain('frame-src data:')
    // No chrome: the app is the bubble. The only control outside the app's GUI is the info button.
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['About this app'])
    expect(container.textContent).not.toContain('Sandboxed')
    expect(container.textContent).not.toContain(app.title)
    act(() => root.render(render('\n\nMore text streamed')))
    expect(container.querySelector('iframe')).toBe(frame)
    // The details live behind the info button: title, immutable revision, sandbox note, browser link.
    await click('About this app')
    await vi.waitFor(() => expect(document.body.textContent).toContain(reference))
    expect(document.body.textContent).toContain(app.title)
    expect(document.body.textContent).toContain('sandbox')
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Open in browser')).toBe(true)
    expect(container.querySelector('iframe')).toBe(frame)
  })
  it('shows the failure instead of a frame when the revision cannot be loaded', async () => {
    mocks.request.mockResolvedValueOnce({_: 'ReadSessionAttachmentResponse', attachment: {mimeType: 'text/html'}, data})
    act(() => root.render(<AgentAppWidget reference={reference} height={400} scope={scope} />))
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('not a Seed app')
    })
    expect(container.querySelector('iframe')).toBeNull()
  })
  it('only accepts its own frame results and sends them after a user click with disclosed context', async () => {
    act(() => root.render(<AgentAppWidget reference={reference} height={400} scope={scope} />))
    const frame = await runningFrame()
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
    await runningFrame()
    await click('About this app')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Open in browser'))
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
