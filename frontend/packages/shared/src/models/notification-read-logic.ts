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
  return input.readState.readEvents.some((evt) => evt.eventId === input.eventId)
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
