import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Guards the dialog-primitive pairing in the assistant sidebar.
 *
 * `useAppDialog(Content, {isAlert: true})` mounts `Content` inside a Radix `AlertDialog` root.
 * Mixing the dialog families throws at render ("`AlertDialogTitle` must be used within
 * `AlertDialog`") — a runtime failure TypeScript cannot catch, because both title components have
 * identical prop types. This mounts the dialog in the root its call site actually uses.
 */

vi.mock('@/models/agents', () => ({
  LOCAL_AGENT_SERVER_LABEL: 'Local Agents',
  isLocalAgentServer: () => false,
  describeAgentServer: (serverUrl: string) => new URL(serverUrl).host,
  addOptimisticSessionMessage: vi.fn(),
  removeOptimisticSessionFromLists: vi.fn(),
  useAgentLists: () => [],
  useAgentServerUrls: () => ({data: [], isSuccess: true, isLoading: false}),
  useAgentSession: () => ({data: undefined}),
  useAgentWebSocketSubscription: () => ({text: ''}),
  useAllAgentSessions: () => ({entries: [], isLoading: false, isError: false}),
  useCreateAgentSessionOnServer: () => ({mutateAsync: vi.fn()}),
  useDeleteAgentSession: () => ({mutate: vi.fn()}),
  useLocalAgentServerUrl: () => ({data: null}),
  useMessageAgentSession: () => ({mutate: vi.fn()}),
  useStopAgentSession: () => ({mutate: vi.fn()}),
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => 'account-1',
}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => vi.fn()}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: undefined})}))
// The real create dialog drags in the prompt-editor stack, which does not load under jsdom.
vi.mock('@/pages/agents/dialogs', () => ({CreateAgentDialog: () => null}))
// Same for the shared rich composer (ProseMirror editor stack); never rendered by these dialogs.
vi.mock('@/pages/agents/rich-message-composer', () => ({
  AgentRichMessageComposer: () => null,
  SUB_SESSION_DRIVEN_MESSAGE: '',
  TERMINAL_RUN_STATUSES: new Set(),
}))

// The panel module transitively reaches the Electron tRPC/gRPC clients, which cannot initialize
// outside the app shell. These dialogs never call them.
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))

vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'library'}),
    useNavigation: () => ({state: {}, dispatch: vi.fn()}),
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

import {AlertDialog, AlertDialogContent, AlertDialogPortal} from '@shm/ui/components/alert-dialog'
import {DeleteSessionDialog} from '../components/assistant-panel'

function renderInRoot(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('assistant sidebar dialogs', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the delete confirmation inside an AlertDialog root', () => {
    const {container, root} = renderInRoot(
      <AlertDialog open>
        <AlertDialogPortal>
          <AlertDialogContent>
            <DeleteSessionDialog onClose={vi.fn()} input={{sessionTitle: 'Notes', onConfirm: vi.fn()}} />
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>,
    )

    expect(document.body.textContent).toContain('Delete Chat')
    expect(document.body.textContent).toContain('Notes')

    cleanupRendered(root, container)
  })

  it('confirms before deleting and closes after', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const {container, root} = renderInRoot(
      <AlertDialog open>
        <AlertDialogPortal>
          <AlertDialogContent>
            <DeleteSessionDialog onClose={onClose} input={{onConfirm}} />
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>,
    )

    const deleteButton = Array.from(document.body.querySelectorAll('button')).find(
      (element) => element.textContent === 'Delete',
    )
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    cleanupRendered(root, container)
  })
})
