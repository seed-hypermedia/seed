export type NotificationReadLikeState = {
  markAllReadAtMs: number | null
  readEvents: Array<{eventId: string; eventAtMs: number}>
}

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
