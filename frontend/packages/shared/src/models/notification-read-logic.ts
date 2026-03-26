/**
 * Pure logic for determining whether a notification event has been read.
 * No framework dependencies — usable on any platform.
 */

/** Minimal shape of the read state needed for read checks. */
export type NotificationReadLikeState = {
  markAllReadAtMs: number | null
  readEvents: Array<{eventId: string; eventAtMs: number}>
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
