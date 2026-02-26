import {encode as cborEncode} from '@ipld/dag-cbor'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {queryKeys} from '@shm/shared/models/query-keys'
import {base58btc} from 'multiformats/bases/base58'
import z from 'zod'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import * as log from './logger'

const NOTIFICATION_READ_STATE_KEY = 'NotificationReadState-v001'
const NOTIFY_SERVICE_HOST_KEY = 'NotifyServiceHost'
const SYNC_INTERVAL_MS = 30_000
const SYNC_DEBOUNCE_MS = 1_000

type NotificationReadEvent = {
  eventId: string
  eventAtMs: number
}

type AccountNotificationReadState = {
  markAllReadAtMs: number | null
  stateUpdatedAtMs: number
  readEvents: Record<string, number>
  dirty: boolean
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

type NotificationReadStore = {
  version: 1
  accounts: Record<string, AccountNotificationReadState>
}

type NotificationReadStateResponse = {
  accountId: string
  markAllReadAtMs: number | null
  stateUpdatedAtMs: number
  readEvents: NotificationReadEvent[]
  updatedAt: string
}

type AccountStateView = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: NotificationReadEvent[]
  dirty: boolean
  lastSyncAtMs: number | null
  lastSyncError: string | null
}

type NotificationStateChange = {
  readStateChanged: boolean
  syncStatusChanged: boolean
}

type AccountStateMutationResult = AccountStateView & NotificationStateChange

function getNowMs() {
  return Date.now()
}

function getReadEventCount(state: AccountNotificationReadState) {
  return Object.keys(state.readEvents).length
}

function areReadEventsEqual(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const eventId of leftKeys) {
    if (left[eventId] !== right[eventId]) return false
  }
  return true
}

function hasAccountStateChanged(previous: AccountNotificationReadState, next: AccountNotificationReadState) {
  if (previous.markAllReadAtMs !== next.markAllReadAtMs) return true
  if (previous.stateUpdatedAtMs !== next.stateUpdatedAtMs) return true
  if (previous.dirty !== next.dirty) return true
  if (previous.lastSyncAtMs !== next.lastSyncAtMs) return true
  if (previous.lastSyncError !== next.lastSyncError) return true
  if (!areReadEventsEqual(previous.readEvents, next.readEvents)) return true
  return false
}

function hasReadStateChanged(previous: AccountNotificationReadState, next: AccountNotificationReadState) {
  if (previous.markAllReadAtMs !== next.markAllReadAtMs) return true
  if (!areReadEventsEqual(previous.readEvents, next.readEvents)) return true
  return false
}

function hasSyncStatusChanged(previous: AccountNotificationReadState, next: AccountNotificationReadState) {
  if (previous.dirty !== next.dirty) return true
  if (previous.lastSyncAtMs !== next.lastSyncAtMs) return true
  if (previous.lastSyncError !== next.lastSyncError) return true
  return false
}

function getStateChanges(
  previous: AccountNotificationReadState,
  next: AccountNotificationReadState,
): NotificationStateChange {
  return {
    readStateChanged: hasReadStateChanged(previous, next),
    syncStatusChanged: hasSyncStatusChanged(previous, next),
  }
}

function hasAnyStateChange(changes: NotificationStateChange) {
  return changes.readStateChanged || changes.syncStatusChanged
}

function invalidateNotificationReadQueries(accountUid: string, changes: NotificationStateChange) {
  if (changes.readStateChanged) {
    appInvalidateQueries([queryKeys.NOTIFICATION_READ_STATE, accountUid])
  }
  if (changes.syncStatusChanged) {
    appInvalidateQueries([queryKeys.NOTIFICATION_SYNC_STATUS, accountUid])
  }
}

function snapshotAccountState(accountUid: string): AccountNotificationReadState {
  const state = getOrCreateAccountState(accountUid)
  return {
    ...state,
    readEvents: {...state.readEvents},
  }
}

