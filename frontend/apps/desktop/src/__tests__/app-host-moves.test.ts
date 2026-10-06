import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
vi.mock('@shm/shared', () => ({hmId: vi.fn(), queryKeys: {}}))
const store = vi.hoisted(() => ({data: {} as Record<string, any>}))
vi.mock('../app-store.mts', () => ({
  appStore: {
    get: (key: string) => store.data[key],
    set: (key: string, value: unknown) => {
      store.data[key] = value
    },
  },
}))
vi.mock('../app-grpc', () => ({grpcClient: {}}))
vi.mock('../app-client', () => ({seedClient: {}, getSigner: vi.fn()}))
vi.mock('../app-invalidation', () => ({appInvalidateQueries: vi.fn()}))
async function caller() {
  return (await import('../app-host')).hostApi.createCaller({})
}
const move = {
  id: 'host-site',
  siteUid: 'space',
  oldName: 'old',
  newName: 'new',
  oldUrl: 'https://old.hyper.media',
  hostUrl: 'https://hosting.hyper.media',
  email: 'owner@example.com',
}

describe('durable site move recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    store.data = {}
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true}))
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it('survives module reload and authentication changes until explicitly completed', async () => {
    const first = await caller()
    await first.setPendingSiteMove(move)
    vi.resetModules()
    const reopened = await caller()
    expect((await reopened.get()).pendingSiteMoves).toEqual([move])
    await reopened.set({email: null, sessionToken: null, pendingSessionToken: null, expectedAuthVersion: 0})
    expect((await reopened.get()).pendingSiteMoves).toEqual([move])
    await reopened.clearPendingSiteMove({id: move.id, hostUrl: move.hostUrl})
    expect((await reopened.get()).pendingSiteMoves).toEqual([])
  })
  it('updates one move without discarding recovery for another service', async () => {
    const host = await caller()
    await host.setPendingSiteMove(move)
    await host.setPendingSiteMove({...move, hostUrl: 'http://localhost:5555'})
    await expect(host.setPendingSiteMove({...move, newName: 'newer'})).rejects.toThrow(
      'Finish the pending address change',
    )
    await host.setPendingSiteMove(move)
    expect((await host.get()).pendingSiteMoves).toHaveLength(2)
    await host.clearPendingSiteMove({id: move.id, hostUrl: move.hostUrl})
    expect((await host.get()).pendingSiteMoves).toEqual([{...move, hostUrl: 'http://localhost:5555'}])
  })
})

describe('hosting logout', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    store.data = {
      'Host-v001': {
        email: 'owner@example.com',
        sessionToken: 'active-token',
        pendingSessionToken: 'pending-token',
        pendingDomains: [],
        pendingSiteMoves: [move],
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true}))
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('clears saved credentials before revocation completes and keeps move recovery across restart', async () => {
    let finishRevocation!: (value: unknown) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        finishRevocation = resolve as any
      }),
    )
    const host = await caller()
    const logout = host.logout()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(store.data['Host-v001']).toEqual({
      authVersion: 1,
      email: null,
      sessionToken: null,
      pendingSessionToken: null,
      pendingSiteMoves: [move],
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: {Authorization: 'Bearer active-token'},
      }),
    )
    finishRevocation({ok: true})
    await logout
    vi.resetModules()
    expect(await (await caller()).get()).toEqual(store.data['Host-v001'])
  })

  it('stays logged out when remote revocation is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    const host = await caller()
    await host.logout()
    expect(await host.get()).toMatchObject({email: null, sessionToken: null, pendingSessionToken: null})
  })

  it('rejects an in-flight login or account update captured before logout', async () => {
    const host = await caller()
    const oldState = await host.get()
    await host.logout()
    await expect(
      host.set({...oldState, sessionToken: 'late-token', expectedAuthVersion: oldState.authVersion}),
    ).rejects.toThrow('Hosting session changed')
    expect((await host.get()).sessionToken).toBeNull()
    await host.set({
      email: 'new@example.com',
      sessionToken: 'new-token',
      pendingSessionToken: null,
      expectedAuthVersion: 1,
    })
    expect((await host.get()).sessionToken).toBe('new-token')
  })

  it('can log out again without sending a request with missing credentials', async () => {
    const host = await caller()
    await host.logout()
    vi.mocked(fetch).mockClear()
    await host.logout()
    expect(fetch).not.toHaveBeenCalled()
    expect((await host.get()).sessionToken).toBeNull()
  })
})
