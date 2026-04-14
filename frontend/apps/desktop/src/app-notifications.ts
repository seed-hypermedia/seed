import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {
  applyNotificationActions,
  getNotificationState,
  type NotificationSigner,
} from '@shm/shared/models/notification-service'
import {
  createEmptyNotificationState,
  reduceNotificationState,
  reduceNotificationStateActions,
  type NotificationConfigState,
  type NotificationMutationAction,
  type NotificationReadState,
  type NotificationStateSnapshot,
  type QueuedNotificationAction,
} from '@shm/shared/models/notification-state'
import {queryKeys} from '@shm/shared/models/query-keys'
import {base58btc} from 'multiformats/bases/base58'
import {isAnyWindowFocused} from './app-focus'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import * as log from './logger'

const NOTIFICATIONS_STORE_KEY = 'NotificationsState-v001'
const NOTIFY_SERVICE_HOST_KEY = 'NotifyServiceHost'
const SYNC_INTERVAL_MS = 30_000
const SYNC_DEBOUNCE_MS = 1_000

type AccountNotificationsState = {
  snapshot: NotificationStateSnapshot
  pendingActions: QueuedNotificationAction[]
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

type NotificationsStore = {
  version: 1
  accounts: Record<string, AccountNotificationsState>
}

type NotificationSyncStatus = {
  accountId: string
  dirty: boolean
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

type NotificationReadMutationResult = NotificationReadState &
  NotificationSyncStatus & {
    readStateChanged: boolean
    syncStatusChanged: boolean
  }

type NotificationConfigResponse = NotificationConfigState & {
  isNotifyServerConnected: boolean
}

type NotificationIngestStatus = {
  cursorEventId: null
  accountCount: number
  lastPollAtMs: number | null
  lastError: string | null
  isPolling: boolean
}

function loadStore(): NotificationsStore {
  const raw = appStore.get(NOTIFICATIONS_STORE_KEY) as NotificationsStore | undefined
  if (raw?.version === 1 && raw.accounts && typeof raw.accounts === 'object') {
    return raw
  }
  return {
    version: 1,
    accounts: {},
  }
}

function writeStore() {
  appStore.set(NOTIFICATIONS_STORE_KEY, store)
}

function normalizeHost(host: string) {
  return host.replace(/\/$/, '')
}

function getNotifyServiceHostDefault(): string | null {
  const stored = appStore.get(NOTIFY_SERVICE_HOST_KEY) as string | undefined
  const host = stored !== undefined ? stored : NOTIFY_SERVICE_HOST
  if (!host) return null
  const trimmed = host.trim()
  return trimmed || null
}

function resolveNotifyHost(notifyServiceHost: string | undefined): string {
  const host = notifyServiceHost?.trim() || getNotifyServiceHostDefault()
  if (!host) {
    throw new Error('Notify service host is not configured')
  }
  return host
}

function buildDesktopSigner(accountUid: string): NotificationSigner {
  return {
    publicKey: Uint8Array.from(base58btc.decode(accountUid)),
    sign: async (data: Uint8Array) => {
      const signed = await grpcClient.daemon.signData({
        signingKeyName: accountUid,
        data: Uint8Array.from(data),
      })
      return Uint8Array.from(signed.signature)
    },
  }
}

function areReadEventsEqual(
  left: Array<{eventId: string; eventAtMs: number}>,
  right: Array<{eventId: string; eventAtMs: number}>,
) {
  if (left.length !== right.length) return false
  return left.every((event, index) => {
    const other = right[index]
    return other && event.eventId === other.eventId && event.eventAtMs === other.eventAtMs
  })
}

function hasReadStateChanged(previous: NotificationReadState, next: NotificationReadState) {
  return previous.markAllReadAtMs !== next.markAllReadAtMs || !areReadEventsEqual(previous.readEvents, next.readEvents)
}

function hasSyncStatusChanged(previous: NotificationSyncStatus, next: NotificationSyncStatus) {
  return (
    previous.dirty !== next.dirty ||
    previous.lastSyncAtMs !== next.lastSyncAtMs ||
    previous.lastSyncError !== next.lastSyncError
  )
}

function invalidateAllNotificationQueries(accountUid: string) {
  appInvalidateQueries([queryKeys.NOTIFICATION_INBOX, accountUid])
  appInvalidateQueries([queryKeys.NOTIFICATION_READ_STATE, accountUid])
  appInvalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, accountUid])
  const notifyServiceHost = getNotifyServiceHostDefault()
  if (notifyServiceHost) {
    appInvalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountUid])
  }
}

