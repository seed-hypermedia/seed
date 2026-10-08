// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {registerQueryClient} from '@shm/shared/models/query-client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {logoutHosting, useHostSession, type PendingSiteMove} from './host'

vi.mock('@shm/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/constants')>()),
  SEED_HOST_URL: 'https://hosting.example',
}))
const updatePublication = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./site', () => ({updateMovedSitePublication: updatePublication}))

const storageKey = 'seed-host-v1:https://hosting.example'
const move: PendingSiteMove = {
  id: 'site-id',
  siteUid: 'space-id',
  oldName: 'old',
  newName: 'new',
  oldUrl: 'https://old.example',
  hostUrl: 'https://hosting.example',
  email: 'owner@example.test',
}
const ownedSite = {
  id: 'site-id',
  name: 'old',
  url: 'https://old.example',
  activeConfig: {registeredAccountUid: 'space-id'},
  customDomains: [],
  services: [],
}
let session: ReturnType<typeof useHostSession>
let client: QueryClient
let container: HTMLDivElement
let root: Root | undefined
let requests: {url: string; options: RequestInit}[]
let respond: (url: string, options: RequestInit) => Response | Promise<Response>
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return {promise, resolve}
}
function stored() {
  return JSON.parse(localStorage.getItem(storageKey)!)
}
function loggedIn(pendingSiteMoves: PendingSiteMove[] = []) {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      authVersion: 1,
      email: move.email,
      sessionToken: 'old-token',
      pendingDomains: [],
      pendingSiteMoves,
    }),
  )
}
function mount(includeSites = false) {
  function Consumer() {
    session = useHostSession({includeSites})
    return <span>{session.loggedIn ? session.email : 'signed-out'}</span>
  }
  root = createRoot(container)
  act(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <Consumer />
      </QueryClientProvider>,
    ),
  )
}
async function signIn(email = move.email) {
  await act(async () => {
    await session.verifyEmailCode.mutateAsync({email, binding: 'browser-binding', code: '0123'})
  })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    logger: {log() {}, warn() {}, error() {}},
  })
  registerQueryClient(client)
  requests = []
  respond = (url, options) => {
    if (url.endsWith('/auth/code/verify'))
      return json({
        status: 'success',
        sessionToken: 'new-token',
        email: JSON.parse(String(options.body)).email,
        userId: '1',
      })
    if (url.endsWith('/info')) return json({hostDomain: 'example'})
    if (url.endsWith('/sites')) return json([ownedSite])
    if (url.endsWith('/sites/site-id/domains')) return json([{hostname: 'custom.example'}])
    if (url.endsWith('/auth/logout')) return json({success: true})
    throw new Error(`Unexpected request ${url}`)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      requests.push({url, options})
      return respond(url, options)
    }),
  )
  container = document.createElement('div')
  document.body.append(container)
  updatePublication.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('persists four-digit sign-in and never adopts another service session', async () => {
  localStorage.setItem(
    'seed-host-v1:https://another-host.example',
    JSON.stringify({sessionToken: 'other-service-token'}),
  )
  mount()
  expect(session.loggedIn).toBe(false)
  await signIn()
  expect(session.loggedIn).toBe(true)
  expect(stored().sessionToken).toBe('new-token')
  expect(requests.find((request) => request.url.endsWith('/auth/code/verify'))?.options.headers).not.toHaveProperty(
    'Authorization',
  )
  await expect(
    session.verifyEmailCode.mutateAsync({email: move.email, binding: 'binding', code: '123456'}),
  ).rejects.toThrow('four-digit')
})

it('loads owned sites and custom domains using the captured bearer session', async () => {
  loggedIn()
  mount(true)
  await act(async () => {
    const result = await session.sites.refetch()
    expect(result.data?.[0]?.customDomains).toEqual(['custom.example'])
  })
  expect(requests.find((request) => request.url.endsWith('/sites'))?.options.headers).toHaveProperty(
    'Authorization',
    'Bearer old-token',
  )
})

it('clears credentials and account caches immediately while revocation is stalled', async () => {
  loggedIn([move])
  mount()
  client.setQueryData(['HOST_SITES', 'https://hosting.example', 1], [ownedSite])
  const revoke = deferred<Response>()
  respond = () => revoke.promise
  let done!: Promise<void>
  act(() => {
    done = logoutHosting()
  })
  expect(session.loggedIn).toBe(false)
  expect(stored()).toMatchObject({sessionToken: null, email: null, pendingSiteMoves: [move]})
  expect(client.getQueryData(['HOST_SITES', 'https://hosting.example', 1])).toBeUndefined()
  expect(requests.at(-1)?.options.headers).toHaveProperty('Authorization', 'Bearer old-token')
  expect(requests.at(-1)?.options.signal).toBeInstanceOf(AbortSignal)
  revoke.resolve(json({success: true}))
  await act(async () => {
    await done
  })
})

