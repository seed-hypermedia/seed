import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mockState = vi.hoisted(() => ({
  chatSession: null as any,
  chatSessions: [] as any[],
  chatStream: {
    streamingText: '',
    isStreaming: false,
    streamComplete: false,
    pendingToolCalls: [] as any[],
    pendingToolResults: [] as any[],
    clearStream: vi.fn(),
    stopStream: vi.fn(),
  },
  createSessionMutateAsync: vi.fn(),
  deleteSessionMutate: vi.fn(),
  navigate: vi.fn(),
  providers: [] as any[],
  sendMessageMutate: vi.fn(),
  setSessionProviderMutate: vi.fn(),
}))

vi.mock('@/models/ai-config', () => ({
  useAIProviders: () => ({data: mockState.providers}),
}))

vi.mock('@/models/chat', () => ({
  useChatSession: () => ({data: mockState.chatSession}),
  useChatSessions: () => ({data: mockState.chatSessions}),
  useChatStream: () => mockState.chatStream,
  useCreateChatSession: () => ({mutateAsync: mockState.createSessionMutateAsync}),
  useDeleteChatSession: () => ({mutate: mockState.deleteSessionMutate}),
  useSendChatMessage: () => ({mutate: mockState.sendMessageMutate}),
  useSetSessionProvider: () => ({mutate: mockState.setSessionProviderMutate}),
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => mockState.navigate,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'library'}),
}))

vi.mock('@shm/shared/utils/entity-id-url', () => ({
  packHmId: vi.fn(),
}))

vi.mock('../components/markdown', () => ({
  Markdown: ({children}: {children: React.ReactNode}) => React.createElement('div', null, children),
}))

import {AssistantPanel} from '../components/assistant-panel'

function renderAssistantPanel(props: React.ComponentProps<typeof AssistantPanel> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<AssistantPanel initialSessionId="session-1" {...props} />)
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [],
    }
    mockState.chatSessions = [
      {
        id: 'session-1',
        title: 'Session 1',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
      },
    ]
    mockState.chatStream = {
      streamingText: '',
      isStreaming: false,
      streamComplete: false,
      pendingToolCalls: [],
      pendingToolResults: [],
      clearStream: vi.fn(),
      stopStream: vi.fn(),
    }
    mockState.createSessionMutateAsync.mockReset()
    mockState.createSessionMutateAsync.mockResolvedValue({id: 'session-2'})
    mockState.deleteSessionMutate.mockReset()
    mockState.navigate.mockReset()
    mockState.providers = [{id: 'provider-1', label: 'Gemini', model: 'gemini-2.5-flash'}]
    mockState.sendMessageMutate.mockReset()
    mockState.setSessionProviderMutate.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders provider errors with destructive styling in the transcript', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          errorMessage: 'Quota exceeded for model gemini-3.1-pro.',
          isError: true,
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()
    const errorBlock = Array.from(container.querySelectorAll('.text-destructive')).find(
      (element) => element.textContent?.includes('Quota exceeded for model gemini-3.1-pro.'),
    )

    expect(errorBlock?.className).toContain('text-destructive')

    cleanupRendered(root, container)
  })

  it('shows a thinking indicator while waiting for the first streamed chunk', () => {
    mockState.chatStream = {
      streamingText: '',
      isStreaming: true,
      streamComplete: false,
      pendingToolCalls: [],
      pendingToolResults: [],
      clearStream: vi.fn(),
      stopStream: vi.fn(),
    }

    const {container, root} = renderAssistantPanel()

    expect(container.textContent).toContain('Thinking...')
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()

    cleanupRendered(root, container)
  })

  it('creates a fresh chat and focuses the input when requested from outside the panel', async () => {
    const {container, root} = renderAssistantPanel({newChatRequest: 1})

    await flushAsyncWork()

    const input = container.querySelector('input')

    expect(mockState.createSessionMutateAsync).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)

    cleanupRendered(root, container)
  })
})
