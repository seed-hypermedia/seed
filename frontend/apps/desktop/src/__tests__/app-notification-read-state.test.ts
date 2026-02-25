import {base58btc} from 'multiformats/bases/base58'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const storeData: Record<string, any> = {}

const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

const signDataMock = vi.fn(async () => ({
  signature: new Uint8Array([1, 2, 3, 4]),
}))

vi.mock('../app-store.mts', () => ({
  appStore: appStoreMock,
}))

vi.mock('../app-grpc', () => ({
  grpcClient: {
    daemon: {
      signData: signDataMock,
    },
  },
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

function jsonResponse(body: any, status: number = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json'},
    }),
  )
}

async function loadCaller() {
  const mod = await import('../app-notification-read-state')
  return mod.notificationReadApi.createCaller({})
}

describe('app notification read state', () => {
  const accountUid = base58btc.encode(new Uint8Array([1, 2, 3, 4, 5]))
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
    signDataMock.mockResolvedValue({signature: new Uint8Array([1, 2, 3, 4])})
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('marks events as read and prunes when mark-all advances', async () => {
    const caller = await loadCaller()

    const initial = await caller.getLocalState(accountUid)
    expect(initial.markAllReadAtMs).toBe(1000)

    await caller.markEventRead({
      accountUid,
      eventId: 'event-1',
      eventAtMs: 1100,
    })

    const afterEventRead = await caller.getLocalState(accountUid)
    expect(afterEventRead.readEvents).toEqual([{eventId: 'event-1', eventAtMs: 1100}])
    expect(afterEventRead.dirty).toBe(true)

    await caller.markAllRead({
      accountUid,
      markAllReadAtMs: 1200,
    })

    const afterMarkAll = await caller.getLocalState(accountUid)
    expect(afterMarkAll.markAllReadAtMs).toBe(1200)
    expect(afterMarkAll.readEvents).toEqual([])
  })

  it('merges local and remote state with LWW and remains idempotent', async () => {
    const caller = await loadCaller()

    await caller.getLocalState(accountUid)
    await caller.markEventRead({
      accountUid,
      eventId: 'local-event',
      eventAtMs: 1300,
    })

    // Remote has a remote-event and higher watermark, but local's
    // stateUpdatedAtMs is newer (markEventRead bumped it), so
    // local's readEvents are authoritative. remote-event above local
    // watermark and not in local readEvents → skipped (LWW).
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          stateUpdatedAtMs: 900,
          readEvents: [{eventId: 'remote-event', eventAtMs: 1400}],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          stateUpdatedAtMs: 1000,
          readEvents: [{eventId: 'local-event', eventAtMs: 1300}],
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      )

    const firstSync = await caller.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })
    expect(firstSync.dirty).toBe(false)

    const stateAfterFirstSync = await caller.getLocalState(accountUid)
    expect(stateAfterFirstSync.markAllReadAtMs).toBe(1200)
    // Only local-event survives; remote-event was skipped by LWW
    expect(stateAfterFirstSync.readEvents).toEqual([{eventId: 'local-event', eventAtMs: 1300}])

    // Second sync is idempotent
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          stateUpdatedAtMs: 1000,
          readEvents: [{eventId: 'local-event', eventAtMs: 1300}],
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          stateUpdatedAtMs: 1000,
          readEvents: [{eventId: 'local-event', eventAtMs: 1300}],
          updatedAt: '2026-01-01T00:00:03.000Z',
        }),
      )

    await caller.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    const stateAfterSecondSync = await caller.getLocalState(accountUid)
    expect(stateAfterSecondSync).toMatchObject(stateAfterFirstSync)
  })

  it('merges remote readEvents when remote is newer', async () => {
    const caller = await loadCaller()

    // Create account state at T=100
    vi.setSystemTime(new Date(100))
    await caller.getLocalState(accountUid)

    // Remote has newer stateUpdatedAtMs (200 > 100), so remote readEvents
    // are merged in (local is NOT authoritative)
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1000,
          stateUpdatedAtMs: 200,
          readEvents: [{eventId: 'remote-event', eventAtMs: 1400}],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1000,
          stateUpdatedAtMs: 200,
          readEvents: [{eventId: 'remote-event', eventAtMs: 1400}],
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      )

    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    const state = await caller.getLocalState(accountUid)
    expect(state.readEvents).toEqual([{eventId: 'remote-event', eventAtMs: 1400}])
  })

  it('keeps local mutations offline and retries sync later', async () => {
    const caller = await loadCaller()

    await caller.getLocalState(accountUid)
    await caller.markEventRead({
      accountUid,
      eventId: 'offline-event',
      eventAtMs: 1500,
    })

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await caller.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    const failedStatus = await caller.getSyncStatus(accountUid)
    expect(failedStatus.dirty).toBe(true)
    expect(failedStatus.lastSyncError).toContain('You are not connected')

    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1000,
          stateUpdatedAtMs: 1000,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:04.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1000,
          stateUpdatedAtMs: 1000,
          readEvents: [{eventId: 'offline-event', eventAtMs: 1500}],
          updatedAt: '2026-01-01T00:00:05.000Z',
        }),
      )

    await caller.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    const successStatus = await caller.getSyncStatus(accountUid)
    expect(successStatus.dirty).toBe(false)
    expect(successStatus.lastSyncError).toBeNull()
  })

  it('mark-unread does not revert other unreads (local only, no sync)', async () => {
    const caller = await loadCaller()

    // Start with watermark at 5000 covering events A@3000, B@2000, C@1000
    await caller.markAllRead({accountUid, markAllReadAtMs: 5000})

    // Mark B@2000 as unread → lowers watermark to 1999, A@3000 added to readEvents
    await caller.markEventUnread({
      accountUid,
      eventId: 'B',
      eventAtMs: 2000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
        {eventId: 'C', eventAtMs: 1000},
      ],
    })

    const afterB = await caller.getLocalState(accountUid)
    expect(afterB.markAllReadAtMs).toBe(1999)
    expect(afterB.readEvents).toEqual([{eventId: 'A', eventAtMs: 3000}])

    // Mark A@3000 as unread → above watermark, just remove from readEvents
    await caller.markEventUnread({
      accountUid,
      eventId: 'A',
      eventAtMs: 3000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
        {eventId: 'C', eventAtMs: 1000},
      ],
    })

    const afterA = await caller.getLocalState(accountUid)
    expect(afterA.markAllReadAtMs).toBe(1999)
    expect(afterA.readEvents).toEqual([])
    // A is unread (3000 > 1999), B is unread (2000 > 1999), C is read (1000 <= 1999)
  })

  it('mark-unread survives a sync cycle without reverting', async () => {
    const caller = await loadCaller()

    // Start with watermark at 5000
    vi.setSystemTime(new Date(100))
    await caller.markAllRead({accountUid, markAllReadAtMs: 5000})

    // Sync to establish server state
    vi.setSystemTime(new Date(200))
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      )
    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    // Mark B@2000 as unread → watermark lowers to 1999, A@3000 gets individual readEvent
    vi.setSystemTime(new Date(300))
    await caller.markEventUnread({
      accountUid,
      eventId: 'B',
      eventAtMs: 2000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
      ],
    })

    // Sync #1: uploads lowered watermark and A in readEvents
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 300,
          readEvents: [{eventId: 'A', eventAtMs: 3000}],
          updatedAt: '2026-01-01T00:00:03.000Z',
        }),
      )
    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    const afterSync1 = await caller.getLocalState(accountUid)
    expect(afterSync1.markAllReadAtMs).toBe(1999)
    expect(afterSync1.readEvents).toEqual([{eventId: 'A', eventAtMs: 3000}])

    // Now mark A@3000 as unread → above watermark, remove from readEvents
    vi.setSystemTime(new Date(400))
    await caller.markEventUnread({
      accountUid,
      eventId: 'A',
      eventAtMs: 3000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
      ],
    })

    const afterAUnread = await caller.getLocalState(accountUid)
    expect(afterAUnread.readEvents).toEqual([])

    // Sync #2: server still has A in readEvents from sync #1.
    // This must NOT re-add A to local state.
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 300,
          readEvents: [{eventId: 'A', eventAtMs: 3000}],
          updatedAt: '2026-01-01T00:00:04.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 300,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:05.000Z',
        }),
      )
    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    const afterSync2 = await caller.getLocalState(accountUid)
    expect(afterSync2.markAllReadAtMs).toBe(1999)
    // A must still be unread — sync must not re-add it
    expect(afterSync2.readEvents).toEqual([])
  })

  it('mark-unread during in-flight sync: stale POST does not pollute next sync', async () => {
    // This tests the scenario where:
    // 1. User marks B unread → A added to readEvents
    // 2. Sync starts, snapshots state with A in readEvents
    // 3. User marks A unread → A removed from readEvents locally
    // 4. Sync completes, uploads A to server (stale snapshot)
    // 5. Next sync GETs server state which has A → must NOT re-add A locally
    const caller = await loadCaller()

    vi.setSystemTime(new Date(100))
    await caller.markAllRead({accountUid, markAllReadAtMs: 5000})

    // Establish server state
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      )
    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    // Step 1: Mark B@2000 as unread
    vi.setSystemTime(new Date(200))
    await caller.markEventUnread({
      accountUid,
      eventId: 'B',
      eventAtMs: 2000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
      ],
    })
    // State: watermark=1999, readEvents={A: 3000}

    // Step 2: Start sync with deferred GET
    let resolveGet!: (v: Response) => void
    let resolvePost!: (v: Response) => void
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePost = resolve
          }),
      )

    const sync1Promise = caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    // Step 3: Mark A@3000 as unread WHILE sync is in flight
    vi.setSystemTime(new Date(300))
    await caller.markEventUnread({
      accountUid,
      eventId: 'A',
      eventAtMs: 3000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
      ],
    })
    // State: watermark=1999, readEvents={}

    // Step 4: Sync GET returns old server state
    resolveGet(
      new Response(
        JSON.stringify({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      ),
    )
    await vi.advanceTimersByTimeAsync(0)

    // Sync merges stale snapshot (which had A) and POSTs it.
    // POST returns with A in readEvents (server accepted our stale data)
    resolvePost(
      new Response(
        JSON.stringify({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 200,
          readEvents: [{eventId: 'A', eventAtMs: 3000}],
          updatedAt: '2026-01-01T00:00:03.000Z',
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      ),
    )
    await sync1Promise

    // After sync 1: A must be unread (deletedEventIds should prevent re-add)
    const afterSync1 = await caller.getLocalState(accountUid)
    expect(afterSync1.readEvents).toEqual([])

    // Step 5: Now sync #2 — server STILL has A from the stale POST.
    // GET returns A. The initial merge will include A in what it POSTs.
    // POST response also echoes A back.
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 200,
          readEvents: [{eventId: 'A', eventAtMs: 3000}],
          updatedAt: '2026-01-01T00:00:04.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 200,
          readEvents: [{eventId: 'A', eventAtMs: 3000}],
          updatedAt: '2026-01-01T00:00:05.000Z',
        }),
      )
    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    // After sync 2: A must STILL be unread — the server's stale A must not win
    const afterSync2 = await caller.getLocalState(accountUid)
    expect(afterSync2.markAllReadAtMs).toBe(1999)
    expect(afterSync2.readEvents).toEqual([])
  })

  it('mark-unread during in-flight sync does not revert on sync completion', async () => {
    const caller = await loadCaller()

    vi.setSystemTime(new Date(100))
    await caller.markAllRead({accountUid, markAllReadAtMs: 5000})

    // Sync to establish server state
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      )
    await caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    // Mark B@2000 as unread → watermark to 1999, A added to readEvents
    vi.setSystemTime(new Date(200))
    await caller.markEventUnread({
      accountUid,
      eventId: 'B',
      eventAtMs: 2000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
      ],
    })

    // Start sync — this will use a deferred fetch so we can interleave user actions
    let resolveGet!: (v: Response) => void
    let resolvePost!: (v: Response) => void
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePost = resolve
          }),
      )

    const syncPromise = caller.syncNow({accountUid, notifyServiceHost: 'https://notify.example'})

    // While GET is in flight, mark A@3000 as unread
    vi.setSystemTime(new Date(300))
    await caller.markEventUnread({
      accountUid,
      eventId: 'A',
      eventAtMs: 3000,
      otherLoadedEvents: [
        {eventId: 'A', eventAtMs: 3000},
        {eventId: 'B', eventAtMs: 2000},
      ],
    })

    // Verify local state before sync completes
    const beforeSyncComplete = await caller.getLocalState(accountUid)
    expect(beforeSyncComplete.readEvents).toEqual([])

    // GET returns (server has old state)
    resolveGet(
      new Response(
        JSON.stringify({
          accountId: accountUid,
          markAllReadAtMs: 5000,
          stateUpdatedAtMs: 100,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      ),
    )
    // Let microtasks run (GET handler + merge + POST send)
    await vi.advanceTimersByTimeAsync(0)

    // POST returns with what the sync uploaded
    resolvePost(
      new Response(
        JSON.stringify({
          accountId: accountUid,
          markAllReadAtMs: 1999,
          stateUpdatedAtMs: 200,
          readEvents: [{eventId: 'A', eventAtMs: 3000}],
          updatedAt: '2026-01-01T00:00:03.000Z',
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      ),
    )
    await syncPromise

    // After sync: A must STILL be unread (not re-added by server response)
    const afterSync = await caller.getLocalState(accountUid)
    expect(afterSync.markAllReadAtMs).toBe(1999)
    expect(afterSync.readEvents).toEqual([])
  })

  it('persists read state across module reload', async () => {
    const caller = await loadCaller()
    await caller.getLocalState(accountUid)
    await caller.markEventRead({
      accountUid,
      eventId: 'persisted-event',
      eventAtMs: 1600,
    })

    const stateBeforeReload = await caller.getLocalState(accountUid)
    expect(stateBeforeReload.readEvents).toEqual([{eventId: 'persisted-event', eventAtMs: 1600}])

    vi.resetModules()
    const callerAfterReload = await loadCaller()
    const stateAfterReload = await callerAfterReload.getLocalState(accountUid)

    expect(stateAfterReload.markAllReadAtMs).toBe(stateBeforeReload.markAllReadAtMs)
    expect(stateAfterReload.readEvents).toEqual(stateBeforeReload.readEvents)
  })
})
