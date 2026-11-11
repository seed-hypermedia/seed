import React, {Suspense} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mockState = vi.hoisted(() => ({
  assistantPanelProps: null as null | Record<string, unknown>,
  assistantToggle: null as null | {isOpen: boolean; toggle: () => void},
  ipcSend: vi.fn(),
  serverUrls: ['http://localhost:3050'] as undefined | string[],
  /** Whether every agent list has resolved; 'pending' means we cannot yet say "no agents". */
  agentsStatus: 'success' as 'pending' | 'success',
  hasAgents: true,
  currentRoute: {key: 'missing'} as any,
  documentMounts: 0,
  documentUnmounts: 0,
  bookmarksOpen: false,
  bookmarksClose: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/app-context', () => ({
  useAppContext: () => ({
    platform: 'darwin',
  }),
  useListen: () => {},
}))

vi.mock('@/components/window-controls', async () => {
  const React = await import('react')

  return {
    CloseButton: () => React.createElement('button'),
  }
})

vi.mock('@/errors', () => ({
  default: vi.fn(),
}))

vi.mock('@/ipc', () => ({
  ipc: {
    send: mockState.ipcSend,
  },
}))

vi.mock('@shm/ui/agents/models', () => ({
  useAgentServerUrls: () => ({data: mockState.serverUrls, isLoading: false, isSuccess: true}),
  useOrphanAgents: () => ({agents: [], settled: true}),
  useHasAnyAgent: () => ({
    hasAgents: mockState.hasAgents,
    isSettled: mockState.agentsStatus === 'success',
  }),
}))

// Provisioning is exercised by local-assistant.test.ts; here it must only not interfere.
vi.mock('@/models/local-assistant', () => ({
  useEnsureLocalAssistantAgent: () => {},
}))
// The local-server migration is exercised by local-agents-server.test.ts.
vi.mock('@/models/local-agents-server', () => ({
  useLocalAgentsServerMigration: () => {},
}))