function loadStore(): NotificationReadStore {
  const raw = appStore.get(NOTIFICATION_READ_STATE_KEY) as NotificationReadStore | undefined
  if (raw?.version === 1 && raw.accounts && typeof raw.accounts === 'object') {
    // Sanitize each account's readEvents to ensure they're plain objects
    for (const [uid, state] of Object.entries(raw.accounts)) {
      if (!state || typeof state.readEvents !== 'object' || Array.isArray(state.readEvents)) {
        raw.accounts[uid] = {...state, readEvents: {}}
      }
      if (typeof state.stateUpdatedAtMs !== 'number') {
        raw.accounts[uid] = {...raw.accounts[uid], stateUpdatedAtMs: 0}
      }
    }
    return raw
  }
  return {version: 1, accounts: {}}
}

let store = loadStore()
const syncDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const syncInFlight = new Map<string, Promise<AccountStateMutationResult>>()
let syncIntervalHandle: ReturnType<typeof setInterval> | null = null
let hasStartedSyncLoop = false

function writeStore() {
  appStore.set(NOTIFICATION_READ_STATE_KEY, store)
}

function normalizeHost(host: string) {
  return host.replace(/\/$/, '')
}

function readEventsMapToList(readEvents: Record<string, number> | undefined | null): NotificationReadEvent[] {
  if (!readEvents || typeof readEvents !== 'object') return []
  return Object.entries(readEvents)
    .filter(([, eventAtMs]) => Number.isFinite(eventAtMs))
    .map(([eventId, eventAtMs]) => ({
      eventId,
      eventAtMs: Math.max(0, Math.floor(eventAtMs)),
    }))
    .sort((a, b) => b.eventAtMs - a.eventAtMs || a.eventId.localeCompare(b.eventId))
}

function readEventsListToMap(readEvents: NotificationReadEvent[] | undefined | null): Record<string, number> {
  const next: Record<string, number> = {}
  if (!Array.isArray(readEvents)) return next
  for (const evt of readEvents) {
    if (!evt?.eventId || !Number.isFinite(evt.eventAtMs)) continue
    const normalizedTime = Math.max(0, Math.floor(evt.eventAtMs))
    const current = next[evt.eventId]
    next[evt.eventId] = current === undefined ? normalizedTime : Math.max(current, normalizedTime)
  }
  return next
}

