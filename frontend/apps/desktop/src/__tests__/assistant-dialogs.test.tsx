import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Guards the dialog-primitive pairing in the assistant sidebar.
 *
 * `useAppDialog(Content)` mounts `Content` inside a Radix `Dialog` root, and
 * `useAppDialog(Content, {isAlert: true})` inside an `AlertDialog` root. Mixing the families throws
 * at render ("`DialogTitle` must be used within `Dialog`") — a runtime failure TypeScript cannot
 * catch, because both title components have identical prop types. These tests mount each dialog in
 * the root its call site actually uses.
 */

const mockState = vi.hoisted(() => ({
  serverUrls: ['http://localhost:3050'] as string[],
  localServerUrl: 'http://localhost:3050' as string | null,
  agentLists: [] as Array<{data?: Array<{id: string; definition: {name: string; model: string}}>; isLoading: boolean}>,
  createSessionMutateAsync: vi.fn(),
}))

vi.mock('@/models/agents', () => ({
  // Pure helpers keep their real behavior so the rendered server labels are the real ones.
  LOCAL_AGENT_SERVER_LABEL: 'Local Agents',
  isLocalAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    !!localServerUrl && serverUrl === localServerUrl,
  describeAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    localServerUrl && serverUrl === localServerUrl ? 'Local Agents' : new URL(serverUrl).host,
  useAgentServerUrls: () => ({data: mockState.serverUrls, isSuccess: true, isLoading: false}),
  useLocalAgentServerUrl: () => ({data: mockState.localServerUrl}),
  useAgentLists: () => mockState.agentLists,
  useCreateAgentSessionOnServer: () => ({mutateAsync: mockState.createSessionMutateAsync}),
  // Unused by these dialogs but imported by the module under test.
  addOptimisticSessionMessage: vi.fn(),
  useAgentSession: () => ({data: undefined}),
  useAgentWebSocketSubscription: () => ({text: ''}),
  useAllAgentSessions: () => ({entries: [], isLoading: false, isError: false}),
  useDeleteAgentSession: () => ({mutate: vi.fn()}),
  useMessageAgentSession: () => ({mutate: vi.fn()}),
  useStopAgentSession: () => ({mutate: vi.fn()}),
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccountId: () => 'account-1',
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
import {Dialog, DialogContent, DialogPortal} from '@shm/ui/components/dialog'
import {DeleteSessionDialog, NewAssistantSessionDialog} from '../components/assistant-panel'

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
    mockState.serverUrls = ['http://localhost:3050']
    mockState.localServerUrl = 'http://localhost:3050'
    mockState.agentLists = [{data: [{id: 'agent-1', definition: {name: 'Research', model: 'gpt-5'}}], isLoading: false}]
    mockState.createSessionMutateAsync.mockReset()
    mockState.createSessionMutateAsync.mockResolvedValue({_: 'CreateSessionResponse', sessionId: 'session-9'})
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the new-chat picker inside a plain Dialog root', () => {
    // Regression: this threw "`DialogTitle` must be used within `Dialog`" when the content used
    // alert-dialog primitives while useAppDialog mounted it in a Dialog root.
    const {container, root} = renderInRoot(
      <Dialog open>
        <DialogPortal>
          <DialogContent>
            <NewAssistantSessionDialog onClose={vi.fn()} input={{onCreated: vi.fn()}} />
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    expect(document.body.textContent).toContain('New chat')
    expect(document.body.textContent).toContain('Choose an agent to talk to.')

    cleanupRendered(root, container)
  })

  it('lets the user pick which agent to start a chat with', async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const {container, root} = renderInRoot(
      <Dialog open>
        <DialogPortal>
          <DialogContent>
            <NewAssistantSessionDialog onClose={onClose} input={{onCreated}} />
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    // The agent is listed with its model, grouped under its server.
    expect(document.body.textContent).toContain('Research')
    expect(document.body.textContent).toContain('gpt-5')
    expect(document.body.textContent).toContain('Local Agents')

    const agentButton = Array.from(document.body.querySelectorAll('button')).find(
      (element) => element.textContent?.includes('Research'),
    )
    await act(async () => {
      agentButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(mockState.createSessionMutateAsync).toHaveBeenCalledWith({
      serverUrl: 'http://localhost:3050',
      agentId: 'agent-1',
      title: 'New chat',
    })
    expect(onCreated).toHaveBeenCalledWith({serverUrl: 'http://localhost:3050', sessionId: 'session-9'})

    cleanupRendered(root, container)
  })

  it('explains what to do when no agents exist yet', () => {
    mockState.agentLists = [{data: [], isLoading: false}]

    const {container, root} = renderInRoot(
      <Dialog open>
        <DialogPortal>
          <DialogContent>
            <NewAssistantSessionDialog onClose={vi.fn()} input={{onCreated: vi.fn()}} />
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    expect(document.body.textContent).toContain('No agents available yet')

    cleanupRendered(root, container)
  })

  it('surfaces a failure to start the chat instead of closing silently', async () => {
    mockState.createSessionMutateAsync.mockRejectedValue(new Error('server unreachable'))
    const onClose = vi.fn()

    const {container, root} = renderInRoot(
      <Dialog open>
        <DialogPortal>
          <DialogContent>
            <NewAssistantSessionDialog onClose={onClose} input={{onCreated: vi.fn()}} />
          </DialogContent>
        </DialogPortal>
      </Dialog>,
    )

    const agentButton = Array.from(document.body.querySelectorAll('button')).find(
      (element) => element.textContent?.includes('Research'),
    )
    await act(async () => {
      agentButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('server unreachable')
    expect(onClose).not.toHaveBeenCalled()

    cleanupRendered(root, container)
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
})
