import React, {Suspense} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mockState = vi.hoisted(() => ({
  assistantPanelProps: null as null | Record<string, unknown>,
  footerProps: null as null | Record<string, unknown>,
  ipcSend: vi.fn(),
  providers: undefined as undefined | Array<{id: string; label?: string; model?: string}>,
  providersStatus: 'success' as 'pending' | 'success',
}))

vi.mock('@/app-context', () => ({
  useAppContext: () => ({
    platform: 'darwin',
  }),
  useListen: () => {},
}))

vi.mock('@/components/link-device-dialog', async () => {
  const React = await import('react')

  return {
    LinkDeviceDialog: () => React.createElement('div'),
  }
})

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

vi.mock('@/models/ai-config', () => ({
  useAIProviders: () => ({
    data: mockState.providers,
    isLoading: mockState.providersStatus === 'pending',
    isSuccess: mockState.providersStatus === 'success',
  }),
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
  useNavigate: () => vi.fn(),
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
  getRouteKey: () => 'missing',
  useNavRoute: () => ({key: 'missing'}),
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
    {children}: {children: React.ReactNode},
    ref: React.ForwardedRef<{setLayout: () => void}>,
  ) {
    React.useImperativeHandle(ref, () => ({
      setLayout: () => {},
    }))

    return React.createElement('div', {'data-testid': 'panel-group'}, children)
  })

  return {
    Panel: ({children}: {children: React.ReactNode}) => React.createElement('div', {'data-testid': 'panel'}, children),
    PanelGroup,
    PanelResizeHandle: () => React.createElement('div', {'data-testid': 'panel-resize-handle'}),
  }
})

vi.mock('../components/app-error', async () => {
  const React = await import('react')

  return {
    AppErrorPage: () => React.createElement('div', null, 'App Error'),
    RootAppError: () => React.createElement('div', null, 'Root Error'),
  }
})

vi.mock('../components/assistant-panel', async () => {
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

vi.mock('../components/footer', async () => {
  const React = await import('react')

  return {
    default: (props: Record<string, unknown>) => {
      mockState.footerProps = props
      return React.createElement('div', {
        'data-has-assistant-toggle': String(Boolean(props.onToggleAssistant)),
        'data-testid': 'footer',
      })
    },
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

vi.mock('../pages/base', async () => {
  const React = await import('react')

  return {
    BaseLoading: () => React.createElement('div', null, 'Loading'),
    NotFoundPage: () => React.createElement('div', {'data-testid': 'not-found'}, 'Not Found'),
  }
})

vi.mock('../pages/document-placeholder', async () => {
  const React = await import('react')

  return {
    DocumentPlaceholder: () => React.createElement('div', null, 'Document Placeholder'),
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
    mockState.footerProps = null
    mockState.ipcSend.mockReset()
    mockState.providers = []
    mockState.providersStatus = 'success'
    ;(window as any).initNavState = {
      assistantOpen: true,
      assistantSessionId: 'session-1',
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
    delete (window as any).initNavState
  })

  it('hides assistant controls when no providers are configured', async () => {
    const {container, root} = renderMain()

    await flushEffects()

    expect(mockState.footerProps?.onNewAssistantChat).toBeUndefined()
    expect(mockState.footerProps?.onToggleAssistant).toBeUndefined()
    expect(container.querySelector('[data-testid="assistant-panel"]')).toBeNull()
    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })

    cleanupRendered(root, container)
  })

  it('shows assistant controls when at least one provider is configured', async () => {
    mockState.providers = [{id: 'provider-1', label: 'OpenAI', model: 'gpt-5'}]
    mockState.providersStatus = 'success'

    const {container, root} = renderMain()

    await flushEffects()

    expect(typeof mockState.footerProps?.onNewAssistantChat).toBe('function')
    expect(typeof mockState.footerProps?.onToggleAssistant).toBe('function')
    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.ipcSend).not.toHaveBeenCalled()

    cleanupRendered(root, container)
  })

  it('opens the assistant panel and requests a new chat from the footer action', async () => {
    mockState.providers = [{id: 'provider-1', label: 'OpenAI', model: 'gpt-5'}]
    mockState.providersStatus = 'success'
    ;(window as any).initNavState = {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    }

    const {container, root} = renderMain()

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).toBeNull()

    act(() => {
      ;(mockState.footerProps?.onNewAssistantChat as undefined | (() => void))?.()
    })

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.assistantPanelProps?.newChatRequest).toBe(1)
    expect(mockState.ipcSend).toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: true,
      assistantSessionId: 'session-1',
    })

    cleanupRendered(root, container)
  })

  it('keeps the saved assistant state while providers are still loading', async () => {
    mockState.providers = undefined
    mockState.providersStatus = 'pending'

    const {container, root} = renderMain()

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.ipcSend).not.toHaveBeenCalledWith('windowAssistantState', {
      assistantOpen: false,
      assistantSessionId: 'session-1',
    })

    mockState.providers = [{id: 'provider-1', label: 'OpenAI', model: 'gpt-5'}]
    mockState.providersStatus = 'success'

    act(() => {
      root.render(renderMainTree())
    })

    await flushEffects()

    expect(container.querySelector('[data-testid="assistant-panel"]')).not.toBeNull()
    expect(mockState.assistantPanelProps?.initialSessionId).toBe('session-1')

    cleanupRendered(root, container)
  })
})
