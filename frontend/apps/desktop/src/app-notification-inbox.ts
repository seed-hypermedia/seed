import {encode as cborEncode, decode as cborDecode} from '@ipld/dag-cbor'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {queryKeys} from '@shm/shared/models/query-keys'
import {LoadedEventWithNotifMeta, listEventsImpl, getFeedEventId} from '@shm/shared/models/activity-service'
import {ListEvents} from '@shm/shared/api-activity'
import {classifyNotificationEvent} from '@shm/shared/models/notification-event-classifier'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {base58btc} from 'multiformats/bases/base58'
import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
import * as log from './logger'

const NOTIFICATION_INBOX_STORE_KEY = 'NotificationInbox-v003'
const NOTIFICATION_POLL_INTERVAL_MS = 15_000
const NOTIFICATION_LOCAL_ONLY_POLL_INTERVAL_MS = 5_000
const NOTIFICATION_PAGE_SIZE = 40
const NOTIFICATION_MAX_SCAN_PAGES = 40
const NOTIFICATION_MAX_ITEMS_PER_ACCOUNT = 600
const SERVER_FETCH_MAX_PAGES = 5
const NOTIFY_SERVICE_HOST_KEY = 'NotifyServiceHost'

type AccountNotificationInbox = {
  items: NotificationPayload[]
  newestServerEventAtMs: number | null
}

type NotificationInboxStore = {
  version: 2
  cursorEventId: string | null
  accounts: Record<string, AccountNotificationInbox>
  registeredAccounts: Record<string, number> // accountUid -> registeredAtMs
  registeredHost: string | null // host accounts were registered with
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
    version: 2,
    cursorEventId: null,
    accounts: {},
    registeredAccounts: {},
    registeredHost: null,
    lastPollAtMs: null,
    lastError: null,
  }
}

