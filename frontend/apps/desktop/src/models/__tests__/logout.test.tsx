import {registerQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {useLogout} from '../daemon'

const {disconnectVault, logoutHosting} = vi.hoisted(() => ({
  disconnectVault: vi.fn(),
  logoutHosting: vi.fn(),
}))

vi.mock('@/grpc-client', () => ({grpcClient: {daemon: {disconnectVault}}}))
vi.mock('@/trpc', () => ({client: {host: {logout: {mutate: logoutHosting}}}}))
vi.mock('@shm/shared/models/entity', () => ({useResources: vi.fn()}))

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

const loggedOutHostState = {authVersion: 2, email: null, sessionToken: null, pendingSessionToken: null}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return {promise, resolve, reject}
}

describe('useLogout', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  let logout: ReturnType<typeof useLogout>
  let onSuccess: ReturnType<typeof vi.fn<() => void>>
  let onError: ReturnType<typeof vi.fn<(error: unknown, variables: void, context: unknown) => void>>

  function LogoutProbe() {
    logout = useLogout({onSuccess, onError})
    return null
  }

  beforeEach(() => {
    disconnectVault.mockReset().mockResolvedValue(undefined)
    logoutHosting.mockReset().mockResolvedValue(loggedOutHostState)
    onSuccess = vi.fn<() => void>()
    onError = vi.fn<(error: unknown, variables: void, context: unknown) => void>()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}, queries: {retry: false}}})
    registerQueryClient(queryClient)
    queryClient.setQueryData([queryKeys.HOST_STATE], {sessionToken: 'hosting-session'})
    queryClient.setQueryData(['HOST_SITES', 'hosting-session'], [{id: 'private-site'}])
    queryClient.setQueryData([queryKeys.LOCAL_ACCOUNT_ID_LIST], ['local-account'])
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LogoutProbe />
        </QueryClientProvider>,
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  test('logs out hosting and clears local vault keys and cached account data', async () => {
    await act(async () => {
      await logout.mutateAsync()
    })

    expect(disconnectVault).toHaveBeenCalledWith({clearLocalVault: true})
    expect(logoutHosting).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(queryClient.getQueryData([queryKeys.LOCAL_ACCOUNT_ID_LIST])).toEqual([])
    expect(queryClient.getQueryData(['HOST_SITES', 'hosting-session'])).toBeUndefined()
    expect(queryClient.getQueryData([queryKeys.HOST_STATE])).toEqual(loggedOutHostState)
    expect(queryClient.getQueryState([queryKeys.HOST_STATE])?.isInvalidated).toBe(true)
  })

  test.each(['hosting', 'vault'] as const)('waits for %s logout before reporting success', async (lastOperation) => {
    const host = deferred()
    const vault = deferred()
    logoutHosting.mockReturnValue(host.promise.then(() => loggedOutHostState))
    disconnectVault.mockReturnValue(vault.promise)
    let pending!: Promise<void>
    let settled = false

    await act(async () => {
      pending = logout.mutateAsync()
      pending.then(() => {
        settled = true
      })
    })
    expect(disconnectVault).toHaveBeenCalledTimes(1)
    expect(logoutHosting).toHaveBeenCalledTimes(1)

    await act(async () => {
      ;(lastOperation === 'hosting' ? vault : host).resolve()
    })
    expect(settled).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()

    await act(async () => {
      ;(lastOperation === 'hosting' ? host : vault).resolve()
      await pending
    })
    expect(settled).toBe(true)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  test.each(['hosting', 'vault'] as const)(
    'still attempts both logouts when %s logout fails',
    async (failedOperation) => {
      const failure = new Error(`${failedOperation} logout failed`)
      const remaining = deferred()
      if (failedOperation === 'hosting') {
        logoutHosting.mockRejectedValue(failure)
        disconnectVault.mockReturnValue(remaining.promise)
      } else {
        disconnectVault.mockRejectedValue(failure)
        logoutHosting.mockReturnValue(remaining.promise.then(() => loggedOutHostState))
      }
      let outcome!: Promise<unknown>
      let settled = false

      await act(async () => {
        outcome = logout.mutateAsync().catch((error: unknown) => {
          settled = true
          return error
        })
      })
      expect(logoutHosting).toHaveBeenCalledTimes(1)
      expect(disconnectVault).toHaveBeenCalledWith({clearLocalVault: true})
      expect(settled).toBe(false)
      expect(onSuccess).not.toHaveBeenCalled()

      await act(async () => {
        remaining.resolve()
        expect(await outcome).toBe(failure)
      })
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(failure, undefined, undefined)
      if (failedOperation === 'hosting') {
        expect(queryClient.getQueryData([queryKeys.LOCAL_ACCOUNT_ID_LIST])).toEqual([])
      } else {
        expect(queryClient.getQueryData([queryKeys.HOST_STATE])).toEqual(loggedOutHostState)
        expect(queryClient.getQueryData(['HOST_SITES', 'hosting-session'])).toBeUndefined()
        expect(queryClient.getQueryData([queryKeys.LOCAL_ACCOUNT_ID_LIST])).toEqual(['local-account'])
      }
    },
  )
})