function pruneReadEvents(readEvents: Record<string, number> | undefined | null, markAllReadAtMs: number | null) {
  if (!readEvents || typeof readEvents !== 'object') return {}
  if (markAllReadAtMs === null) return readEvents
  const next: Record<string, number> = {}
  for (const [eventId, eventAtMs] of Object.entries(readEvents)) {
    if (eventAtMs > markAllReadAtMs) {
      next[eventId] = eventAtMs
    }
  }
  return next
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function getOrCreateAccountState(accountUid: string): AccountNotificationReadState {
  let state = store.accounts[accountUid]
  if (state) return state

  state = {
    markAllReadAtMs: getNowMs(),
    stateUpdatedAtMs: getNowMs(),
    readEvents: {},
    dirty: true,
    lastSyncAtMs: null,
    lastSyncError: null,
  }
  store = {
    ...store,
    accounts: {
      ...store.accounts,
      [accountUid]: state,
    },
  }
  writeStore()
  log.info('Notification read-state account initialized', {
    accountUid,
    markAllReadAtMs: state.markAllReadAtMs,
    stateUpdatedAtMs: state.stateUpdatedAtMs,
    readEventsCount: getReadEventCount(state),
  })
  scheduleSync(accountUid, 0, 'init-account')
  return state
}

function toAccountStateView(accountUid: string): AccountStateView {
  const state = getOrCreateAccountState(accountUid)
  return {
    accountId: accountUid,
    markAllReadAtMs: state.markAllReadAtMs,
    readEvents: readEventsMapToList(state.readEvents),
    dirty: state.dirty,
    lastSyncAtMs: state.lastSyncAtMs,
    lastSyncError: state.lastSyncError,
  }
}

function toAccountMutationResult(accountUid: string, changes: NotificationStateChange): AccountStateMutationResult {
  return {
    ...toAccountStateView(accountUid),
    ...changes,
  }
}

function updateAccountState(
  accountUid: string,
  updater: (current: AccountNotificationReadState) => AccountNotificationReadState,
) {
  const current = getOrCreateAccountState(accountUid)
  const next = updater(current)
  if (!hasAccountStateChanged(current, next)) {
    return current
  }
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

function getNotifyServiceHostDefault(): string | null {
  const stored = appStore.get(NOTIFY_SERVICE_HOST_KEY) as string | undefined
  const host = stored !== undefined ? stored : NOTIFY_SERVICE_HOST
  if (!host) return null
  const trimmed = host.trim()
  if (!trimmed) return null
  return trimmed
}

async function signedNotificationReadStatePost(accountUid: string, host: string, payload: Record<string, unknown>) {
  const signerPublicKey = new Uint8Array(base58btc.decode(accountUid))
  const unsigned = {
    ...payload,
    signer: signerPublicKey,
    time: getNowMs(),
  }
  const encoded = cborEncode(unsigned)

  let signed
  try {
    signed = await grpcClient.daemon.signData({
      signingKeyName: accountUid,
      data: new Uint8Array(encoded),
    })
  } catch (err) {
    throw new NotificationSyncError('Local daemon is not available.', err)
  }

  const body = cborEncode({
    ...unsigned,
    sig: new Uint8Array(signed.signature),
  })

  let response: Response
  try {
    response = await fetch(`${normalizeHost(host)}/hm/api/notification-read-state`, {
      method: 'POST',
      body: Buffer.from(body),
      headers: {'Content-Type': 'application/cbor'},
    })
  } catch (err) {
    throw new NotificationSyncError('You are not connected to the notification server.', err)
  }

  const json = await response.json()
  if (!response.ok) {
    throw new Error(json?.error || 'Notification read-state request failed')
  }
  const result = json as NotificationReadStateResponse
  // Ensure readEvents is always an array even if server returns unexpected shape
  if (!Array.isArray(result.readEvents)) {
    result.readEvents = []
  }
  return result
}

function mergeLocalAndRemoteState(
  local: AccountNotificationReadState,
  remote: NotificationReadStateResponse,
): {markAllReadAtMs: number | null; stateUpdatedAtMs: number; readEvents: NotificationReadEvent[]} {
  // LWW: most recent stateUpdatedAtMs wins; tie falls back to max watermark
  let mergedMarkAllReadAtMs: number | null
  if (local.stateUpdatedAtMs > remote.stateUpdatedAtMs) {
    mergedMarkAllReadAtMs = local.markAllReadAtMs
  } else if (remote.stateUpdatedAtMs > local.stateUpdatedAtMs) {
    mergedMarkAllReadAtMs = remote.markAllReadAtMs
  } else {
    mergedMarkAllReadAtMs = maxNullable(local.markAllReadAtMs, remote.markAllReadAtMs)
  }
  const mergedWatermarkUpdatedAtMs = Math.max(local.stateUpdatedAtMs, remote.stateUpdatedAtMs)

  const remoteEvents = Array.isArray(remote?.readEvents) ? remote.readEvents : []

  // Start with local readEvents as base (reflects user's latest intent)
  const mergedReadEventsMap = {...local.readEvents}

  // When local state is at least as new as remote (stateUpdatedAtMs is bumped
  // on ALL local changes, not just watermark moves), local readEvents are authoritative.
  // Don't re-add remote events above local watermark that local doesn't have —
  // they were either never needed or deliberately removed (marked unread).
  const localIsAuthoritative = local.stateUpdatedAtMs >= remote.stateUpdatedAtMs

  for (const evt of remoteEvents) {
    const normalized = Math.max(0, Math.floor(evt.eventAtMs))
    if (
      localIsAuthoritative &&
      local.markAllReadAtMs !== null &&
      normalized > local.markAllReadAtMs &&
      !(evt.eventId in local.readEvents)
    ) {
      continue
    }
    const current = mergedReadEventsMap[evt.eventId]
    mergedReadEventsMap[evt.eventId] = current === undefined ? normalized : Math.max(current, normalized)
  }

  const prunedReadEvents = pruneReadEvents(mergedReadEventsMap, mergedMarkAllReadAtMs)

  return {
    markAllReadAtMs: mergedMarkAllReadAtMs,
    stateUpdatedAtMs: mergedWatermarkUpdatedAtMs,
    readEvents: readEventsMapToList(prunedReadEvents),
  }
}

function updateSyncError(accountUid: string, error: string) {
  updateAccountState(accountUid, (current) => ({
    ...current,
    dirty: true,
    lastSyncError: error,
  }))
}

class NotificationSyncError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly originalError: unknown,
  ) {
    super(userMessage)
    this.name = 'NotificationSyncError'
  }
}