function toReadState(snapshot: NotificationStateSnapshot): NotificationReadState {
  return snapshot.readState
}

function toSyncStatus(accountUid: string): NotificationSyncStatus {
  const account = getOrCreateAccountState(accountUid)
  return {
    accountId: accountUid,
    dirty: account.pendingActions.length > 0,
    lastSyncAtMs: account.lastSyncAtMs,
    lastSyncError: account.lastSyncError,
  }
}

function toConfigResponse(accountUid: string, notifyServiceHost?: string): NotificationConfigResponse {
  const account = getOrCreateAccountState(accountUid)
  const hasHost = Boolean(notifyServiceHost?.trim() || getNotifyServiceHostDefault())
  return {
    ...account.snapshot.config,
    isNotifyServerConnected: hasHost && !account.lastSyncError,
  }
}

function toReadMutationResult(
  accountUid: string,
  previousReadState: NotificationReadState,
  previousSyncStatus: NotificationSyncStatus,
): NotificationReadMutationResult {
  const nextReadState = toReadState(getOrCreateAccountState(accountUid).snapshot)
  const nextSyncStatus = toSyncStatus(accountUid)
  return {
    ...nextReadState,
    ...nextSyncStatus,
    readStateChanged: hasReadStateChanged(previousReadState, nextReadState),
    syncStatusChanged: hasSyncStatusChanged(previousSyncStatus, nextSyncStatus),
  }
}

function toIngestStatus(): NotificationIngestStatus {
  const accountStates = Object.values(store.accounts)
  const lastPollAtMs = accountStates.reduce<number | null>(
    (latest, account) =>
      account.lastSyncAtMs && (!latest || account.lastSyncAtMs > latest) ? account.lastSyncAtMs : latest,
    null,
  )
  const lastError = accountStates.find((account) => account.lastSyncError)?.lastSyncError ?? null
  return {
    cursorEventId: null,
    accountCount: accountStates.length,
    lastPollAtMs,
    lastError,
    isPolling: syncInFlight.size > 0,
  }
}

let store = loadStore()
let hasStartedSyncLoop = false
let syncIntervalHandle: ReturnType<typeof setTimeout> | null = null
const syncDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const syncInFlight = new Map<string, Promise<NotificationReadMutationResult>>()
let nextClientActionId = 0

function getOrCreateAccountState(accountUid: string): AccountNotificationsState {
  let account = store.accounts[accountUid]
  if (account) return account
  account = {
    snapshot: createEmptyNotificationState(accountUid),
    pendingActions: [],
    lastSyncAtMs: null,
    lastSyncError: null,
  }
  store = {
    ...store,
    accounts: {
      ...store.accounts,
      [accountUid]: account,
    },
  }
  writeStore()
  if (hasStartedSyncLoop) {
    scheduleSync(accountUid, 0, 'init-account')
  }
  return account
}

function updateAccountState(
  accountUid: string,
  updater: (current: AccountNotificationsState) => AccountNotificationsState,
) {
  const current = getOrCreateAccountState(accountUid)
  const next = updater(current)
  if (next === current) return current
  store = {
    ...store,
    accounts: {
      ...store.accounts,
      [accountUid]: next,
    },
  }
  writeStore()
  return next
}

function createQueuedAction(action: NotificationMutationAction): QueuedNotificationAction {
  nextClientActionId += 1
  return {
    ...action,
    clientActionId: `${Date.now()}-${nextClientActionId}`,
  }
}

function scheduleSync(accountUid: string, delayMs = SYNC_DEBOUNCE_MS, reason = 'unspecified') {
  const existing = syncDebounceTimers.get(accountUid)
  if (existing) clearTimeout(existing)
  log.debug('Notification sync scheduled', {
    accountUid,
    reason,
    delayMs,
  })
  const handle = setTimeout(() => {
    syncDebounceTimers.delete(accountUid)
    void syncAccount(accountUid)
  }, delayMs)
  syncDebounceTimers.set(accountUid, handle)
}

function enqueueAction(accountUid: string, action: NotificationMutationAction): NotificationReadMutationResult {
  const previousReadState = toReadState(getOrCreateAccountState(accountUid).snapshot)
  const previousSyncStatus = toSyncStatus(accountUid)
  const queuedAction = createQueuedAction(action)
  updateAccountState(accountUid, (current) => ({
    ...current,
    snapshot: reduceNotificationState(current.snapshot, action),
    pendingActions: [...current.pendingActions, queuedAction],
    lastSyncError: null,
  }))
  invalidateAllNotificationQueries(accountUid)
  scheduleSync(accountUid, SYNC_DEBOUNCE_MS, action.type)
  return toReadMutationResult(accountUid, previousReadState, previousSyncStatus)
}

