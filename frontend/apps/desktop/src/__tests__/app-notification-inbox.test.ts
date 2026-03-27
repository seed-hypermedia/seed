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
  appInvalidateQueries: vi.fn(),
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

describe('app notification inbox', () => {
  const accountUid = base58btc.encode(new Uint8Array([1, 2, 3, 4, 5]))
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
    signDataMock.mockResolvedValue({signature: new Uint8Array([1, 2, 3, 4])})
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the inbox from the canonical notification state endpoint', async () => {
    const {read, inbox} = await loadCallers()

    fetchMock.mockImplementationOnce(() =>
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

    await read.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    const payload = cborDecode(fetchMock.mock.calls[0][1].body as Uint8Array) as {action: string}
    expect(payload.action).toBe('get-notification-state')

    const syncedInbox = await inbox.getLocalInbox({accountUid})
    expect(syncedInbox).toHaveLength(1)
    expect(syncedInbox[0]?.feedEventId).toBe('server-event')
  })

  it('reports sync failures through the ingest status', async () => {
    const {read, inbox} = await loadCallers()

    await read.markEventRead({
      accountUid,
      eventId: 'event-1',
      eventAtMs: 1200,
    })

    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await read.syncNow({
      accountUid,
      notifyServiceHost: 'https://notify.example',
    })

    const ingestStatus = await inbox.getIngestStatus()
    expect(ingestStatus.accountCount).toBe(1)
    expect(ingestStatus.lastError).toContain('offline')
  })
})