async function runSync(accountUid: string, notifyServiceHost: string | undefined): Promise<AccountStateMutationResult> {
  const localStateBeforeSync = snapshotAccountState(accountUid)
  const host = notifyServiceHost || getNotifyServiceHostDefault()
  if (!host) {
    const message = 'Notify service host is not configured'
    updateSyncError(accountUid, message)
    const localStateAfterSync = snapshotAccountState(accountUid)
    const changes = getStateChanges(localStateBeforeSync, localStateAfterSync)
    if (hasAnyStateChange(changes)) {
      invalidateNotificationReadQueries(accountUid, changes)
    }
    return toAccountMutationResult(accountUid, changes)
  }

  const syncStart = getNowMs()
  log.info('Notification read-state sync started', {
    accountUid,
    host,
    dirty: localStateBeforeSync.dirty,
    localMarkAllReadAtMs: localStateBeforeSync.markAllReadAtMs,
    localStateUpdatedAtMs: localStateBeforeSync.stateUpdatedAtMs,
    localReadEventsCount: getReadEventCount(localStateBeforeSync),
  })

  try {
    const remoteState = await signedNotificationReadStatePost(accountUid, host, {
      action: 'get-notification-read-state',
    })
    log.info('Notification read-state sync fetched remote snapshot', {
      accountUid,
      host,
      remoteMarkAllReadAtMs: remoteState.markAllReadAtMs,
      remoteStateUpdatedAtMs: remoteState.stateUpdatedAtMs,
      remoteReadEventsCount: remoteState.readEvents.length,
    })
    // Snapshot AFTER the GET so we merge with the freshest local state.
    // Any user changes during the GET are captured here.
    const localState = getOrCreateAccountState(accountUid)
    const mergedInput = mergeLocalAndRemoteState(localState, remoteState)
    log.info('Notification read-state sync posting merged payload', {
      accountUid,
      host,
      mergedMarkAllReadAtMs: mergedInput.markAllReadAtMs,
      mergedStateUpdatedAtMs: mergedInput.stateUpdatedAtMs,
      mergedReadEventsCount: mergedInput.readEvents.length,
    })
    const mergedRemote = await signedNotificationReadStatePost(accountUid, host, {
      action: 'merge-notification-read-state',
      markAllReadAtMs: mergedInput.markAllReadAtMs,
      stateUpdatedAtMs: mergedInput.stateUpdatedAtMs,
      readEvents: mergedInput.readEvents,
    })
    log.info('Notification read-state sync merge acknowledged by server', {
      accountUid,
      host,
      serverMarkAllReadAtMs: mergedRemote.markAllReadAtMs,
      serverStateUpdatedAtMs: mergedRemote.stateUpdatedAtMs,
      serverReadEventsCount: mergedRemote.readEvents.length,
    })

    updateAccountState(accountUid, (current) => {
      // Re-merge server response with current local state to preserve
      // any changes the user made while the POST was in flight.
      // Since stateUpdatedAtMs is bumped on ALL local changes, the merge
      // naturally skips stale remote readEvents when local is newer.
      const reMerged = mergeLocalAndRemoteState(current, mergedRemote)
      const stateChangedDuringSync = current.stateUpdatedAtMs !== localState.stateUpdatedAtMs
      return {
        markAllReadAtMs: reMerged.markAllReadAtMs,
        stateUpdatedAtMs: reMerged.stateUpdatedAtMs,
        readEvents: pruneReadEvents(readEventsListToMap(reMerged.readEvents), reMerged.markAllReadAtMs),
        dirty: stateChangedDuringSync,
        lastSyncAtMs: syncStart,
        lastSyncError: null,
      }
    })

    const currentState = getOrCreateAccountState(accountUid)
    if (currentState.dirty) {
      scheduleSync(accountUid, SYNC_DEBOUNCE_MS, 'dirty-after-sync')
    }

    log.info('Notification read-state sync completed', {
      accountUid,
      host,
      localDirtyAfterSync: currentState.dirty,
      localMarkAllReadAtMs: currentState.markAllReadAtMs,
      localStateUpdatedAtMs: currentState.stateUpdatedAtMs,
      localReadEventsCount: getReadEventCount(currentState),
      mergedEvents: mergedRemote.readEvents.length,
    })
  } catch (error: any) {
    const message = error instanceof NotificationSyncError ? error.userMessage : error?.message || String(error)
    updateSyncError(accountUid, message)
    log.warn('Notification read-state sync failed', {
      accountUid,
      host,
      error: message,
      originalError: error instanceof NotificationSyncError ? String(error.originalError) : undefined,
    })
  }

  const localStateAfterSync = snapshotAccountState(accountUid)
  const changes = getStateChanges(localStateBeforeSync, localStateAfterSync)
  if (hasAnyStateChange(changes)) {
    invalidateNotificationReadQueries(accountUid, changes)
  }
  return toAccountMutationResult(accountUid, changes)
}

