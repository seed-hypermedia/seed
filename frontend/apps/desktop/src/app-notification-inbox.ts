import {queryKeys} from '@shm/shared/models/query-keys'
import {LoadedEventWithNotifMeta} from '@shm/shared/models/activity-service'
import {classifyNotificationEvent, NotificationReason} from '@shm/shared/models/notification-event-classifier'
import {ListEvents} from '@shm/shared/api-activity'
import {Event} from '@shm/shared/src/client/.generated/activity/v1alpha/activity_pb'
import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
import * as log from './logger'

const NOTIFICATION_INBOX_STORE_KEY = 'NotificationInbox-v001'
const NOTIFICATION_POLL_INTERVAL_MS = 5_000
const NOTIFICATION_PAGE_SIZE = 40
const NOTIFICATION_MAX_SCAN_PAGES = 40
const NOTIFICATION_MAX_ITEMS_PER_ACCOUNT = 600

type NotificationInboxItem = {
  reason: NotificationReason
  event: LoadedEventWithNotifMeta
}

type AccountNotificationInbox = {
  items: NotificationInboxItem[]
}

type NotificationInboxStore = {
  version: 1
  cursorEventId: string | null
  accounts: Record<string, AccountNotificationInbox>
  lastPollAtMs: number | null
  lastError: string | null
}

type NotificationIngestStatus = {
  cursorEventId: string | null
  accountCount: number
  lastPollAtMs: number | null
  lastError: string | null
  isPolling: boolean
}

function createEmptyStore(): NotificationInboxStore {
  return {
    version: 1,
    cursorEventId: null,
    accounts: {},
    lastPollAtMs: null,
    lastError: null,
  }
}

function loadStore(): NotificationInboxStore {
  const raw = appStore.get(NOTIFICATION_INBOX_STORE_KEY) as NotificationInboxStore | undefined
  if (raw?.version === 1 && raw.accounts && typeof raw.accounts === 'object' && 'cursorEventId' in raw) {
    return raw
  }
  return createEmptyStore()
}

let store = loadStore()
let hasStartedIngestLoop = false
let ingestTimer: ReturnType<typeof setInterval> | null = null
let isPolling = false

function writeStore() {
  appStore.set(NOTIFICATION_INBOX_STORE_KEY, store)
}

function getNowMs() {
  return Date.now()
}

function toNotificationIngestStatus(): NotificationIngestStatus {
  return {
    cursorEventId: store.cursorEventId,
    accountCount: Object.keys(store.accounts).length,
    lastPollAtMs: store.lastPollAtMs,
    lastError: store.lastError,
    isPolling,
  }
}

function getOrCreateAccountInbox(accountUid: string): AccountNotificationInbox {
  let account = store.accounts[accountUid]
  if (account) return account
  account = {items: []}
  store = {
    ...store,
    accounts: {
      ...store.accounts,
      [accountUid]: account,
    },
  }
  writeStore()
  return account
}

function setLastPollSuccess() {
  store = {
    ...store,
    lastPollAtMs: getNowMs(),
    lastError: null,
  }
  writeStore()
}

function setLastPollError(error: string) {
  store = {
    ...store,
    lastPollAtMs: getNowMs(),
    lastError: error,
  }
  writeStore()
}

function asEventId(event: Event): string | null {
  if (event.data.case === 'newBlob') {
    const cid = event.data.value?.cid
    return cid ? `blob-${cid}` : null
  }
  if (event.data.case === 'newMention') {
    const mention = event.data.value
    return `mention-${mention.sourceBlob?.cid}-${mention.mentionType}-${mention.target}`
  }
  return null
}

async function listLocalAccountUids(): Promise<string[]> {
  const keys = await grpcClient.daemon.listKeys({})
  return keys.keys.map((key) => key.publicKey).filter(Boolean)
}

async function fetchLatestEventId(currentAccount: string | undefined): Promise<string | null> {
  const response = await grpcClient.activityFeed.listEvents({
    pageSize: 1,
    currentAccount,
    filterEventType: [],
  } as any)
  const firstEvent = response.events[0]
  if (!firstEvent) return null
  return asEventId(firstEvent)
}

async function fetchResolvedEventsPage(input: {pageToken?: string; currentAccount?: string}) {
  const response = await ListEvents.getData(
    grpcClient as any,
    {
      pageToken: input.pageToken,
      pageSize: NOTIFICATION_PAGE_SIZE,
      currentAccount: input.currentAccount,
      filterEventType: [],
    },
    async () => {
      throw new Error('queryDaemon is not available in desktop main process')
    },
  )
  return {
    events: response.events as LoadedEventWithNotifMeta[],
    nextPageToken: response.nextPageToken || '',
  }
}

async function loadEventsAfterCursor(input: {cursorEventId: string; currentAccount?: string}) {
  let pageToken: string | undefined = undefined
  let pagesScanned = 0
  let foundCursor = false
  const events: LoadedEventWithNotifMeta[] = []
  let newestEventId: string | null = null

  while (pagesScanned < NOTIFICATION_MAX_SCAN_PAGES) {
    const page = await fetchResolvedEventsPage({
      pageToken,
      currentAccount: input.currentAccount,
    })
    if (!newestEventId && page.events[0]) {
      newestEventId = page.events[0].feedEventId
    }
    if (!page.events.length) break

    for (const event of page.events) {
      if (event.feedEventId === input.cursorEventId) {
        foundCursor = true
        break
      }
      events.push(event)
    }

    if (foundCursor || !page.nextPageToken) break
    pageToken = page.nextPageToken
    pagesScanned += 1
  }

  return {events, newestEventId, foundCursor}
}