function loadStore(): NotificationInboxStore {
  const raw = appStore.get(NOTIFICATION_INBOX_STORE_KEY) as NotificationInboxStore | undefined
  if (raw?.version === 2 && raw.accounts && typeof raw.accounts === 'object' && 'cursorEventId' in raw) {
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

function normalizeHost(host: string) {
  return host.replace(/\/$/, '')
}

function getNotifyServiceHost(): string | null {
  const stored = appStore.get(NOTIFY_SERVICE_HOST_KEY) as string | undefined
  const host = stored !== undefined ? stored : NOTIFY_SERVICE_HOST
  if (!host) return null
  const trimmed = host.trim()
  if (!trimmed) return null
  return trimmed
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
  account = {items: [], newestServerEventAtMs: null}
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

async function listLocalAccountUids(): Promise<string[]> {
  const keys = await grpcClient.daemon.listKeys({})
  return keys.keys.map((key) => key.publicKey).filter(Boolean)
}

// --- Signed server requests ---

async function signedNotificationInboxPost(accountUid: string, host: string, payload: Record<string, unknown>) {
  const signerPublicKey = new Uint8Array(base58btc.decode(accountUid))
  const unsigned = {
    ...payload,
    signer: signerPublicKey,
    time: getNowMs(),
  }
  const encoded = cborEncode(unsigned)

  const signed = await grpcClient.daemon.signData({
    signingKeyName: accountUid,
    data: new Uint8Array(encoded),
  })

  const body = cborEncode({
    ...unsigned,
    sig: new Uint8Array(signed.signature),
  })

  const response = await fetch(`${normalizeHost(host)}/hm/api/notification-inbox`, {
    method: 'POST',
    body: Buffer.from(body),
    headers: {'Content-Type': 'application/cbor'},
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Notification inbox request failed: ${response.status} ${text}`)
  }

  const responseBuffer = await response.arrayBuffer()
  return cborDecode(new Uint8Array(responseBuffer)) as any
}

// --- Server registration ---

function handleHostChange(host: string) {
  const normalizedHost = normalizeHost(host)
  if (store.registeredHost === normalizedHost) return
  // Host changed — registrations are for the old server, watermarks are stale
  const resetAccounts: Record<string, AccountNotificationInbox> = {}
  for (const [uid, account] of Object.entries(store.accounts)) {
    resetAccounts[uid] = {items: account.items, newestServerEventAtMs: null}
  }
  store = {
    ...store,
    accounts: resetAccounts,
    registeredAccounts: {},
    registeredHost: normalizedHost,
  }
  writeStore()
  log.info('Notification server host changed, cleared registrations and watermarks', {
    host: normalizedHost,
  })
}

function isAccountRegistered(accountUid: string): boolean {
  return accountUid in store.registeredAccounts
}

function markAccountRegistered(accountUid: string) {
  store = {
    ...store,
    registeredAccounts: {
      ...store.registeredAccounts,
      [accountUid]: getNowMs(),
    },
  }
  writeStore()
}

async function registerAccountsWithServer(accountUids: string[], host: string) {
  for (const accountUid of accountUids) {
    if (isAccountRegistered(accountUid)) continue
    try {
      await signedNotificationInboxPost(accountUid, host, {
        action: 'register-inbox',
      })
      markAccountRegistered(accountUid)
      log.info('Registered account with notification inbox server', {accountUid})
    } catch (error: any) {
      log.warn('Failed to register account with notification inbox server', {
        accountUid,
        error: error?.message,
      })
    }
  }
}

// --- Server fetch ---

type ServerInboxResponse = {
  accountId: string
  notifications: NotificationPayload[]
  hasMore: boolean
  oldestEventAtMs: number | null
}

async function fetchServerNotifications(
  accountUid: string,
  host: string,
  opts?: {beforeMs?: number; limit?: number},
): Promise<ServerInboxResponse | null> {
  try {
    const result = await signedNotificationInboxPost(accountUid, host, {
      action: 'get-notification-inbox',
      beforeMs: opts?.beforeMs,
      limit: opts?.limit ?? 200,
    })
    return result as ServerInboxResponse
  } catch (error: any) {
    log.warn('Failed to fetch server notifications', {
      accountUid,
      error: error?.message,
    })
    return null
  }
}

async function fetchServerNotificationsIncremental(
  accountUid: string,
  host: string,
  knownNewestEventAtMs: number | null,
): Promise<NotificationPayload[]> {
  const allNotifs: NotificationPayload[] = []
  let beforeMs: number | undefined = undefined
  let pagesFetched = 0

  while (pagesFetched < SERVER_FETCH_MAX_PAGES) {
    const result = await fetchServerNotifications(accountUid, host, {
      beforeMs,
      limit: 200,
    })

    if (!result) break

    const pageNotifs = result.notifications
    if (pageNotifs.length === 0) break

    allNotifs.push(...pageNotifs)
    pagesFetched += 1

    // Overlap check: oldest item on this page is at or before our watermark
    // → we've reached data we already have. Stop.
    if (knownNewestEventAtMs !== null) {
      const oldestOnPage = pageNotifs[pageNotifs.length - 1]!.eventAtMs
      if (oldestOnPage <= knownNewestEventAtMs) {
        break
      }
    }

    if (!result.hasMore) break

    beforeMs = result.oldestEventAtMs!
  }

  return allNotifs
}

// --- Local notification generation ---

async function fetchLatestEventId(): Promise<string | null> {
  const response = await listEventsImpl(grpcClient as any, {
    pageSize: 1,
    filterEventType: [],
  })
  const firstEvent = response.events[0]
  if (!firstEvent) return null
  return getFeedEventId(firstEvent)
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

function loadedEventToPayload(event: LoadedEventWithNotifMeta, reason: string): NotificationPayload {
  // Use 'any' for property access since LoadedEvent is a discriminated union
  // and the classifier already confirmed the event type is relevant
  const e = event as any
  return {
    feedEventId: event.feedEventId,
    eventAtMs: event.eventAtMs,
    reason: reason as NotificationPayload['reason'],
    eventType: e.type || 'unknown',
    author: {
      uid: e.author?.id?.uid ?? '',
      name: e.author?.metadata?.name ?? null,
      icon: e.author?.metadata?.icon ?? null,
    },
    target: {
      uid: e.target?.id?.uid ?? e.source?.id?.uid ?? '',
      path: e.target?.id?.path ?? e.source?.id?.path ?? null,
      name: e.target?.metadata?.name ?? e.source?.metadata?.name ?? null,
    },
    commentId: e.comment?.id ?? null,
    sourceId: e.source?.id?.uid ?? null,
    citationType: e.citationType === 'd' || e.citationType === 'c' ? e.citationType : null,
  }
}

function classifyAndConvertLocalEvents(events: LoadedEventWithNotifMeta[], accountUid: string): NotificationPayload[] {
  const payloads: NotificationPayload[] = []
  for (const event of events) {
    const reason = classifyNotificationEvent(event, accountUid)
    if (!reason) continue
    payloads.push(loadedEventToPayload(event, reason))
  }
  return payloads
}

// --- Reconciliation ---

function mergeNotifications(
  current: NotificationPayload[],
  serverNotifs: NotificationPayload[],
  localNotifs: NotificationPayload[],
): NotificationPayload[] {
  const mergedById = new Map<string, NotificationPayload>()

  // Start with current items
  for (const item of current) {
    mergedById.set(item.feedEventId, item)
  }

  // Apply local notifications (local fallback)
  for (const item of localNotifs) {
    const prev = mergedById.get(item.feedEventId)
    if (!prev || item.eventAtMs >= prev.eventAtMs) {
      mergedById.set(item.feedEventId, item)
    }
  }

  // Apply server notifications (server wins on duplicates)
  for (const item of serverNotifs) {
    mergedById.set(item.feedEventId, item)
  }

  return Array.from(mergedById.values())
    .sort((a, b) => b.eventAtMs - a.eventAtMs || b.feedEventId.localeCompare(a.feedEventId))
    .slice(0, NOTIFICATION_MAX_ITEMS_PER_ACCOUNT)
}

function arePayloadListsEqual(left: NotificationPayload[], right: NotificationPayload[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let idx = 0; idx < left.length; idx += 1) {
    const lhs = left[idx]
    const rhs = right[idx]
    if (!lhs || !rhs) return false
    if (lhs.reason !== rhs.reason) return false
    if (lhs.feedEventId !== rhs.feedEventId) return false
    if (lhs.eventAtMs !== rhs.eventAtMs) return false
  }
  return true
}

// --- Main poll loop ---

export async function runNotificationIngestPoll() {
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
    const host = getNotifyServiceHost()

    // Detect server host change — clears registrations and watermarks
    if (host) {
      handleHostChange(host)
      await registerAccountsWithServer(accountUids, host)
    }

    // Fetch server notifications for each account (incremental pagination)
    const serverNotifsByAccount = new Map<string, NotificationPayload[]>()
    const serverWatermarks = new Map<string, number>()
    if (host) {
      for (const accountUid of accountUids) {
        const inbox = getOrCreateAccountInbox(accountUid)
        const serverNotifs = await fetchServerNotificationsIncremental(
          accountUid,
          host,
          inbox.newestServerEventAtMs ?? null,
        )
        if (serverNotifs.length > 0) {
          serverNotifsByAccount.set(accountUid, serverNotifs)
          const newestFetched = serverNotifs[0]!.eventAtMs
          if (newestFetched > (inbox.newestServerEventAtMs ?? 0)) {
            serverWatermarks.set(accountUid, newestFetched)
          }
        }
      }
    }

    // Generate local notifications from activity feed
    const latestEventId = await fetchLatestEventId()
    let localEventsByAccount = new Map<string, NotificationPayload[]>()

    if (latestEventId) {
      if (!store.cursorEventId) {
        store = {
          ...store,
          cursorEventId: latestEventId,
        }
        writeStore()
        log.info('Initialized notification inbox cursor', {
          cursorEventId: latestEventId,
          accountCount: accountUids.length,
        })
      } else if (latestEventId !== store.cursorEventId) {
        const previousCursor = store.cursorEventId
        const loaded = await loadEventsAfterCursor({
          cursorEventId: previousCursor,
          currentAccount,
        })

        // Classify local events for each account
        for (const accountUid of accountUids) {
          const payloads = classifyAndConvertLocalEvents(loaded.events, accountUid)
          if (payloads.length > 0) {
            localEventsByAccount.set(accountUid, payloads)
          }
        }

        // Always advance cursor
        if (loaded.newestEventId) {
          store = {
            ...store,
            cursorEventId: loaded.newestEventId,
          }
          writeStore()
        }

        if (!loaded.foundCursor) {
          log.warn('Notification inbox cursor was not found in activity feed scan', {
            previousCursor,
            newestEventId: loaded.newestEventId,
            processedEvents: loaded.events.length,
          })
        }
      }
    }

    // Reconcile and update each account
    const changedAccounts: string[] = []
    const nextAccounts: Record<string, AccountNotificationInbox> = {...store.accounts}
    let storeNeedsWrite = false

    for (const accountUid of accountUids) {
      const existing = getOrCreateAccountInbox(accountUid)
      const serverNotifs = serverNotifsByAccount.get(accountUid) || []
      const localNotifs = localEventsByAccount.get(accountUid) || []
      const merged = mergeNotifications(existing.items, serverNotifs, localNotifs)
      const newWatermark = serverWatermarks.get(accountUid) ?? existing.newestServerEventAtMs ?? null
      const itemsChanged = !arePayloadListsEqual(existing.items, merged)
      const watermarkChanged = newWatermark !== (existing.newestServerEventAtMs ?? null)

      if (itemsChanged || watermarkChanged) {
        nextAccounts[accountUid] = {
          items: itemsChanged ? merged : existing.items,
          newestServerEventAtMs: newWatermark,
        }
        if (itemsChanged) {
          changedAccounts.push(accountUid)
        }
        storeNeedsWrite = true
      }
    }

    if (storeNeedsWrite) {
      store = {
        ...store,
        accounts: nextAccounts,
      }
      writeStore()
    }

    setLastPollSuccess()

    if (changedAccounts.length) {
      for (const accountUid of changedAccounts) {
        appInvalidateQueries([queryKeys.NOTIFICATION_INBOX, accountUid])
      }
    }

    log.info('Notification inbox poll completed', {
      accountCount: accountUids.length,
      serverAvailable: Boolean(host),
      changedAccounts: changedAccounts.length,
      serverFetched: serverNotifsByAccount.size,
      localGenerated: localEventsByAccount.size,
    })
  } catch (error: any) {
    const message = error?.message || String(error)
    setLastPollError(message)
    log.warn('Notification inbox poll failed', {
      error: message,
    })
  } finally {
    isPolling = false
  }
}

export function startNotificationInboxBackgroundIngestor() {
  if (hasStartedIngestLoop) return
  hasStartedIngestLoop = true

  const host = getNotifyServiceHost()
  const intervalMs = host ? NOTIFICATION_POLL_INTERVAL_MS : NOTIFICATION_LOCAL_ONLY_POLL_INTERVAL_MS

  if (!ingestTimer) {
    ingestTimer = setInterval(() => void runNotificationIngestPoll(), intervalMs)
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