function scheduleSync(accountUid: string, delayMs: number = SYNC_DEBOUNCE_MS, reason: string = 'unspecified') {
  const existing = syncDebounceTimers.get(accountUid)
  if (existing) clearTimeout(existing)
  log.debug('Notification read-state sync scheduled', {
    accountUid,
    reason,
    delayMs,
    hadExistingTimer: Boolean(existing),
  })
  const handle = setTimeout(() => {
    syncDebounceTimers.delete(accountUid)
    void syncAccount(accountUid)
  }, delayMs)
  syncDebounceTimers.set(accountUid, handle)
}

function syncAllAccountsInBackground() {
  const accountUids = Object.keys(store.accounts)
  log.debug('Notification read-state background sync tick', {
    accountCount: accountUids.length,
  })
  for (const accountUid of accountUids) {
    void syncAccount(accountUid)
  }
}

export function startNotificationReadBackgroundSync() {
  if (hasStartedSyncLoop) return
  hasStartedSyncLoop = true
  log.info('Notification read-state background sync starting', {
    syncIntervalMs: SYNC_INTERVAL_MS,
    accountCount: Object.keys(store.accounts).length,
  })

  if (!syncIntervalHandle) {
    syncIntervalHandle = setInterval(syncAllAccountsInBackground, SYNC_INTERVAL_MS)
  }

  for (const accountUid of Object.keys(store.accounts)) {
    void syncAccount(accountUid)
  }
}

