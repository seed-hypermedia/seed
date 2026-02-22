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

vi.mock('../grpc-client', () => ({
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

  it('merges local and remote state monotonically and remains idempotent', async () => {
    const caller = await loadCaller()

    await caller.getLocalState(accountUid)
    await caller.markEventRead({
      accountUid,
      eventId: 'local-event',
      eventAtMs: 1300,
    })

    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          readEvents: [{eventId: 'remote-event', eventAtMs: 1400}],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          readEvents: [
            {eventId: 'remote-event', eventAtMs: 1400},
            {eventId: 'local-event', eventAtMs: 1300},
          ],
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
    expect(stateAfterFirstSync.readEvents).toEqual([
      {eventId: 'remote-event', eventAtMs: 1400},
      {eventId: 'local-event', eventAtMs: 1300},
    ])

    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          readEvents: [
            {eventId: 'remote-event', eventAtMs: 1400},
            {eventId: 'local-event', eventAtMs: 1300},
          ],
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1200,
          readEvents: [
            {eventId: 'remote-event', eventAtMs: 1400},
            {eventId: 'local-event', eventAtMs: 1300},
          ],
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
    expect(failedStatus.lastSyncError).toContain('offline')

    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1000,
          readEvents: [],
          updatedAt: '2026-01-01T00:00:04.000Z',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          markAllReadAtMs: 1000,
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
