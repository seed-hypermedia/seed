import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const storeData: Record<string, any> = {}

const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

const listKeysMock = vi.fn(async () => ({
  keys: [] as Array<{publicKey: string}>,
}))
const listRawEventsMock = vi.fn(async () => ({events: [] as any[]}))
const listResolvedEventsMock = vi.fn(async () => ({
  events: [] as any[],
  nextPageToken: '',
}))
const appInvalidateQueriesMock = vi.fn()

vi.mock('../app-store.mts', () => ({
  appStore: appStoreMock,
}))

vi.mock('../grpc-client', () => ({
  grpcClient: {
    daemon: {
      listKeys: listKeysMock,
    },
    activityFeed: {
      listEvents: listRawEventsMock,
    },
  },
}))

vi.mock('@shm/shared/api-activity', () => ({
  ListEvents: {
    getData: listResolvedEventsMock,
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

function rawNewBlobEvent(cid: string) {
  return {
    data: {
      case: 'newBlob',
      value: {cid},
    },
  } as any
}

function createCitationMentionEvent(input: {eventId: string; accountUid: string}) {
  return {
    type: 'citation',
    id: input.eventId,
    feedEventId: input.eventId,
    eventAtMs: 2000,
    time: '2026-02-17T00:00:00.000Z',
    author: {id: {uid: 'author-a', path: null}, metadata: {name: 'Author'}},
    source: {id: {uid: 'site-a', path: ['doc']}, metadata: {name: 'Doc'}},
    target: {
      id: {uid: input.accountUid, path: null},
      metadata: {name: 'Target'},
    },
    citationType: 'd',
    comment: null,
    replyCount: 0,
  } as any
}

function createReplyEvent(input: {eventId: string; accountUid: string}) {
  return {
    type: 'comment',
    id: input.eventId,
    feedEventId: input.eventId,
    eventAtMs: 2500,
    time: '2026-02-17T00:00:01.000Z',
    author: {id: {uid: 'author-b', path: null}, metadata: {name: 'Other'}},
    replyParentAuthor: {
      id: {uid: input.accountUid, path: null},
      metadata: {name: 'Target'},
    },
    comment: {id: 'comment-version'},
    target: {id: {uid: 'site-b', path: ['post']}, metadata: {name: 'Post'}},
  } as any
}

async function loadInboxCaller() {
  const mod = await import('../app-notification-inbox')
  return {
    caller: mod.notificationInboxApi.createCaller({}),
    start: mod.startNotificationInboxBackgroundIngestor,
  }
}

async function flushAsyncWork(rounds = 8) {
  for (let idx = 0; idx < rounds; idx += 1) {
    await Promise.resolve()
  }
}

describe('app notification inbox', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
    listKeysMock.mockResolvedValue({keys: []})
    listRawEventsMock.mockResolvedValue({events: []})
    listResolvedEventsMock.mockResolvedValue({events: [], nextPageToken: ''})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes cursor from latest event without backfilling historical items', async () => {
    listKeysMock.mockResolvedValue({
      keys: [{publicKey: 'account-a'}],
    })
    listRawEventsMock.mockResolvedValue({
      events: [rawNewBlobEvent('latest-cid')],
    })

    const {caller, start} = await loadInboxCaller()
    start()

    await flushAsyncWork()

    const status = await caller.getIngestStatus()
    expect(status.cursorEventId).toBe('blob-latest-cid')

    const inbox = await caller.getLocalInbox({accountUid: 'account-a'})
    expect(inbox).toEqual([])
    expect(listResolvedEventsMock).not.toHaveBeenCalled()
  })

  it('ingests and stores notifications for all local accounts in background', async () => {
    storeData['NotificationInbox-v001'] = {
      version: 1,
      cursorEventId: 'blob-old-cursor',
      accounts: {},
      lastPollAtMs: null,
      lastError: null,
    }

    listKeysMock.mockResolvedValue({
      keys: [{publicKey: 'account-a'}, {publicKey: 'account-b'}],
    })
    listRawEventsMock.mockResolvedValue({
      events: [rawNewBlobEvent('latest-cid')],
    })
    listResolvedEventsMock.mockResolvedValue({
      events: [
        createCitationMentionEvent({
          eventId: 'mention-event',
          accountUid: 'account-b',
        }),
        createReplyEvent({
          eventId: 'reply-event',
          accountUid: 'account-a',
        }),
        {
          type: 'comment',
          feedEventId: 'blob-old-cursor',
          eventAtMs: 1000,
          time: '2026-02-17T00:00:02.000Z',
          author: null,
          comment: null,
          replyParentAuthor: null,
          target: null,
        },
      ],
      nextPageToken: '',
    })

    const {caller, start} = await loadInboxCaller()
    start()

    await flushAsyncWork()

    const inboxA = await caller.getLocalInbox({accountUid: 'account-a'})
    const inboxB = await caller.getLocalInbox({accountUid: 'account-b'})

    expect(inboxA[0]).toMatchObject({
      reason: 'reply',
      event: {feedEventId: 'reply-event'},
    })
    expect(inboxB[0]).toMatchObject({
      reason: 'mention',
      event: {feedEventId: 'mention-event'},
    })

    expect(appInvalidateQueriesMock).toHaveBeenCalledWith(['NOTIFICATION_INBOX', 'account-a'])
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith(['NOTIFICATION_INBOX', 'account-b'])
  })
})
