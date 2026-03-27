import z from 'zod'
import {
  getLocalNotificationConfig,
  removeLocalNotificationConfig,
  resendLocalNotificationVerification,
  setLocalNotificationConfig,
} from './app-notifications'
import {t} from './app-trpc'

const notificationConfigInputSchema = z.object({
  accountUid: z.string(),
  notifyServiceHost: z.string().optional(),
})

export const notificationConfigApi = t.router({
  getConfig: t.procedure.input(notificationConfigInputSchema).query(async ({input}) => {
    return getLocalNotificationConfig(input.accountUid, input.notifyServiceHost)
  }),
  setConfig: t.procedure
    .input(
      notificationConfigInputSchema.extend({
        email: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      return setLocalNotificationConfig(input)
    }),
  resendVerification: t.procedure.input(notificationConfigInputSchema).mutation(async ({input}) => {
    return resendLocalNotificationVerification(input)
  }),
  removeConfig: t.procedure.input(notificationConfigInputSchema).mutation(async ({input}) => {
    return removeLocalNotificationConfig(input)
  }),
})
