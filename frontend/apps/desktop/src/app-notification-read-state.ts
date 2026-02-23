import {encode as cborEncode} from '@ipld/dag-cbor'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {base58btc} from 'multiformats/bases/base58'
import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {grpcClient} from './app-grpc'
import * as log from './logger'
import {t} from './app-trpc'

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

function getNowMs() {
  return Date.now()
}

function loadStore(): NotificationReadStore {
  const raw = appStore.get(NOTIFICATION_READ_STATE_KEY) as NotificationReadStore | undefined
  if (raw?.version === 1 && raw.accounts && typeof raw.accounts === 'object') {
    // Sanitize each account's readEvents to ensure it's a plain object
    for (const [uid, state] of Object.entries(raw.accounts)) {
      if (!state || typeof state.readEvents !== 'object' || Array.isArray(state.readEvents)) {
        raw.accounts[uid] = {...state, readEvents: {}}
      }
    }
    return raw
  }
  return {version: 1, accounts: {}}
}

let store = loadStore()
const syncDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const syncInFlight = new Map<string, Promise<AccountStateView>>()
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
  scheduleSync(accountUid, 0)
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

function updateAccountState(
  accountUid: string,
  updater: (current: AccountNotificationReadState) => AccountNotificationReadState,
) {
  const current = getOrCreateAccountState(accountUid)
  const next = updater(current)
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
  const signed = await grpcClient.daemon.signData({
    signingKeyName: accountUid,
    data: new Uint8Array(encoded),
  })
  const body = cborEncode({
    ...unsigned,
    sig: new Uint8Array(signed.signature),
  })
  const response = await fetch(`${normalizeHost(host)}/hm/api/notification-read-state`, {
    method: 'POST',
    body,
    headers: {'Content-Type': 'application/cbor'},
  })
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
): {markAllReadAtMs: number | null; readEvents: NotificationReadEvent[]} {
  const mergedMarkAllReadAtMs = maxNullable(local.markAllReadAtMs, remote.markAllReadAtMs)
  const remoteEvents = Array.isArray(remote?.readEvents) ? remote.readEvents : []

  const mergedReadEventsMap = {
    ...readEventsListToMap(remoteEvents),
    ...local.readEvents,
  }

  for (const evt of remoteEvents) {
    const current = mergedReadEventsMap[evt.eventId]
    const normalized = Math.max(0, Math.floor(evt.eventAtMs))
    mergedReadEventsMap[evt.eventId] = current === undefined ? normalized : Math.max(current, normalized)
  }

  const prunedReadEvents = pruneReadEvents(mergedReadEventsMap, mergedMarkAllReadAtMs)

  return {
    markAllReadAtMs: mergedMarkAllReadAtMs,
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

async function runSync(accountUid: string, notifyServiceHost: string | undefined): Promise<AccountStateView> {
  const host = notifyServiceHost || getNotifyServiceHostDefault()
  if (!host) {
    const message = 'Notify service host is not configured'
    updateSyncError(accountUid, message)
    return toAccountStateView(accountUid)
  }

  const localState = getOrCreateAccountState(accountUid)
  const syncStart = getNowMs()

  try {
    const remoteState = await signedNotificationReadStatePost(accountUid, host, {
      action: 'get-notification-read-state',
    })
    const mergedInput = mergeLocalAndRemoteState(localState, remoteState)
    const mergedRemote = await signedNotificationReadStatePost(accountUid, host, {
      action: 'merge-notification-read-state',
      markAllReadAtMs: mergedInput.markAllReadAtMs,
      readEvents: mergedInput.readEvents,
    })

    updateAccountState(accountUid, () => ({
      markAllReadAtMs: mergedRemote.markAllReadAtMs,
      readEvents: pruneReadEvents(readEventsListToMap(mergedRemote.readEvents), mergedRemote.markAllReadAtMs),
      dirty: false,
      lastSyncAtMs: syncStart,
      lastSyncError: null,
    }))

    log.info('Notification read-state sync completed', {
      accountUid,
      host,
      mergedEvents: mergedRemote.readEvents.length,
    })
  } catch (error: any) {
    const message = error?.message || String(error)
    updateSyncError(accountUid, message)
    log.warn('Notification read-state sync failed', {
      accountUid,
      host,
      error: message,
    })
  }

  return toAccountStateView(accountUid)
}

function scheduleSync(accountUid: string, delayMs: number = SYNC_DEBOUNCE_MS) {
  const existing = syncDebounceTimers.get(accountUid)
  if (existing) clearTimeout(existing)
  const handle = setTimeout(() => {
    syncDebounceTimers.delete(accountUid)
    void syncAccount(accountUid)
  }, delayMs)
  syncDebounceTimers.set(accountUid, handle)
}

function syncDirtyAccountsInBackground() {
  for (const [accountUid, accountState] of Object.entries(store.accounts)) {
    if (!accountState.dirty) continue
    void syncAccount(accountUid)
  }
}

export function startNotificationReadBackgroundSync() {
  if (hasStartedSyncLoop) return
  hasStartedSyncLoop = true

  if (!syncIntervalHandle) {
    syncIntervalHandle = setInterval(syncDirtyAccountsInBackground, SYNC_INTERVAL_MS)
  }

  for (const accountUid of Object.keys(store.accounts)) {
    void syncAccount(accountUid)
  }
}

async function syncAccount(accountUid: string, notifyServiceHost?: string): Promise<AccountStateView> {
  const existing = syncInFlight.get(accountUid)
  if (existing) return existing

  const task = runSync(accountUid, notifyServiceHost).finally(() => {
    syncInFlight.delete(accountUid)
  })
  syncInFlight.set(accountUid, task)
  return task
}

function markEventRead(input: {accountUid: string; eventId: string; eventAtMs: number}) {
  updateAccountState(input.accountUid, (current) => {
    const eventAtMs = Math.max(0, Math.floor(input.eventAtMs))
    if (current.markAllReadAtMs !== null && eventAtMs <= current.markAllReadAtMs) {
      return current
    }
    const currentEventAtMs = current.readEvents[input.eventId]
    const nextEventAtMs = currentEventAtMs === undefined ? eventAtMs : Math.max(currentEventAtMs, eventAtMs)
    return {
      ...current,
      readEvents: {
        ...current.readEvents,
        [input.eventId]: nextEventAtMs,
      },
      dirty: true,
      lastSyncError: null,
    }
  })
  scheduleSync(input.accountUid)
  return toAccountStateView(input.accountUid)
}

function markAllRead(input: {accountUid: string; markAllReadAtMs: number}) {
  updateAccountState(input.accountUid, (current) => {
    const nextMarkAllReadAtMs = Math.max(
      current.markAllReadAtMs ?? 0,
      Math.floor(input.markAllReadAtMs || 0),
      getNowMs(),
    )
    return {
      ...current,
      markAllReadAtMs: nextMarkAllReadAtMs,
      readEvents: pruneReadEvents(current.readEvents, nextMarkAllReadAtMs),
      dirty: true,
      lastSyncError: null,
    }
  })
  scheduleSync(input.accountUid)
  return toAccountStateView(input.accountUid)
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