async function runSync(accountUid: string, notifyServiceHost?: string): Promise<NotificationReadMutationResult> {
  const previousReadState = toReadState(getOrCreateAccountState(accountUid).snapshot)
  const previousSyncStatus = toSyncStatus(accountUid)
  let host: string
  try {
    host = resolveNotifyHost(notifyServiceHost)
  } catch (error: any) {
    updateAccountState(accountUid, (current) => ({
      ...current,
      lastSyncError: error.message,
    }))
    invalidateAllNotificationQueries(accountUid)
    return toReadMutationResult(accountUid, previousReadState, previousSyncStatus)
  }

  const signer = buildDesktopSigner(accountUid)
  const syncStart = Date.now()

  try {
    const remoteState = await getNotificationState(host, signer)
    updateAccountState(accountUid, (current) => ({
      ...current,
      snapshot: reduceNotificationStateActions(
        {
          ...remoteState,
          accountId: current.snapshot.accountId,
        },
        current.pendingActions,
      ),
      lastSyncAtMs: syncStart,
      lastSyncError: null,
    }))

    const pendingBeforeApply = getOrCreateAccountState(accountUid).pendingActions
    if (pendingBeforeApply.length > 0) {
      const appliedState = await applyNotificationActions(host, signer, {
        actions: pendingBeforeApply,
      })
      const appliedIds = new Set(pendingBeforeApply.map((action) => action.clientActionId))
      updateAccountState(accountUid, (current) => {
        const remainingPendingActions = current.pendingActions.filter(
          (action) => !appliedIds.has(action.clientActionId),
        )
        return {
          ...current,
          snapshot: reduceNotificationStateActions(appliedState, remainingPendingActions),
          pendingActions: remainingPendingActions,
          lastSyncAtMs: syncStart,
          lastSyncError: null,
        }
      })
    }
  } catch (error: any) {
    updateAccountState(accountUid, (current) => ({
      ...current,
      lastSyncAtMs: syncStart,
      lastSyncError: error?.message || String(error),
    }))
    log.warn('Notification sync failed', {
      accountUid,
      host,
      error: error?.message || String(error),
    })
  }

  invalidateAllNotificationQueries(accountUid)
  return toReadMutationResult(accountUid, previousReadState, previousSyncStatus)
}

function syncAllAccountsInBackground() {
  for (const accountUid of Object.keys(store.accounts)) {
    void syncAccount(accountUid)
  }
}

function scheduleNextNotificationSync() {
  const intervalMs = SYNC_INTERVAL_MS * (isAnyWindowFocused() ? 1 : 10)
  syncIntervalHandle = setTimeout(() => {
    syncAllAccountsInBackground()
    if (hasStartedSyncLoop) {
      scheduleNextNotificationSync()
    }
  }, intervalMs)
}

/** Starts the shared desktop notification background sync loop. */
export function startNotificationBackgroundSync() {
  if (hasStartedSyncLoop) return
  hasStartedSyncLoop = true
  if (!syncIntervalHandle) {
    scheduleNextNotificationSync()
  }
  syncAllAccountsInBackground()
}

/** Starts desktop notification read syncing through the unified notification store. */
export function startNotificationReadBackgroundSync() {
  startNotificationBackgroundSync()
}

/** Starts desktop inbox syncing through the unified notification store. */
export function startNotificationInboxBackgroundIngestor() {
  startNotificationBackgroundSync()
}

/** Runs an immediate desktop notification sync pass for all known accounts. */
export async function runNotificationIngestPoll() {
  await Promise.all(Object.keys(store.accounts).map((accountUid) => syncAccount(accountUid)))
}

/** Schedules a fresh sync whenever the configured notify-service host changes. */
export function handleNotifyServiceHostChanged(notifyServiceHost: string) {
  const host = notifyServiceHost.trim()
  for (const accountUid of Object.keys(store.accounts)) {
    void syncAccount(accountUid, host)
  }
}

/** Returns the local optimistic inbox cache for an account. */
export function getLocalNotificationInbox(accountUid: string) {
  return getOrCreateAccountState(accountUid).snapshot.inbox.notifications
}

/** Returns the local optimistic read state for an account. */
export function getLocalNotificationReadState(accountUid: string) {
  const account = getOrCreateAccountState(accountUid)
  return {
    ...toReadState(account.snapshot),
    dirty: account.pendingActions.length > 0,
    lastSyncAtMs: account.lastSyncAtMs,
    lastSyncError: account.lastSyncError,
  }
}

