import {registerQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {useHostSession} from '../host'

const {getHostState, setHostState, getVaultEmailPrevalidation} = vi.hoisted(() => ({
  getHostState: vi.fn(),
  setHostState: vi.fn(),
  getVaultEmailPrevalidation: vi.fn(),
}))

vi.mock('@/trpc', () => ({client: {host: {get: {query: getHostState}, set: {mutate: setHostState}}}}))
vi.mock('@/grpc-client', () => ({grpcClient: {daemon: {getVaultEmailPrevalidation}}}))
vi.mock('@shm/shared', async () => {
  const {invalidateQueries} = await import('@shm/shared/models/query-client')
  return {invalidateQueries}
})

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

const loggedOutState = {authVersion: 0, email: null, sessionToken: null, pendingSessionToken: null}
const changedSession = new Error('Hosting session changed. Please sign in again.')

describe('hosting login interrupted by logout', () => {
  let root: Root
  let container: HTMLDivElement
  let queryClient: QueryClient
  let host: ReturnType<typeof useHostSession>
  let finishLogin: (response: Response) => void
  let currentState: typeof loggedOutState
  let onAuthenticated: ReturnType<typeof vi.fn<() => void>>

  function HostingProbe() {
    host = useHostSession({onAuthenticated})
    return null
  }

  function render() {
    root.render(
      <QueryClientProvider client={queryClient}>
        <HostingProbe />
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    currentState = {...loggedOutState}
    onAuthenticated = vi.fn<() => void>()
    getHostState.mockReset().mockImplementation(async () => currentState)
    setHostState.mockReset().mockImplementation(async (input: {expectedAuthVersion?: number}) => {
      if (input.expectedAuthVersion !== currentState.authVersion) throw changedSession
    })
    getVaultEmailPrevalidation.mockReset().mockResolvedValue({
      email: 'owner@example.com',
      signer: new Uint8Array([1]),
      host: 'vault.example.com',
      sig: new Uint8Array([2]),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const loginResponse = new Promise<Response>((resolve) => {
      finishLogin = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/api/info')) return Promise.resolve({ok: true, json: async () => ({})})
        return loginResponse
      }),
    )
    queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Infinity}, mutations: {retry: false}},
    })
    registerQueryClient(queryClient)
    queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(render)
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test.each(['email code', 'vault'] as const)(
    'rejects a late %s login after the logout state rerenders',
    async (method) => {
      let outcome!: Promise<unknown>
      await act(async () => {
        if (method === 'email code') {
          outcome = host.verifyEmailCode
            .mutateAsync({email: 'owner@example.com', binding: 'binding', code: '1234'})
            .catch((error: unknown) => error)
        } else {
          outcome = new Promise((resolve) => {
            host.loginWithVault(undefined, {onSuccess: () => resolve(undefined), onError: resolve})
          })
        }
      })
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(method === 'email code' ? '/auth/code/verify' : '/auth/vault'),
        expect.objectContaining({method: 'POST'}),
      )

      // Logout updates the cache while the login HTTP request remains in flight.
      // Force a normal rerender so React Query updates every mutation observer's
      // options; the old response must retain its original auth generation.
      currentState = {...loggedOutState, authVersion: 1}
      await act(async () => {
        queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
        render()
      })
      expect(host.loggedIn).toBe(false)

      await act(async () => {
        finishLogin({
          ok: true,
          json: async () => ({
            status: 'success',
            email: 'owner@example.com',
            sessionToken: 'late-token',
            userId: 'owner',
          }),
        } as Response)
        expect(await outcome).toBe(changedSession)
      })
      expect(setHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionToken: 'late-token',
          expectedAuthVersion: 0,
        }),
      )
      expect(onAuthenticated).not.toHaveBeenCalled()
      expect(queryClient.getQueryData([queryKeys.HOST_STATE])).toEqual(currentState)
    },
  )
})
