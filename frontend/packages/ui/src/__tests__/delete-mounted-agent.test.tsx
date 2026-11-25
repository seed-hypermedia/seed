// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const mockState = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_agentId: string) => ({})),
  lastArgs: [] as unknown[],
}))

vi.mock('../agents/models', () => ({
  useDeleteAgent: (...args: unknown[]) => {
    mockState.lastArgs = args
    return {mutateAsync: mockState.mutateAsync}
  },
}))

import {AgentServerError} from '../agents/client'
import {mountedAgentServerUrl, useMountedAgentDeletion} from '../agents/delete-mounted-agent'

/** Renders the hook once and hands back its latest value. */
function renderHook<T>(useHook: () => T): {current: T} {
  const result = {current: undefined as T}
  function Probe() {
    result.current = useHook()
    return null
  }
  const container = document.createElement('div')
  act(() => createRoot(container).render(<Probe />))
  return result
}

const SERVER = 'https://agents.example'
const agentMetadata = {name: 'Helper', type: 'hm://hyper.media/agent', agentServerUrl: SERVER} as any

describe('mountedAgentServerUrl', () => {
  it('names the server only for an agent-typed document with a mountable server address', () => {
    expect(mountedAgentServerUrl(agentMetadata)).toBe(SERVER)
    expect(mountedAgentServerUrl({name: 'Doc'} as any)).toBeUndefined()
    expect(mountedAgentServerUrl({name: 'Doc', agentServerUrl: SERVER} as any)).toBeUndefined()
    expect(mountedAgentServerUrl({...agentMetadata, agentServerUrl: 'not a url'})).toBeUndefined()
    expect(mountedAgentServerUrl(undefined)).toBeUndefined()
  })
})

describe('useMountedAgentDeletion', () => {
  const id = hmId('z6MkSpace', {path: ['helper'], version: 'v1'})

  it('deletes the agent at the versionless document id, signed by the given account', async () => {
    mockState.mutateAsync.mockClear()
    const result = renderHook(() => useMountedAgentDeletion(id, agentMetadata, 'z6MkAlice'))
    expect(result.current.isAgent).toBe(true)
    expect(mockState.lastArgs).toEqual([SERVER, 'z6MkAlice'])
    await result.current.deleteAgent()
    expect(mockState.mutateAsync).toHaveBeenCalledWith('hm://z6MkSpace/helper')
  })

  it('does nothing for a document that is not an agent', async () => {
    mockState.mutateAsync.mockClear()
    const result = renderHook(() => useMountedAgentDeletion(id, {name: 'Doc'} as any, 'z6MkAlice'))
    expect(result.current.isAgent).toBe(false)
    await result.current.deleteAgent()
    expect(mockState.mutateAsync).not.toHaveBeenCalled()
  })

  it('tolerates an agent the server has already lost, but surfaces other failures', async () => {
    mockState.mutateAsync.mockRejectedValueOnce(new AgentServerError('gone', 404))
    const result = renderHook(() => useMountedAgentDeletion(id, agentMetadata, 'z6MkAlice'))
    await expect(result.current.deleteAgent()).resolves.toBeUndefined()
    mockState.mutateAsync.mockRejectedValueOnce(new AgentServerError('nope', 403))
    await expect(result.current.deleteAgent()).rejects.toThrow('nope')
  })
})
