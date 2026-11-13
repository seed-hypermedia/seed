// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared'
import {AgentServerError} from '../agents/client'
import MountedAgentDocument from '../agents/document'
import {setAgentsPlatform} from '../agents/platform'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useAgentDetail = vi.fn<(...args: unknown[]) => unknown>()
const useAgentInvites = vi.fn<(...args: unknown[]) => unknown>(() => ({data: []}))
const acceptInvite = vi.fn()
vi.mock('../agents/models', () => ({
  useAgentDetail: (...args: unknown[]) => useAgentDetail(...args),
  useAgentInvites: (...args: unknown[]) => useAgentInvites(...args),
  useAcceptAgentInvite: () => ({mutate: acceptInvite, isLoading: false}),
}))
const detailPage = vi.fn()
vi.mock('../agents/detail', () => ({
  AgentDetailPage: (props: Record<string, unknown>) => {
    detailPage(props)
    return <div>detail page</div>
  },
}))
vi.mock('../agents/session', () => ({AgentSessionPage: () => <div>session page</div>}))
vi.mock('../agents/no-account', () => ({AgentsNoAccountPage: () => <div>sign in first</div>}))

const documentId = hmId('z6MkOwner', {path: ['silver-newt']})
const document = {
  metadata: {name: 'Silver Newt', type: 'hm://hyper.media/agent', agentServerUrl: 'http://localhost:3051'},
} as never
const route = {key: 'document', id: documentId} as never

/** The page a visitor gets on an agent's document, by what the server answered. */
describe('MountedAgentDocument access states', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
    useAgentDetail.mockReset()
    useAgentInvites.mockReset()
    useAgentInvites.mockReturnValue({data: [], refetch: vi.fn()})
    acceptInvite.mockReset()
    detailPage.mockReset()
    setAgentsPlatform({useAccountUid: () => 'z6MkVisitor'} as never)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => root.render(<MountedAgentDocument document={document} route={route} />))
  }

  it('tells a signed-in visitor the agent is not shared with their account on a 404, and keeps asking', () => {
    vi.useFakeTimers()
    const refetch = vi.fn()
    const refetchInvites = vi.fn()
    useAgentDetail.mockReturnValue({
      data: undefined,
      error: new AgentServerError('Agent not found', 404),
      isError: true,
      isInitialLoading: false,
      refetch,
    })
    useAgentInvites.mockReturnValue({data: [], refetch: refetchInvites})
    try {
      render()
      const text = container.textContent ?? ''
      expect(text).toContain('This agent is not shared with your account')
      expect(text).toContain('localhost:3051')
      expect(text).not.toContain('z6MkVisitor')
      expect(text).toContain('People tab')
      expect(text).toContain('orphaned or deleted')
      expect(text).not.toContain('No agent is registered')
      // No Retry button: the page polls until a grant or an invite changes the answer.
      expect(Array.from(container.querySelectorAll('button')).map((button) => button.textContent)).toEqual([])
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(refetch).toHaveBeenCalledTimes(1)
      expect(refetchInvites).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers to accept a pending invite on the agent instead of the no-access message', () => {
    const refetch = vi.fn()
    useAgentDetail.mockReturnValue({
      data: undefined,
      error: new AgentServerError('Agent not found', 404),
      isError: true,
      isInitialLoading: false,
      refetch,
    })
    useAgentInvites.mockReturnValue({
      data: [{agentId: documentId.id, agentName: 'Silver Newt', ownerAccountId: 'z6MkOwner', role: 'writer'}],
      refetch: vi.fn(),
    })
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('You are invited to this agent')
    expect(text).toContain('invited you as a writer')
    expect(text).not.toContain('z6MkVisitor')
    expect(text).not.toContain('not shared with your account')
    // Invites are only looked up once the server said the agent is out of reach.
    expect(useAgentInvites).toHaveBeenLastCalledWith('http://localhost:3051', 'z6MkVisitor')
    const accept = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Accept invite'),
    )!
    // The primary (green) button, not an outline one.
    expect(accept.className).toContain('bg-primary')
    act(() => accept.click())
    expect(acceptInvite).toHaveBeenCalledWith(documentId.id, expect.objectContaining({onSuccess: expect.any(Function)}))
    acceptInvite.mock.calls[0]![1].onSuccess()
    expect(refetch).toHaveBeenCalled()
  })

  it('keeps the connection message for any other error', () => {
    useAgentDetail.mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isError: true,
      isInitialLoading: false,
      refetch: vi.fn(),
    })
    render()
    expect(container.textContent).toContain('Could not verify this agent')
  })

  it('hands the document name to the embedded agent page when the agent is found', () => {
    useAgentDetail.mockReturnValue({
      data: {agent: {id: documentId.id, definition: {name: 'Old server name'}}},
      error: null,
      isError: false,
      isInitialLoading: false,
      refetch: vi.fn(),
    })
    render()
    expect(container.textContent).toContain('detail page')
    expect(detailPage).toHaveBeenCalledWith(
      expect.objectContaining({embedded: true, agentId: documentId.id, documentName: 'Silver Newt', tab: 'sessions'}),
    )
  })
})