async function syncAccount(accountUid: string, notifyServiceHost?: string): Promise<AccountStateMutationResult> {
  const existing = syncInFlight.get(accountUid)
  if (existing) return existing

  const task = runSync(accountUid, notifyServiceHost).finally(() => {
    syncInFlight.delete(accountUid)
  })
  syncInFlight.set(accountUid, task)
  return task
}

export function handleNotifyServiceHostChanged(notifyServiceHost: string) {
  const trimmedHost = notifyServiceHost.trim()
  const host = trimmedHost ? trimmedHost : undefined
  const accountUids = Object.keys(store.accounts)
  if (!accountUids.length) return

  log.info('Notification read-state host changed, scheduling sync for known accounts', {
    accountCount: accountUids.length,
    host: host ?? null,
  })

  for (const accountUid of accountUids) {
    const existing = syncInFlight.get(accountUid)
    if (existing) {
      void existing.finally(() => {
        void syncAccount(accountUid, host)
      })
      continue
    }
    void syncAccount(accountUid, host)
  }
}

function markEventRead(input: {accountUid: string; eventId: string; eventAtMs: number}): AccountStateMutationResult {
  const previousState = snapshotAccountState(input.accountUid)
  const nextState = updateAccountState(input.accountUid, (current) => {
    const eventAtMs = Math.max(0, Math.floor(input.eventAtMs))
    if (current.markAllReadAtMs !== null && eventAtMs <= current.markAllReadAtMs) {
      return current
    }
    const currentEventAtMs = current.readEvents[input.eventId]
    if (currentEventAtMs !== undefined && currentEventAtMs >= eventAtMs) {
      return current
    }
    const nextEventAtMs = currentEventAtMs === undefined ? eventAtMs : Math.max(currentEventAtMs, eventAtMs)
    return {
      ...current,
      readEvents: {
        ...current.readEvents,
        [input.eventId]: nextEventAtMs,
      },
      stateUpdatedAtMs: getNowMs(),
      dirty: true,
      lastSyncError: null,
    }
  })
  const changes = getStateChanges(previousState, nextState)
  if (hasAnyStateChange(changes)) {
    log.info('Notification read-state marked event read locally', {
      accountUid: input.accountUid,
      eventId: input.eventId,
      eventAtMs: input.eventAtMs,
      localMarkAllReadAtMs: nextState.markAllReadAtMs,
      localStateUpdatedAtMs: nextState.stateUpdatedAtMs,
      localReadEventsCount: getReadEventCount(nextState),
    })
    scheduleSync(input.accountUid, SYNC_DEBOUNCE_MS, 'mark-event-read')
  }
  return toAccountMutationResult(input.accountUid, changes)
}

function markEventUnread(input: {
  accountUid: string
  eventId: string
  eventAtMs: number
  otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
}): AccountStateMutationResult {
  const previousState = snapshotAccountState(input.accountUid)
  const nextState = updateAccountState(input.accountUid, (current) => {
    const targetAtMs = Math.max(0, Math.floor(input.eventAtMs))
    // If event is individually read (not covered by watermark), just remove it
    if (current.markAllReadAtMs === null || targetAtMs > current.markAllReadAtMs) {
      if (!(input.eventId in current.readEvents)) {
        return current
      }
      const {[input.eventId]: _, ...restReadEvents} = current.readEvents
      return {...current, readEvents: restReadEvents, stateUpdatedAtMs: getNowMs(), dirty: true, lastSyncError: null}
    }
    // Event is covered by watermark — lower watermark and mark other events individually
    const newWatermark = targetAtMs - 1
    const newReadEvents = {...current.readEvents}
    delete newReadEvents[input.eventId]
    for (const other of input.otherLoadedEvents) {
      if (other.eventId === input.eventId) continue
      const otherAtMs = Math.max(0, Math.floor(other.eventAtMs))
      if (otherAtMs <= current.markAllReadAtMs && otherAtMs > newWatermark) {
        const existing = newReadEvents[other.eventId]
        newReadEvents[other.eventId] = existing === undefined ? otherAtMs : Math.max(existing, otherAtMs)
      }
    }
    return {
      ...current,
      markAllReadAtMs: newWatermark,
      readEvents: newReadEvents,
      stateUpdatedAtMs: getNowMs(),
      dirty: true,
      lastSyncError: null,
    }
  })
  const changes = getStateChanges(previousState, nextState)
  if (hasAnyStateChange(changes)) {
    log.info('Notification read-state marked event unread locally', {
      accountUid: input.accountUid,
      eventId: input.eventId,
      eventAtMs: input.eventAtMs,
      localMarkAllReadAtMs: nextState.markAllReadAtMs,
      localStateUpdatedAtMs: nextState.stateUpdatedAtMs,
      localReadEventsCount: getReadEventCount(nextState),
    })
    scheduleSync(input.accountUid, SYNC_DEBOUNCE_MS, 'mark-event-unread')
  }
  return toAccountMutationResult(input.accountUid, changes)
}