vi.mock('@/models/contacts', () => ({
  useConnectPeer: () => ({
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

vi.mock('@/models/daemon', () => ({
  useMyAccounts: () => [],
}))

vi.mock('@/models/accounts', () => ({
  useDraft: () => ({data: undefined, isLoading: false}),
}))

vi.mock('@/models/documents', () => ({
  useCreateDraft: () => async () => {},
}))

vi.mock('@shm/ui/agents/account', () => ({
  useSelectedAccountId: () => null,
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => null,
}))

vi.mock('@shm/shared', () => ({
  hmId: (uid: string, opts?: {path?: string[]}) => ({uid, path: opts?.path ?? []}),
}))

vi.mock('@/sidebar-context', async () => {
  const React = await import('react')

  return {
    SidebarContextProvider: ({children}: {children: React.ReactNode}) =>
      React.createElement(React.Fragment, null, children),
    useSidebarContext: () => ({
      isLocked: {get: () => false},
      onToggleMenuLock: vi.fn(),
      sidebarWidth: {get: () => 0},
      widthStorage: {
        getItem: () => '0',
        setItem: () => {},
      },
    }),
  }
})

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => mockState.navigate,
}))

vi.mock('@/utils/window-events', () => ({
  useListenAppEvent: () => {},
}))

vi.mock('@/utils/window-types', () => ({
  getWindowType: () => 'main',
}))

vi.mock('@shm/shared/use-stream', () => ({
  useStream: (stream: any) => stream?.get?.() ?? stream,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  getRouteKey: (route: any) => {
    if (route?.key === 'document') {
      return `document:${route.id.uid}:${route.id.path?.join(':') || ''}`
    }
    return route?.key || 'missing'
  },
  useNavRoute: () => mockState.currentRoute,
}))

vi.mock('@shm/ui/container', () => ({
  windowContainerStyles: 'window-container',
}))

vi.mock('@shm/ui/universal-dialog', () => ({
  useAppDialog: () => ({
    content: null,
    open: vi.fn(),
  }),
}))

vi.mock('@shm/ui/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('react-error-boundary', async () => {
  const React = await import('react')

  return {
    ErrorBoundary: ({children}: {children: React.ReactNode}) => React.createElement(React.Fragment, null, children),
  }
})

vi.mock('react-resizable-panels', async () => {
  const React = await import('react')

  const PanelGroup = React.forwardRef(function PanelGroup(
    {children, className}: {children: React.ReactNode; className?: string},
    ref: React.ForwardedRef<{setLayout: () => void}>,
  ) {
    React.useImperativeHandle(ref, () => ({
      setLayout: () => {},
    }))

    return React.createElement('div', {'data-testid': 'panel-group', className}, children)
  })

  return {
    Panel: ({children}: {children: React.ReactNode}) => React.createElement('div', {'data-testid': 'panel'}, children),
    Group: PanelGroup,
    Separator: () => React.createElement('div', {'data-testid': 'panel-resize-handle'}),
  }
})

vi.mock('../components/app-error', async () => {
  const React = await import('react')

  return {
    AppErrorPage: () => React.createElement('div', null, 'App Error'),
    RootAppError: () => React.createElement('div', null, 'Root Error'),
  }
})

vi.mock('@shm/ui/agents/assistant-panel', async () => {
  const React = await import('react')

  return {
    AssistantPanel: (props: Record<string, unknown>) => {
      mockState.assistantPanelProps = props
      return React.createElement('div', {'data-testid': 'assistant-panel'}, 'Assistant Panel')
    },
  }
})

vi.mock('../components/auto-updater', async () => {
  const React = await import('react')

  return {
    AutoUpdater: () => React.createElement('div'),
  }
})

vi.mock('../components/desktop-notification-inbox', () => ({
  DesktopNotificationInbox: () => null,
}))

vi.mock('@/components/bookmarks-panel', () => ({
  BookmarksPanelProvider: ({children}: {children: React.ReactNode}) => children,
  BookmarksPanel: () => null,
  useBookmarksPanel: () => ({isOpen: mockState.bookmarksOpen, open: () => {}, close: mockState.bookmarksClose}),
}))

vi.mock('@shm/ui/activity-panel', () => ({
  NotificationInboxProvider: ({children}: {children: React.ReactNode}) => children,
}))

vi.mock('@shm/ui/activity-panel-layout', async () => {
  const React = await import('react')

  return {
    ActivityPanelProvider: ({children}: {children: React.ReactNode}) => children,
    ActivityPanelOutlet: () => React.createElement('div', {'data-testid': 'activity-outlet'}),
  }
})

vi.mock('../components/footer', async () => {
  const React = await import('react')

  return {
    default: () => React.createElement('div', {'data-testid': 'footer'}),
  }
})

vi.mock('../components/hypermedia-highlight', async () => {
  const React = await import('react')

  return {
    HypermediaHighlight: () => React.createElement('div'),
  }
})

vi.mock('../components/sidebar', async () => {
  const React = await import('react')

  return {
    AppSidebar: () => React.createElement('div', {'data-testid': 'sidebar'}),
  }
})

vi.mock('../components/titlebar', async () => {
  const React = await import('react')

  return {
    TitleBar: () => React.createElement('div', {'data-testid': 'titlebar'}),
  }
})

vi.mock('../components/window-title', () => ({
  WindowTitle: () => null,
}))

vi.mock('../pages/base', async () => {
  const React = await import('react')
  const {useAssistantPanelToggle} = await import('@shm/ui/assistant-panel-toggle')

  return {
    BaseLoading: () => React.createElement('div', null, 'Loading'),
    NotFoundPage: () => {
      mockState.assistantToggle = useAssistantPanelToggle()
      return React.createElement('div', {'data-testid': 'not-found'}, 'Not Found')
    },
  }
})

vi.mock('../pages/document-placeholder', async () => {
  const React = await import('react')

  return {
    DocumentPlaceholder: () => React.createElement('div', null, 'Document Placeholder'),
  }
})

vi.mock('../pages/desktop-resource', async () => {
  const React = await import('react')
  const {useAssistantPanelToggle} = await import('@shm/ui/assistant-panel-toggle')

  return {
    default: function DesktopResourceMock() {
      mockState.assistantToggle = useAssistantPanelToggle()
      React.useEffect(() => {
        mockState.documentMounts += 1
        return () => {
          mockState.documentUnmounts += 1
        }
      }, [])

      return React.createElement('div', {'data-testid': 'desktop-resource'})
    },
  }
})

vi.mock('../pages/polyfills', () => ({}))

import Main from '../pages/main'

function renderMain() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(renderMainTree())
  })

  return {container, root}
}

