/**
 * Pure logic for determining whether a notification event has been read.
 * No framework dependencies — usable on any platform.
 */

/** Minimal shape of the read state needed for read checks. */
export type NotificationReadLikeState = {
  markAllReadAtMs: number | null
  readEvents: Array<{eventId: string; eventAtMs: number}>
}

function normalizeEventAtMs(eventAtMs: number) {
  return Math.max(0, Math.floor(eventAtMs))
}

function readEventsToMap(readEvents: NotificationReadLikeState['readEvents']) {
  const map: Record<string, number> = {}

  for (const evt of readEvents) {
    if (!evt?.eventId || !Number.isFinite(evt.eventAtMs)) continue
    const normalizedEventAtMs = normalizeEventAtMs(evt.eventAtMs)
    const existingEventAtMs = map[evt.eventId]
    map[evt.eventId] =
      existingEventAtMs === undefined ? normalizedEventAtMs : Math.max(existingEventAtMs, normalizedEventAtMs)
  }

  return map
}

function readEventsFromMap(readEvents: Record<string, number>, markAllReadAtMs: number | null) {
  return Object.entries(readEvents)
    .filter(([, eventAtMs]) => markAllReadAtMs === null || eventAtMs > markAllReadAtMs)
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .map(([eventId, eventAtMs]) => ({
      eventId,
      eventAtMs,
    }))
}

// Read state is checked once per loaded notification, and per-space reads let the read events list grow, so look
// events up in a set built once per list. Read states are never mutated in place, so a list's set stays valid.
const readEventIdSets = new WeakMap<NotificationReadLikeState['readEvents'], Set<string>>()

function getReadEventIds(readEvents: NotificationReadLikeState['readEvents']) {
  let ids = readEventIdSets.get(readEvents)
  if (!ids) {
    ids = new Set(readEvents.map((evt) => evt.eventId))
    readEventIdSets.set(readEvents, ids)
  }
  return ids
}

/** Returns `true` when the given event should be considered read. */
export function isNotificationEventRead(input: {
  readState: NotificationReadLikeState | undefined
  eventId: string
  eventAtMs: number
}) {
  if (!input.readState) return false
  if (input.readState.markAllReadAtMs !== null && input.eventAtMs <= input.readState.markAllReadAtMs) {
    return true
  }
  return getReadEventIds(input.readState.readEvents).has(input.eventId)
}

/** Counts unread notifications per site, keyed by the account uid of the site each notification belongs to. */
export function countUnreadNotificationsBySite(
  notifications: Array<{feedEventId: string; eventAtMs: number; target: {uid: string}}>,
  readState: NotificationReadLikeState | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const notification of notifications) {
    if (isNotificationEventRead({readState, eventId: notification.feedEventId, eventAtMs: notification.eventAtMs})) {
      continue
    }
    counts[notification.target.uid] = (counts[notification.target.uid] ?? 0) + 1
  }
  return counts
}

/**
 * Returns the next read state after marking a single notification event as read.
 */
export function markNotificationEventReadInState(input: {
  readState: NotificationReadLikeState | undefined
  eventId: string
  eventAtMs: number
}): NotificationReadLikeState {
  const currentState = input.readState ?? {markAllReadAtMs: null, readEvents: []}
  const eventAtMs = normalizeEventAtMs(input.eventAtMs)

  if (currentState.markAllReadAtMs !== null && eventAtMs <= currentState.markAllReadAtMs) {
    return currentState
  }

  const readEvents = readEventsToMap(currentState.readEvents)
  const currentEventAtMs = readEvents[input.eventId]
  if (currentEventAtMs !== undefined && currentEventAtMs >= eventAtMs) {
    return currentState
  }

  readEvents[input.eventId] = currentEventAtMs === undefined ? eventAtMs : Math.max(currentEventAtMs, eventAtMs)

  return {
    markAllReadAtMs: currentState.markAllReadAtMs,
    readEvents: readEventsFromMap(readEvents, currentState.markAllReadAtMs),
  }
}

/**
 * Returns the next read state after marking a single notification event as unread.
 */
export function markNotificationEventUnreadInState(input: {
  readState: NotificationReadLikeState | undefined
  eventId: string
  eventAtMs: number
  otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
}): NotificationReadLikeState {
  const currentState = input.readState ?? {markAllReadAtMs: null, readEvents: []}
  const targetAtMs = normalizeEventAtMs(input.eventAtMs)
  const readEvents = readEventsToMap(currentState.readEvents)

  if (currentState.markAllReadAtMs === null || targetAtMs > currentState.markAllReadAtMs) {
    if (!(input.eventId in readEvents)) {
      return currentState
    }
    delete readEvents[input.eventId]
    return {
      markAllReadAtMs: currentState.markAllReadAtMs,
      readEvents: readEventsFromMap(readEvents, currentState.markAllReadAtMs),
    }
  }

  const newWatermark = targetAtMs - 1
  delete readEvents[input.eventId]

  for (const other of input.otherLoadedEvents) {
    if (other.eventId === input.eventId) continue
    const otherAtMs = normalizeEventAtMs(other.eventAtMs)
    if (otherAtMs <= currentState.markAllReadAtMs && otherAtMs > newWatermark) {
      const existingEventAtMs = readEvents[other.eventId]
      readEvents[other.eventId] = existingEventAtMs === undefined ? otherAtMs : Math.max(existingEventAtMs, otherAtMs)
    }
  }

  return {
    markAllReadAtMs: newWatermark,
    readEvents: readEventsFromMap(readEvents, newWatermark),
  }
}

/**
 * Whether a notification belongs to a site: its target document is owned by the site's account.
 * Without a site every notification matches. The notify server and the desktop inbox share this rule.
 */
export function notificationMatchesSite(notification: {target: {uid: string}}, siteUid?: string) {
  if (!siteUid) return true
  return notification.target.uid === siteUid
}

/**
 * Returns the next read state after marking each given notification as read, one event at a time.
 * Used for a site-scoped "mark all as read", where a global watermark would also cover other sites.
 */
export function markNotificationsReadInState<State extends NotificationReadLikeState>(
  readState: State,
  notifications: Array<{feedEventId: string; eventAtMs: number}>,
): State {
  let nextReadState = readState
  for (const notification of notifications) {
    if (
      isNotificationEventRead({
        readState: nextReadState,
        eventId: notification.feedEventId,
        eventAtMs: notification.eventAtMs,
      })
    ) {
      continue
    }
    nextReadState = {
      ...nextReadState,
      ...markNotificationEventReadInState({
        readState: nextReadState,
        eventId: notification.feedEventId,
        eventAtMs: notification.eventAtMs,
      }),
    }
  }
  return nextReadState
}

/**
 * Returns the next read state after marking all loaded notifications as read.
 */
export function markAllNotificationsReadInState(input: {
  readState: NotificationReadLikeState | undefined
  markAllReadAtMs: number
}): NotificationReadLikeState {
  const currentState = input.readState ?? {markAllReadAtMs: null, readEvents: []}
  const nextMarkAllReadAtMs = Math.max(currentState.markAllReadAtMs ?? 0, normalizeEventAtMs(input.markAllReadAtMs))
  const readEvents = readEventsToMap(currentState.readEvents)

  return {
    markAllReadAtMs: nextMarkAllReadAtMs,
    readEvents: readEventsFromMap(readEvents, nextMarkAllReadAtMs),
  }
}
