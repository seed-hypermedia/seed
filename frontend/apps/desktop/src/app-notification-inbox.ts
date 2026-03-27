import z from 'zod'
import {
  getLocalNotificationInbox,
  getNotificationIngestStatus,
  runNotificationIngestPoll,
  startNotificationInboxBackgroundIngestor,
} from './app-notifications'
import {t} from './app-trpc'

export {runNotificationIngestPoll, startNotificationInboxBackgroundIngestor}

export const notificationInboxApi = t.router({
  getLocalInbox: t.procedure
    .input(
      z.object({
        accountUid: z.string(),
      }),
    )
    .query(async ({input}) => {
      return getLocalNotificationInbox(input.accountUid)
    }),
  getIngestStatus: t.procedure.query(async () => {
    return getNotificationIngestStatus()
  }),
})