function renderMainTree() {
  return (
    <Suspense fallback={null}>
      <Main />
    </Suspense>
  )
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Main assistant visibility', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.assistantPanelProps = null
    mockState.assistantToggle = null
    mockState.ipcSend.mockReset()
    mockState.hasAgents = false
    mockState.agentsStatus = 'success'
    mockState.currentRoute = {key: 'missing'}
    mockState.documentMounts = 0
    mockState.documentUnmounts = 0
    mockState.bookmarksOpen = false
    mockState.bookmarksClose.mockReset()
    mockState.navigate.mockReset()
    ;(window as any).initNavState = {
      assistantOpen: true,
      assistantSessionId: 'session-1',
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
    delete (window as any).initNavState
  })

  it('keeps the main panel group stretched to the window height', () => {
    const {container, root} = renderMain()

    expect(container.querySelector('.window-container')?.firstElementChild?.className).toContain('flex-1')

    cleanupRendered(root, container)
  })

  it('hides assistant controls when the account has no agents', async () => {
    const {container, root} = renderMain()

    await flushEffects()

    expect(mockState.assistantToggle).toBeNull()
    expect(container.querySelector('[data-testid="assistant-panel"]')).toBeNull()
    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })

    cleanupRendered(root, container)
  })

  it('shows assistant controls when at least one agent exists', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'

    const {container, root} = renderMain()

    await flushEffects()

    expect(typeof mockState.assistantToggle?.toggle).toBe('function')
    expect(mockState.assistantToggle?.isOpen).toBe(true)
    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.ipcSend).not.toHaveBeenCalled()

    cleanupRendered(root, container)
  })

  it('opens the assistant panel from the title bar chat toggle, restoring the saved session', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'
    ;(window as any).initNavState = {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    }

    const {container, root} = renderMain()

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).toBeNull()

    expect(mockState.assistantToggle?.isOpen).toBe(false)

    act(() => {
      mockState.assistantToggle?.toggle()
    })

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.assistantToggle?.isOpen).toBe(true)
    expect(mockState.assistantPanelProps?.initialSessionId).toBe('session-1')
    expect(mockState.assistantPanelProps?.newChatRequest).toBeUndefined()
    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: true,
      assistantSessionId: 'session-1',
    })

    cleanupRendered(root, container)
  })

  it('keeps the saved assistant state while agent lists are still loading', async () => {
    mockState.hasAgents = false
    mockState.agentsStatus = 'pending'

    const {container, root} = renderMain()

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.ipcSend).not.toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })

    mockState.hasAgents = true
    mockState.agentsStatus = 'success'

    act(() => {
      root.render(renderMainTree())
    })

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.assistantPanelProps?.initialSessionId).toBe('session-1')

    cleanupRendered(root, container)
  })

  it('keeps the document page mounted while navigating between document routes', async () => {
    mockState.currentRoute = {
      key: 'document',
      id: {uid: 'site-1', path: ['page-a']},
    }

    const {container, root} = renderMain()

    await flushEffects()

    expect(container.querySelector('[data-testid="desktop-resource"]')).not.toBeNull()
    expect(mockState.documentMounts).toBe(1)
    expect(mockState.documentUnmounts).toBe(0)

    mockState.currentRoute = {
      key: 'document',
      id: {uid: 'site-1', path: ['page-b']},
    }

    act(() => {
      root.render(renderMainTree())
    })

    await flushEffects()

    expect(container.querySelector('[data-testid="desktop-resource"]')).not.toBeNull()
    expect(mockState.documentMounts).toBe(1)
    expect(mockState.documentUnmounts).toBe(0)

    cleanupRendered(root, container)
    expect(mockState.documentUnmounts).toBe(1)
  })

  it('closes Bookmarks when Agents opens', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'
    mockState.bookmarksOpen = true
    ;(window as any).initNavState = {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    }

    const {container, root} = renderMain()
    await flushEffects()

    act(() => {
      mockState.assistantToggle?.toggle()
    })
    await flushEffects()

    expect(mockState.bookmarksClose).toHaveBeenCalled()

    mockState.bookmarksOpen = false
    act(() => {
      root.render(renderMainTree())
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.assistantPanelProps?.visible).toBe(true)

    cleanupRendered(root, container)
  })

  it('closes Agents when Bookmarks opens', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'

    const {container, root} = renderMain()
    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()

    mockState.bookmarksOpen = true
    act(() => {
      root.render(renderMainTree())
    })
    await flushEffects()

    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })
    expect(mockState.assistantToggle?.isOpen).toBe(false)

    cleanupRendered(root, container)
  })

  it('closes Agents when Activity opens', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'
    mockState.currentRoute = {key: 'document', id: {uid: 'site-1', path: []}, panel: null}

    const {container, root} = renderMain()
    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()

    mockState.currentRoute = {...mockState.currentRoute, panel: {key: 'feed', tab: 'to-you'}}
    act(() => {
      root.render(renderMainTree())
    })
    await flushEffects()

    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })
    expect(container.querySelector('[data-testid="activity-outlet"]')).not.toBeNull()

    cleanupRendered(root, container)
  })

  it('clears the route panel when Agents opens over Activity', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'
    mockState.currentRoute = {
      key: 'document',
      id: {uid: 'site-1', path: []},
      panel: {key: 'feed', tab: 'to-you'},
    }
    ;(window as any).initNavState = {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    }

    const {container, root} = renderMain()
    await flushEffects()

    act(() => {
      mockState.assistantToggle?.toggle()
    })
    await flushEffects()

    expect(mockState.navigate).toHaveBeenCalledWith({...mockState.currentRoute, panel: null})

    cleanupRendered(root, container)
  })

  it('lets a restored Activity panel win over a restored assistant at launch', async () => {
    mockState.hasAgents = true
    mockState.agentsStatus = 'success'
    mockState.currentRoute = {
      key: 'document',
      id: {uid: 'site-1', path: []},
      panel: {key: 'feed', tab: 'to-you'},
    }

    const {container, root} = renderMain()
    await flushEffects()

    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })

    cleanupRendered(root, container)
  })
})
