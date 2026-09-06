// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ChatMessageBubble} from '../agents/message-rendering'
import {setAgentsPlatform} from '../agents/platform'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Exercises the whole chat path for an agent that answers "show me the image" with a memory
 * path: the real bubble, the real Markdown renderer, the real react-query hook, down to the one
 * signed API call — only the wire is faked.
 */
const sendAgentAction = vi.fn()
vi.mock('../agents/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/client')>()),
  sendAgentAction: (...args: unknown[]) => sendAgentAction(...args),
}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: null}),
  useAccount: () => ({data: null}),
}))
vi.mock('../agents/navigation', () => ({
  useOpenUrl: () => vi.fn(),
  useClickNavigate: () => vi.fn(),
  useNavigate: () => vi.fn(),
  resolveHypermediaRoute: () => null,
}))

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('ChatMessageBubble with a memory image', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    sendAgentAction.mockReset()
    setAgentsPlatform(
      new Proxy(
        {useGatewayUrl: () => 'https://gw.example', useAccountUid: () => 'owner-account'},
        {get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined)},
      ) as never,
    )
    Object.assign(URL, {createObjectURL: () => 'blob:memory-image', revokeObjectURL: () => {}})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 50 && !check(); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
    expect(check()).toBe(true)
  }

  it('fetches the file for this agent over the signed API and renders it inline', async () => {
    sendAgentAction.mockResolvedValue({
      _: 'ReadAgentMemoryFileResponse',
      file: {
        path: 'ads/one.png',
        size: PNG.byteLength,
        updatedAt: 1,
        mimeType: 'image/png',
        encoding: 'binary',
        data: PNG,
      },
    })
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatMessageBubble
            message={{
              role: 'assistant',
              content: 'Here it is:\n\n![The ad](~/memory/ads/one.png)',
              sessionId: 'sess-1',
            }}
            serverUrl="https://agents.example"
            accountUid="owner-account"
            agentId="agent-1"
          />
        </QueryClientProvider>,
      )
    })

    await waitFor(() => container.querySelector('img')?.getAttribute('src') === 'blob:memory-image')
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('The ad')
    expect(sendAgentAction).toHaveBeenCalledTimes(1)
    expect(sendAgentAction.mock.calls[0]![0]).toEqual({
      serverUrl: 'https://agents.example',
      accountUid: 'owner-account',
      action: {_: 'ReadAgentMemoryFile', agentId: 'agent-1', path: 'ads/one.png'},
    })
  })

  it('never issues a request for a plain web image, and routes ipfs:// through the gateway', async () => {
    const queryClient = new QueryClient()
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatMessageBubble
            message={{role: 'assistant', content: '![a](https://x.test/a.png) ![b](ipfs://bafyb)', sessionId: 'sess-1'}}
            serverUrl="https://agents.example"
            accountUid="owner-account"
            agentId="agent-1"
          />
        </QueryClientProvider>,
      )
    })
    const srcs = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'))
    expect(srcs).toEqual(['https://x.test/a.png', 'https://gw.example/ipfs/bafyb'])
    expect(sendAgentAction).not.toHaveBeenCalled()
  })
})