it('an in-flight verify cannot restore credentials after logout', async () => {
  mount()
  const result = deferred<Response>()
  const started = deferred<void>()
  respond = (url) => {
    if (url.endsWith('/info')) return json({})
    started.resolve()
    return result.promise
  }
  let attempt!: Promise<unknown>
  await act(async () => {
    attempt = session.verifyEmailCode
      .mutateAsync({email: move.email, binding: 'binding', code: '0123'})
      .catch((error: Error) => error)
    await started.promise
    await logoutHosting()
  })
  result.resolve(json({status: 'success', sessionToken: 'too-late', email: move.email, userId: '1'}))
  await act(async () => {
    expect(await attempt).toHaveProperty('message', 'Hosting session changed. Please sign in again.')
  })
  expect(stored().sessionToken).toBeNull()
  expect(session.loggedIn).toBe(false)
})

it('captures the auth generation when mutation is called, before React Query schedules it', async () => {
  mount()
  await act(async () => {
    const attempt = session.verifyEmailCode
      .mutateAsync({email: move.email, binding: 'binding', code: '0123'})
      .catch((error: Error) => error)
    await logoutHosting()
    expect(await attempt).toBeInstanceOf(Error)
  })
  expect(requests.some((request) => request.url.endsWith('/auth/code/verify'))).toBe(false)
  expect(session.loggedIn).toBe(false)
})

it('stores move intent before sending a rename and retains it after an ambiguous failure and logout', async () => {
  loggedIn()
  mount()
  respond = (url) => {
    if (url.endsWith('/info')) return json({})
    if (url.endsWith('/auth/logout')) return json({})
    expect(stored().pendingSiteMoves).toEqual([move])
    throw new TypeError('Connection lost')
  }
  await act(async () => {
    await expect(
      session.renameSite.mutateAsync({
        id: move.id,
        name: move.newName,
        currentName: move.oldName,
        siteUid: move.siteUid,
        currentUrl: move.oldUrl,
      }),
    ).rejects.toThrow('Connection lost')
    await logoutHosting()
  })
  expect(stored().pendingSiteMoves).toEqual([move])
  act(() => root!.unmount())
  mount()
  expect(session.pendingSiteMoves).toEqual([move])
})

it('refuses recovery for a different account or service and recognizes an already completed rename', async () => {
  loggedIn([move])
  mount()
  await expect(session.recoverSiteMove.mutateAsync({...move, email: 'other@example.test'})).rejects.toThrow(
    'account that started',
  )
  await expect(session.recoverSiteMove.mutateAsync({...move, hostUrl: 'https://elsewhere.example'})).rejects.toThrow(
    'account that started',
  )
  respond = (url) =>
    url.endsWith('/info') ? json({}) : json({...ownedSite, name: move.newName, url: 'https://new.example'})
  await act(async () => {
    expect(await session.recoverSiteMove.mutateAsync(move)).toBe('https://new.example')
  })
  expect(requests.some((request) => request.options.method === 'PATCH')).toBe(false)
  expect(stored().pendingSiteMoves).toEqual([move])
})

it('drops a rejected rename intent but keeps the account signed in', async () => {
  loggedIn()
  mount()
  respond = (url) => (url.endsWith('/info') ? json({}) : json({message: 'Address already taken'}, 409))
  await act(async () => {
    await expect(
      session.renameSite.mutateAsync({
        id: move.id,
        name: move.newName,
        currentName: move.oldName,
        siteUid: move.siteUid,
        currentUrl: move.oldUrl,
      }),
    ).rejects.toThrow('Address already taken')
  })
  expect(stored().pendingSiteMoves).toEqual([])
  expect(session.loggedIn).toBe(true)
})

it('falls back to email login without requesting gateway-owned vault credentials', async () => {
  mount()
  expect(session.canLoginWithVault).toBe(false)
  await act(async () => {
    await expect(session.loginWithVaultAsync()).rejects.toThrow('four-digit email code')
  })
  expect(requests.every((request) => request.url.endsWith('/info'))).toBe(true)
})

it('a storage logout from another tab updates the session and evicts account data', async () => {
  loggedIn()
  mount()
  client.setQueryData(['HOST_SITES', 'https://hosting.example', 1], [ownedSite])
  act(() => {
    localStorage.setItem(storageKey, JSON.stringify({...stored(), authVersion: 2, email: null, sessionToken: null}))
    window.dispatchEvent(new StorageEvent('storage', {key: storageKey}))
  })
  expect(session.loggedIn).toBe(false)
  expect(client.getQueryData(['HOST_SITES', 'https://hosting.example', 1])).toBeUndefined()
})

it('keeps failed domain publication recoverable, then clears it only after a successful retry', async () => {
  loggedIn()
  const domain = {
    id: 'domain-id',
    hostname: 'custom.example',
    siteUid: 'space-id',
    currentSiteUrl: move.oldUrl,
    email: move.email,
    status: 'waiting-dns',
  }
  localStorage.setItem(storageKey, JSON.stringify({...stored(), pendingDomains: [domain]}))
  respond = (url) => (url.endsWith('/info') ? json({}) : json({status: 'Active'}))
  updatePublication.mockRejectedValue(new Error('Signing identity unavailable'))
  mount()
  await act(async () => {
    await expect(session.retryPendingDomains()).rejects.toThrow('Signing identity unavailable')
  })
  expect(stored().pendingDomains[0]).toMatchObject({
    status: 'error',
    errorMessage: expect.stringContaining('Domain is active, but publication could not be updated'),
  })
  updatePublication.mockResolvedValue(undefined)
  await act(async () => {
    await session.retryPendingDomains()
  })
  expect(stored().pendingDomains).toEqual([])
  expect(updatePublication).toHaveBeenLastCalledWith(
    expect.objectContaining({uid: domain.siteUid}),
    domain.currentSiteUrl,
    'https://custom.example',
  )
})

