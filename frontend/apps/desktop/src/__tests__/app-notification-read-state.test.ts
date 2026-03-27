import {decode as cborDecode} from '@ipld/dag-cbor'
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
const appInvalidateQueriesMock = vi.fn()

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

vi.mock('../app-invalidation', () => ({
  appInvalidateQueries: appInvalidateQueriesMock,
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

function jsonResponse(body: any, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json'},
    }),
  )
}

async function loadCallers() {
  const readMod = await import('../app-notification-read-state')
  const inboxMod = await import('../app-notification-inbox')
  return {
    read: readMod.notificationReadApi.createCaller({}),
    inbox: inboxMod.notificationInboxApi.createCaller({}),
  }
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

  it('applies optimistic read actions locally through the shared reducer', async () => {
    const {read} = await loadCallers()

    const initial = await read.getLocalState(accountUid)
    expect(initial.markAllReadAtMs).toBeNull()
    expect(initial.dirty).toBe(false)

    await read.markEventRead({
      accountUid,
      eventId: 'event-1',
      eventAtMs: 1100,
    })

    const afterEventRead = await read.getLocalState(accountUid)
    expect(afterEventRead.readEvents).toEqual([{eventId: 'event-1', eventAtMs: 1100}])
    expect(afterEventRead.dirty).toBe(true)

    await read.markAllRead({
      accountUid,
      markAllReadAtMs: 1200,
    })

    const afterMarkAll = await read.getLocalState(accountUid)
    expect(afterMarkAll.markAllReadAtMs).toBe(1200)
    expect(afterMarkAll.readEvents).toEqual([])
    expect(afterMarkAll.dirty).toBe(true)
  })

  it('syncs canonical notification state and clears the pending queue', async () => {
    const {read, inbox} = await loadCallers()

    await read.markEventRead({
      accountUid,
      eventId: 'event-1',
      eventAtMs: 1100,
    })

    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          inbox: {
            notifications: [
              {
                feedEventId: 'server-event',
                eventAtMs: 2500,
                reason: 'reply',
                eventType: 'comment',
                author: {uid: 'author-b', name: 'Other', icon: null},
                target: {uid: 'site-b', path: ['post'], name: 'Post'},
                commentId: 'comment-version',
                sourceId: null,
                citationType: null,
              },
            ],
            hasMore: false,
            oldestEventAtMs: 2500,
          },
          config: {
            accountId: accountUid,
            email: null,
            verifiedTime: null,
            verificationSendTime: null,
            verificationExpired: false,
          },
          readState: {
            accountId: accountUid,
            markAllReadAtMs: null,
            readEvents: [],
            updatedAt: new Date(0).toISOString(),
          },
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          accountId: accountUid,
          inbox: {
            notifications: [
              {
                feedEventId: 'server-event',
                eventAtMs: 2500,
                reason: 'reply',
                eventType: 'comment',
                author: {uid: 'author-b', name: 'Other', icon: null},
                target: {uid: 'site-b', path: ['post'], name: 'Post'},
                commentId: 'comment-version',
                sourceId: null,
                citationType: null,
              },
            ],
            hasMore: false,
            oldestEventAtMs: 2500,
          },
          config: {
            accountId: accountUid,
            email: null,
            verifiedTime: null,
            verificationSendTime: null,
            verificationExpired: false,
          },
          readState: {
            accountId: accountUid,
            markAllReadAtMs: null,
            readEvents: [{eventId: 'event-1', eventAtMs: 1100}],
            updatedAt: new Date().toISOString(),
          },
        }),
      )

    const syncResult = await read.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstPayload = cborDecode(fetchMock.mock.calls[0][1].body as Uint8Array) as {action: string; limit: number}
    const secondPayload = cborDecode(fetchMock.mock.calls[1][1].body as Uint8Array) as {
      action: string
      actions: Array<{type: string; eventId?: string; eventAtMs?: number; clientActionId?: string}>
    }

    expect(firstPayload.action).toBe('get-notification-state')
    expect(firstPayload.limit).toBe(400)
    expect(secondPayload.action).toBe('apply-notification-actions')
    expect(secondPayload.actions).toHaveLength(1)
    expect(secondPayload.actions[0]).toMatchObject({
      type: 'mark-event-read',
      eventId: 'event-1',
      eventAtMs: 1100,
    })

    const syncedState = await read.getLocalState(accountUid)
    expect(syncResult.dirty).toBe(false)
    expect(syncedState.dirty).toBe(false)
    expect(syncedState.readEvents).toEqual([{eventId: 'event-1', eventAtMs: 1100}])

    const syncedInbox = await inbox.getLocalInbox({accountUid})
    expect(syncedInbox).toHaveLength(1)
    expect(syncedInbox[0]?.feedEventId).toBe('server-event')
  })

  it('keeps queued actions dirty when the notify service is unavailable', async () => {
    const {read} = await loadCallers()

    await read.markEventRead({
      accountUid,
      eventId: 'event-1',
      eventAtMs: 1100,
    })

    fetchMock.mockRejectedValueOnce(new Error('network down'))

    await read.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    const status = await read.getSyncStatus(accountUid)
    expect(status.dirty).toBe(true)
    expect(status.lastSyncError).toContain('network down')
  })
})
