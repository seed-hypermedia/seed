// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared'
import {AgentServerError} from '../agents/client'
import MountedAgentDocument from '../agents/document'
import {setAgentsPlatform} from '../agents/platform'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useAgentDetail = vi.fn()
vi.mock('../agents/models', () => ({useAgentDetail: (...args: unknown[]) => useAgentDetail(...args)}))
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

  it('tells a signed-in visitor the agent is not shared with their account on a 404', () => {
    useAgentDetail.mockReturnValue({
      data: undefined,
      error: new AgentServerError('Agent not found', 404),
      isError: true,
      isInitialLoading: false,
      refetch: vi.fn(),
    })
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('This agent is not shared with your account')
    expect(text).toContain('localhost:3051')
    expect(text).toContain('z6MkVisitor')
    expect(text).toContain('Agent access tab')
    expect(text).toContain('orphaned or deleted')
    expect(text).not.toContain('No agent is registered')
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