it('preserves pending DNS work across logout but hides it from another hosting account', async () => {
  loggedIn()
  const domain = {
    id: 'domain-id',
    hostname: 'custom.example',
    siteUid: 'space-id',
    currentSiteUrl: move.oldUrl,
    email: move.email,
    status: 'waiting-dns',
  }
  localStorage.setItem(storageKey, JSON.stringify({...stored(), pendingDomains: [domain]}))
  const otherRequests = respond
  respond = (url, options) =>
    url.endsWith('/domains/domain-id') ? json({status: 'WaitingForDNS'}) : otherRequests(url, options)
  mount()
  await act(async () => {
    await logoutHosting()
  })
  expect(stored().pendingDomains).toEqual([domain])
  expect(session.pendingDomains).toEqual([])
  await signIn('other@example.test')
  expect(session.pendingDomains).toEqual([])
  expect(stored().pendingDomains).toEqual([domain])
  await signIn(move.email)
  expect(session.pendingDomains).toEqual([domain])
})

it('cancels a pending domain without publishing an Active response that arrives afterwards', async () => {
  loggedIn()
  const domain = {
    id: 'domain-id',
    hostname: 'custom.example',
    siteUid: 'space-id',
    currentSiteUrl: move.oldUrl,
    email: move.email,
    status: 'waiting-dns',
  }
  localStorage.setItem(storageKey, JSON.stringify({...stored(), pendingDomains: [domain]}))
  const status = deferred<Response>()
  const started = deferred<void>()
  respond = (url, options) => {
    if (url.endsWith('/info')) return json({})
    if (options.method === 'DELETE') return json({success: true})
    started.resolve()
    return status.promise
  }
  mount()
  await act(async () => {
    await started.promise
    await session.cancelPendingDomain.mutateAsync(domain.id)
    status.resolve(json({status: 'Active'}))
  })
  expect(stored().pendingDomains).toEqual([])
  expect(updatePublication).not.toHaveBeenCalled()
})

it('never restores an old login when clearing storage reuses the same numeric auth version', async () => {
  loggedIn()
  mount()
  const stale = deferred<Response>()
  const started = deferred<void>()
  const otherRequests = respond
  respond = (url, options) => {
    if (url.endsWith('/auth/code/verify') && JSON.parse(String(options.body)).binding === 'old-binding') {
      started.resolve()
      return stale.promise
    }
    return otherRequests(url, options)
  }
  let attempt!: Promise<unknown>
  await act(async () => {
    attempt = session.verifyEmailCode
      .mutateAsync({email: move.email, binding: 'old-binding', code: '0123'})
      .catch((error: Error) => error)
    await started.promise
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', {key: null}))
  })
  await signIn('new-owner@example.test')
  expect(stored().authVersion).toBe(1)
  stale.resolve(json({status: 'success', sessionToken: 'stale-token', email: move.email, userId: '1'}))
  await act(async () => {
    expect(await attempt).toBeInstanceOf(Error)
  })
  expect(stored().email).toBe('new-owner@example.test')
  expect(stored().sessionToken).toBe('new-token')
})

it('uses the managed address for domain creation while retaining the current custom publication for completion', async () => {
  loggedIn()
  const currentSiteUrl = 'https://previous-custom.example'
  const hostingSiteUrl = 'https://managed.example'
  respond = (url, options) => {
    if (url.endsWith('/info')) return json({})
    if (url.endsWith('/domains') && options.method === 'POST') {
      expect(JSON.parse(String(options.body))).toEqual({
        hostname: 'replacement.example',
        currentSiteUrl: hostingSiteUrl,
      })
      return json({hostname: 'replacement.example', domainId: 'domain-id'})
    }
    return json({status: 'WaitingForDNS'})
  }
  mount()
  await act(async () => {
    await session.createDomain.mutateAsync({
      hostname: 'replacement.example',
      currentSiteUrl,
      hostingSiteUrl,
      id: {uid: 'space-id'} as Parameters<typeof session.createDomain.mutateAsync>[0]['id'],
    })
  })
  expect(stored().pendingDomains[0]).toMatchObject({currentSiteUrl, hostingSiteUrl, hostname: 'replacement.example'})
  respond = () => json({status: 'Active'})
  await act(async () => {
    await session.retryPendingDomains()
  })
  expect(updatePublication).toHaveBeenCalledWith(
    expect.objectContaining({uid: 'space-id'}),
    currentSiteUrl,
    'https://replacement.example',
  )
})
