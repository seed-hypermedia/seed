import z from 'zod'
import {
  getLocalNotificationReadState,
  getLocalNotificationSyncStatus,
  handleNotifyServiceHostChanged,
  markAllNotificationsRead,
  markNotificationEventRead,
  markNotificationEventUnread,
  startNotificationReadBackgroundSync,
  syncNotificationsNow,
} from './app-notifications'
import {t} from './app-trpc'

export {handleNotifyServiceHostChanged, startNotificationReadBackgroundSync}

export const notificationReadApi = t.router({
  getLocalState: t.procedure.input(z.string()).query(async ({input}) => {
    return getLocalNotificationReadState(input)
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
      return markNotificationEventRead(input)
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
      return markNotificationEventUnread(input)
    }),
  markAllRead: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        markAllReadAtMs: z.number(),
      }),
    )
    .mutation(async ({input}) => {
      return markAllNotificationsRead(input)
    }),
  syncNow: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
        notifyServiceHost: z.string().optional(),
      }),
    )
    .mutation(async ({input}) => {
      return syncNotificationsNow(input)
    }),
  getSyncStatus: t.procedure.input(z.string()).query(async ({input}) => {
    return getLocalNotificationSyncStatus(input)
  }),
})