function mergeAccountNotifications(current: NotificationInboxItem[], incoming: NotificationInboxItem[]) {
  if (!incoming.length) return current

  const mergedById = new Map<string, NotificationInboxItem>()
  for (const item of current) {
    mergedById.set(item.event.feedEventId, item)
  }
  for (const item of incoming) {
    const prev = mergedById.get(item.event.feedEventId)
    if (!prev || item.event.eventAtMs >= prev.event.eventAtMs) {
      mergedById.set(item.event.feedEventId, item)
    }
  }

  return Array.from(mergedById.values())
    .sort((a, b) => b.event.eventAtMs - a.event.eventAtMs || b.event.feedEventId.localeCompare(a.event.feedEventId))
    .slice(0, NOTIFICATION_MAX_ITEMS_PER_ACCOUNT)
}

function areNotificationListsEqual(left: NotificationInboxItem[], right: NotificationInboxItem[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let idx = 0; idx < left.length; idx += 1) {
    const lhs = left[idx]
    const rhs = right[idx]
    if (!lhs || !rhs) return false
    if (lhs.reason !== rhs.reason) return false
    if (lhs.event.feedEventId !== rhs.event.feedEventId) return false
    if (lhs.event.eventAtMs !== rhs.event.eventAtMs) return false
  }
  return true
}

function ingestEventsForAccounts(events: LoadedEventWithNotifMeta[], accountUids: string[]) {
  if (!events.length || !accountUids.length) return []

  const incomingByAccount = new Map<string, NotificationInboxItem[]>()
  for (const accountUid of accountUids) {
    incomingByAccount.set(accountUid, [])
  }

  for (const event of events) {
    for (const accountUid of accountUids) {
      const reason = classifyNotificationEvent(event, accountUid)
      if (!reason) continue
      incomingByAccount.get(accountUid)!.push({
        reason,
        event,
      })
    }
  }

  const changedAccounts: string[] = []
  let didChange = false
  const nextAccounts: Record<string, AccountNotificationInbox> = {
    ...store.accounts,
  }

  for (const accountUid of accountUids) {
    const existing = getOrCreateAccountInbox(accountUid)
    const incoming = incomingByAccount.get(accountUid) || []
    const merged = mergeAccountNotifications(existing.items, incoming)
    if (!areNotificationListsEqual(existing.items, merged)) {
      nextAccounts[accountUid] = {items: merged}
      changedAccounts.push(accountUid)
      didChange = true
    }
  }

  if (didChange) {
    store = {
      ...store,
      accounts: nextAccounts,
    }
    writeStore()
  }

  return changedAccounts
}

async function runNotificationIngestPoll() {
  if (isPolling) return
  isPolling = true

  try {
    const accountUids = await listLocalAccountUids()
    if (!accountUids.length) {
      setLastPollSuccess()
      return
    }

    for (const accountUid of accountUids) {
      getOrCreateAccountInbox(accountUid)
    }

    const currentAccount = accountUids[0]
    const latestEventId = await fetchLatestEventId(currentAccount)

    if (!latestEventId) {
      setLastPollSuccess()
      return
    }

    if (!store.cursorEventId) {
      store = {
        ...store,
        cursorEventId: latestEventId,
      }
      writeStore()
      setLastPollSuccess()
      log.info('Initialized notification inbox cursor', {
        cursorEventId: latestEventId,
        accountCount: accountUids.length,
      })
      return
    }

    if (latestEventId === store.cursorEventId) {
      setLastPollSuccess()
      return
    }

    const previousCursor = store.cursorEventId
    const loaded = await loadEventsAfterCursor({
      cursorEventId: previousCursor,
      currentAccount,
    })

    const changedAccounts = ingestEventsForAccounts(loaded.events, accountUids)
    if (loaded.foundCursor && loaded.newestEventId) {
      store = {
        ...store,
        cursorEventId: loaded.newestEventId,
      }
      writeStore()
    }
    setLastPollSuccess()

    if (changedAccounts.length) {
      for (const accountUid of changedAccounts) {
        appInvalidateQueries([queryKeys.NOTIFICATION_INBOX, accountUid])
      }
    }

    if (!loaded.foundCursor) {
      log.warn('Notification inbox cursor was not found in activity feed scan', {
        previousCursor,
        newestEventId: loaded.newestEventId,
        processedEvents: loaded.events.length,
        changedAccounts: changedAccounts.length,
      })
    } else {
      log.info('Notification inbox ingest completed', {
        previousCursor,
        newestEventId: loaded.newestEventId,
        processedEvents: loaded.events.length,
        changedAccounts: changedAccounts.length,
      })
    }
  } catch (error: any) {
    const message = error?.message || String(error)
    setLastPollError(message)
    log.warn('Notification inbox ingest failed', {
      error: message,
    })
  } finally {
    isPolling = false
  }
}

export function startNotificationInboxBackgroundIngestor() {
  if (hasStartedIngestLoop) return
  hasStartedIngestLoop = true

  if (!ingestTimer) {
    ingestTimer = setInterval(() => void runNotificationIngestPoll(), NOTIFICATION_POLL_INTERVAL_MS)
  }

  void runNotificationIngestPoll()
}

export const notificationInboxApi = t.router({
  getLocalInbox: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .query(async ({input}) => {
      const account = getOrCreateAccountInbox(input.accountUid)
      const limit = input.limit ?? 400
      return account.items.slice(0, limit)
    }),
  getIngestStatus: t.procedure.query(async () => {
    return toNotificationIngestStatus()
  }),
})