function markAllRead(input: {accountUid: string; markAllReadAtMs: number}): AccountStateMutationResult {
  const previousState = snapshotAccountState(input.accountUid)
  const nextState = updateAccountState(input.accountUid, (current) => {
    const nowMs = getNowMs()
    const nextMarkAllReadAtMs = Math.max(current.markAllReadAtMs ?? 0, Math.floor(input.markAllReadAtMs || 0), nowMs)
    const nextReadEvents = pruneReadEvents(current.readEvents, nextMarkAllReadAtMs)
    if (
      nextMarkAllReadAtMs === current.markAllReadAtMs &&
      current.dirty &&
      current.lastSyncError === null &&
      areReadEventsEqual(current.readEvents, nextReadEvents)
    ) {
      return current
    }
    return {
      ...current,
      markAllReadAtMs: nextMarkAllReadAtMs,
      stateUpdatedAtMs: nowMs,
      readEvents: nextReadEvents,
      dirty: true,
      lastSyncError: null,
    }
  })
  const changes = getStateChanges(previousState, nextState)
  if (hasAnyStateChange(changes)) {
    log.info('Notification read-state marked all read locally', {
      accountUid: input.accountUid,
      requestedMarkAllReadAtMs: input.markAllReadAtMs,
      localMarkAllReadAtMs: nextState.markAllReadAtMs,
      localStateUpdatedAtMs: nextState.stateUpdatedAtMs,
      localReadEventsCount: getReadEventCount(nextState),
    })
    scheduleSync(input.accountUid, SYNC_DEBOUNCE_MS, 'mark-all-read')
  }
  return toAccountMutationResult(input.accountUid, changes)
}

export const notificationReadApi = t.router({
  getLocalState: t.procedure.input(z.string()).query(async ({input}) => {
    return toAccountStateView(input)
  }),
  markEventRead: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        eventId: z.string(),
        eventAtMs: z.number(),
      }),
    )
    .mutation(async ({input}) => {
      return markEventRead(input)
    }),
  markEventUnread: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        eventId: z.string(),
        eventAtMs: z.number(),
        otherLoadedEvents: z.array(
          z.object({
            eventId: z.string(),
            eventAtMs: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      return markEventUnread(input)
    }),
  markAllRead: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        markAllReadAtMs: z.number(),
      }),
    )
    .mutation(async ({input}) => {
      return markAllRead(input)
    }),
  syncNow: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        notifyServiceHost: z.string().optional(),
      }),
    )
    .mutation(async ({input}) => {
      return syncAccount(input.accountUid, input.notifyServiceHost)
    }),
  getSyncStatus: t.procedure.input(z.string()).query(async ({input}) => {
    const state = getOrCreateAccountState(input)
    return {
      accountId: input,
      dirty: state.dirty,
      lastSyncAtMs: state.lastSyncAtMs,
      lastSyncError: state.lastSyncError,
    }
  }),
})
