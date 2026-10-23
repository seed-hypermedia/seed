import {registerQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {useHostSession} from '../host'

const {getHostState, setHostState, expireSession, getVaultEmailPrevalidation} = vi.hoisted(() => ({
  getHostState: vi.fn(),
  setHostState: vi.fn(),
  expireSession: vi.fn(),
  getVaultEmailPrevalidation: vi.fn(),
}))

vi.mock('@/trpc', () => ({
  client: {
    host: {get: {query: getHostState}, set: {mutate: setHostState}, expireSession: {mutate: expireSession}},
  },
}))
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
  let currentState: {authVersion: number; email: string | null; sessionToken: string | null; pendingSessionToken: null}
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
    expireSession.mockReset().mockImplementation(async ({sessionToken}: {sessionToken: string}) => {
      if (sessionToken === currentState.sessionToken) {
        currentState = {...currentState, authVersion: currentState.authVersion + 1, sessionToken: null}
      }
      return currentState
    })
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

  test.each([false, true])(
    'a site creation 401 expires only its rejected session (new login: %s)',
    async (newLogin) => {
      currentState = {...loggedOutState, email: 'owner@example.com', sessionToken: 'rejected-token'}
      await act(async () => {
        queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
        render()
      })
      let outcome!: Promise<unknown>
      await act(async () => {
        outcome = host.createSite.mutateAsync({subdomain: 'my-space'}).catch((error: unknown) => error)
      })
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sites'),
        expect.objectContaining({headers: expect.objectContaining({Authorization: 'Bearer rejected-token'})}),
      )
      if (newLogin) {
        currentState = {...currentState, sessionToken: 'fresh-token'}
        await act(async () => {
          queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
          render()
        })
      }
      await act(async () => {
        finishLogin(new Response(JSON.stringify({error: 'Invalid authorization'}), {status: 401}))
        expect(await outcome).toMatchObject({message: 'Invalid authorization', status: 401})
      })
      await vi.waitFor(() => expect(host.loggedIn).toBe(newLogin))
      expect(expireSession).toHaveBeenCalledWith({sessionToken: 'rejected-token'})
      expect(queryClient.getQueryData([queryKeys.HOST_STATE])).toMatchObject({
        sessionToken: newLogin ? 'fresh-token' : null,
      })
    },
  )

  test.each([
    [409, {message: 'Subdomain is already registered'}, 'Subdomain is already registered'],
    [503, null, 'Hosting request failed (503)'],
  ])('surfaces a %s failure without expiring the hosting session', async (status, body, message) => {
    currentState = {...loggedOutState, email: 'owner@example.com', sessionToken: 'active-token'}
    await act(async () => {
      queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
      render()
    })
    let outcome!: Promise<unknown>
    await act(async () => {
      outcome = host.createSite.mutateAsync({subdomain: 'my-space'}).catch((error: unknown) => error)
      finishLogin(
        new Response(body === null ? 'Service unavailable' : JSON.stringify(body), {status: status as number}),
      )
      expect(await outcome).toMatchObject({message, status})
    })
    expect(expireSession).not.toHaveBeenCalled()
    expect(host.loggedIn).toBe(true)
  })

  test('a delayed expiration reply cannot overwrite a fresh renderer login', async () => {
    currentState = {...loggedOutState, email: 'owner@example.com', sessionToken: 'rejected-token'}
    await act(async () => {
      queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
      render()
    })
    let finishExpiration!: (state: typeof currentState) => void
    expireSession.mockImplementation(() => new Promise((resolve) => (finishExpiration = resolve)))
    let outcome!: Promise<unknown>
    await act(async () => {
      outcome = host.createSite.mutateAsync({subdomain: 'my-space'}).catch((error: unknown) => error)
      finishLogin(new Response(JSON.stringify({error: 'Invalid authorization'}), {status: 401}))
    })
    await vi.waitFor(() => expect(expireSession).toHaveBeenCalled())
    currentState = {...currentState, authVersion: 1, sessionToken: 'fresh-token'}
    await act(async () => {
      queryClient.setQueryData([queryKeys.HOST_STATE], currentState)
      render()
      finishExpiration({...currentState, sessionToken: null})
      await outcome
    })
    expect(queryClient.getQueryData([queryKeys.HOST_STATE])).toMatchObject({sessionToken: 'fresh-token'})
    expect(host.loggedIn).toBe(true)
  })
})
