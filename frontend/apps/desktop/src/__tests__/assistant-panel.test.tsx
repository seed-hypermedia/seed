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
  navigationContext: {
    state: {},
    dispatch: vi.fn(),
  } as any,
  openUrl: vi.fn(),
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

vi.mock('@/open-url', () => ({
  useOpenUrl: () => mockState.openUrl,
}))

// Avoid vi.importActual here: navigation → routing → utils barrel → url-to-route → navigation
// forms a circular dependency that deadlocks vitest's module loader.
vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'library'}),
    useNavigation: (overrideNavigation: unknown) => overrideNavigation ?? mockState.navigationContext,
    NavContextProvider: NavContext.Provider,
    navStateReducer: (state: any) => state,
    getRouteKey: () => 'library',
    appRouteOfId: () => undefined,
    isHttpUrl: () => false,
    useNavigate: () => vi.fn(),
    useNavigationState: () => ({}),
    useNavigationDispatch: () => vi.fn(),
    useRouteDocId: () => null,
  }
})

vi.mock('@shm/shared/utils/entity-id-url', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/utils/entity-id-url')>(
    '@shm/shared/utils/entity-id-url',
  )

  return {
    ...actual,
    packHmId: vi.fn(),
  }
})

vi.mock('../components/markdown', () => ({
  Markdown: ({children}: {children: React.ReactNode}) => React.createElement('div', null, children),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: null}),
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
    mockState.openUrl.mockReset()
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

    expect(container.textContent).toContain('Thinking…')
    expect(container.querySelector('svg.animate-spin')).not.toBeNull()

    cleanupRendered(root, container)
  })

  it('creates a fresh chat and focuses the input when requested from outside the panel', async () => {
    const {container, root} = renderAssistantPanel({newChatRequest: 1})

    await flushAsyncWork()

    const input = container.querySelector('textarea')

    expect(mockState.createSessionMutateAsync).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)

    cleanupRendered(root, container)
  })

  it('renders one-line search tool calls with expandable registry details', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'search',
              args: {query: 'seed'},
              result: 'Found 1 result for "seed".',
              rawOutput: {
                summary: 'Found 1 result for "seed".',
                query: 'seed',
                searchType: 'hybrid',
                includeBody: false,
                markdown:
                  'Search results for "seed" (1 result, search type: hybrid, include body: no)\n\n1. [Seed Notes](hm://z6Mkabc/projects/seed)\n   - Type: document\n   - Parents: Projects\n   - Updated: 3/19/2026, 10:00 AM\n   - URL: hm://z6Mkabc/projects/seed',
                results: [
                  {
                    title: 'Seed Notes',
                    url: 'hm://z6Mkabc/projects/seed',
                    type: 'document',
                    parentNames: ['Projects'],
                    versionTime: '3/19/2026, 10:00 AM',
                  },
                ],
              },
            },
          ],
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()
    const detailsButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'Show tool details',
    )

    expect(container.textContent).toContain('Search')
    expect(container.textContent).toContain('Found 1 result for "seed".')
    expect(container.textContent).toContain('Seed Notes')
    expect(container.textContent).not.toContain('Search results for "seed"')

    act(() => {
      detailsButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(container.textContent).toContain('Search results for "seed"')
    expect(container.textContent).toContain('"query": "seed"')

    cleanupRendered(root, container)
  })

  it('renders a user-facing read tool bubble', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'read',
              args: {id: 'hm://z6Mkabc/projects/seed'},
              result: 'Read "Seed Notes".',
              rawOutput: {
                summary: 'Read "Seed Notes".',
                resourceUrl: 'hm://z6Mkabc/projects/seed',
                view: 'document',
                title: 'Seed Notes',
                displayLabel: 'Seed Notes in Seed',
                markdown: '# Seed Notes\n\nProject status and notes.',
              },
            },
          ],
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()
    const openResourceButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === 'Seed Notes',
    )

    expect(container.textContent).toContain('Read document: Seed Notes')
    expect(container.textContent).not.toContain('hm://z6Mkabc/projects/seed')
    expect(container.textContent).not.toContain('Project status and notes.')

    act(() => {
      openResourceButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkabc/projects/seed', false)

    const expandButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'Show tool details',
    )
    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(container.textContent).toContain('Project status and notes.')

    cleanupRendered(root, container)
  })

  it('renders the registry-defined comment.create write UI', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool',
              id: 'tool-comment',
              name: 'write',
              args: {command: 'comment.create', input: {target: 'hm://z6Mkdoc/spec', body: 'Great point!'}},
              result: 'comment.create completed',
              rawOutput: {
                command: 'comment.create',
                commentId: 'z6Mkdoc/spec/comment-1',
                targetUrl: 'hm://z6Mkdoc/spec',
                targetName: 'Spec Doc',
                signer: {profileName: 'Alice', publicKey: 'z6Mkauthor'},
                markdown: 'Great point!',
              },
            },
          ],
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()

    expect(container.textContent).toContain('New Comment by Alice on Spec Doc')
    expect(container.textContent).not.toContain('Great point!')

    const commentButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === 'New Comment',
    )
    const authorButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === 'Alice',
    )
    const docButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === 'Spec Doc',
    )

    act(() => {
      commentButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      authorButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      docButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkdoc/spec/:comments/z6Mkdoc/spec/comment-1', false)
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkauthor/:profile', false)
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkdoc/spec', false)

    const expandButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'Show tool details',
    )
    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(container.textContent).toContain('Great point!')

    const infoButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'View raw tool input/output',
    )
    act(() => {
      infoButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(document.body.textContent).toContain('Raw tool call payload captured during the assistant response.')
    expect(document.body.textContent).toContain('comment.create')

    cleanupRendered(root, container)
  })

  it('renders the registry-defined document.create write UI', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool',
              id: 'tool-document',
              name: 'write',
              args: {
                command: 'document.create',
                input: {path: '/product-brief', name: 'Product Brief', body: '# Product Brief\n\nShip it.'},
              },
              result: 'document.create completed',
              rawOutput: {
                command: 'document.create',
                id: 'hm://z6Mkdoc/product-brief',
                signer: {profileName: 'Alice', publicKey: 'z6Mkauthor'},
              },
            },
          ],
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()

    expect(container.textContent).toContain('Create document: Product Brief')
    expect(container.textContent).not.toContain('Write')
    expect(container.textContent).not.toContain('document.create completed')

    const documentButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === 'Product Brief',
    )

    act(() => {
      documentButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkdoc/product-brief', false)

    cleanupRendered(root, container)
  })

  it('renders the registry-defined document.update write UI with rendered content details', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool',
              id: 'tool-document-update',
              name: 'write',
              args: {
                command: 'document.update',
                input: {
                  edit: 'hm://z6Mkdoc/product-brief',
                  name: 'Product Brief',
                  body: '# Product Brief\n\nUpdated plan.',
                },
              },
              result: 'document.update completed',
              rawOutput: {
                command: 'document.update',
                id: 'hm://z6Mkdoc/product-brief',
                version: 'bafyupdate',
              },
            },
          ],
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()

    expect(container.textContent).toContain('Update document: Product Brief')
    expect(container.textContent).not.toContain('document.update completed')
    expect(container.textContent).not.toContain('Updated plan.')

    const expandButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === 'Show tool details',
    )
    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(container.textContent).toContain('Updated plan.')
    expect(container.textContent).not.toContain('"input"')
    expect(container.textContent).not.toContain('"output"')

    cleanupRendered(root, container)
  })

  it('falls back to a generic bubble for unrecognized tool calls', () => {
    mockState.chatSession = {
      providerId: 'provider-1',
      messages: [
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool',
              id: 'tool-unknown',
              name: 'unknown_tool',
              args: {value: 'example'},
              result: 'Completed.',
            },
          ],
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      ],
    }

    const {container, root} = renderAssistantPanel()

    expect(container.textContent).toContain('unknown_tool')
    expect(container.textContent).toContain('Completed.')
    expect(container.textContent).not.toContain('example')

    cleanupRendered(root, container)
  })
})