/** Returns the local notification sync status for an account. */
export function getLocalNotificationSyncStatus(accountUid: string) {
  return toSyncStatus(accountUid)
}

/** Returns the local optimistic notification config state for an account. */
export function getLocalNotificationConfig(accountUid: string, notifyServiceHost?: string) {
  return toConfigResponse(accountUid, notifyServiceHost)
}

/** Queues a read mutation and applies it optimistically in the desktop store. */
export function markNotificationEventRead(input: {accountUid: string; eventId: string; eventAtMs: number}) {
  return enqueueAction(input.accountUid, {
    type: 'mark-event-read',
    eventId: input.eventId,
    eventAtMs: input.eventAtMs,
  })
}

/** Queues an unread mutation and applies it optimistically in the desktop store. */
export function markNotificationEventUnread(input: {
  accountUid: string
  eventId: string
  eventAtMs: number
  otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
}) {
  return enqueueAction(input.accountUid, {
    type: 'mark-event-unread',
    eventId: input.eventId,
    eventAtMs: input.eventAtMs,
    otherLoadedEvents: input.otherLoadedEvents,
  })
}

/** Queues a mark-all-read mutation and applies it optimistically in the desktop store. */
export function markAllNotificationsRead(input: {accountUid: string; markAllReadAtMs: number}) {
  return enqueueAction(input.accountUid, {
    type: 'mark-all-read',
    markAllReadAtMs: input.markAllReadAtMs,
  })
}

/** Queues a config update and applies it optimistically in the desktop store. */
export function setLocalNotificationConfig(input: {accountUid: string; email: string; notifyServiceHost?: string}) {
  const action: NotificationMutationAction = {
    type: 'set-config',
    email: input.email,
    createdAtMs: Date.now(),
  }
  updateAccountState(input.accountUid, (current) => ({
    ...current,
    snapshot: reduceNotificationState(current.snapshot, action),
    pendingActions: [...current.pendingActions, createQueuedAction(action)],
    lastSyncError: null,
  }))
  invalidateAllNotificationQueries(input.accountUid)
  scheduleSync(input.accountUid, 0, 'set-config')
  return toConfigResponse(input.accountUid, input.notifyServiceHost)
}

/** Queues a verification resend and applies it optimistically in the desktop store. */
export function resendLocalNotificationVerification(input: {accountUid: string; notifyServiceHost?: string}) {
  const action: NotificationMutationAction = {
    type: 'resend-config-verification',
    createdAtMs: Date.now(),
  }
  updateAccountState(input.accountUid, (current) => ({
    ...current,
    snapshot: reduceNotificationState(current.snapshot, action),
    pendingActions: [...current.pendingActions, createQueuedAction(action)],
    lastSyncError: null,
  }))
  invalidateAllNotificationQueries(input.accountUid)
  scheduleSync(input.accountUid, 0, 'resend-config-verification')
  return toConfigResponse(input.accountUid, input.notifyServiceHost)
}

/** Queues a config removal and applies it optimistically in the desktop store. */
export function removeLocalNotificationConfig(input: {accountUid: string; notifyServiceHost?: string}) {
  const action: NotificationMutationAction = {
    type: 'remove-config',
  }
  updateAccountState(input.accountUid, (current) => ({
    ...current,
    snapshot: reduceNotificationState(current.snapshot, action),
    pendingActions: [...current.pendingActions, createQueuedAction(action)],
    lastSyncError: null,
  }))
  invalidateAllNotificationQueries(input.accountUid)
  scheduleSync(input.accountUid, 0, 'remove-config')
  return toConfigResponse(input.accountUid, input.notifyServiceHost)
}

/** Forces an immediate desktop notification sync for one account. */
export async function syncNotificationsNow(input: {accountUid: string; notifyServiceHost?: string}) {
  return syncAccount(input.accountUid, input.notifyServiceHost)
}

/** Returns the unified desktop notification sync status used by the old inbox debug API. */
export function getNotificationIngestStatus() {
  return toIngestStatus()
}

async function syncAccount(accountUid: string, notifyServiceHost?: string): Promise<NotificationReadMutationResult> {
  const existing = syncInFlight.get(accountUid)
  if (existing) return existing
  const task = runSync(accountUid, notifyServiceHost).finally(() => {
    syncInFlight.delete(accountUid)
  })
  syncInFlight.set(accountUid, task)
  return task
}
