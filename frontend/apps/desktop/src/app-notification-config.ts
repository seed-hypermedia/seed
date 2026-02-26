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

const NOTIFY_SERVICE_HOST_KEY = 'NotifyServiceHost'

const notificationConfigResponseSchema = z.object({
  accountId: z.string(),
  email: z.string().nullable(),
  verifiedTime: z.string().nullable(),
  verificationSendTime: z.string().nullable(),
  verificationExpired: z.boolean(),
})

const notificationConfigMutationResponseSchema = notificationConfigResponseSchema.extend({
  success: z.boolean().optional(),
})

type NotificationConfigAction =
  | {action: 'get-notification-config'}
  | {action: 'set-notification-config'; email: string}
  | {action: 'resend-notification-config-verification'}
  | {action: 'remove-notification-config'}

function normalizeHost(host: string) {
  return host.replace(/\/$/, '')
}

function getNotifyServiceHostDefault(): string | null {
  const stored = appStore.get(NOTIFY_SERVICE_HOST_KEY) as string | undefined
  const host = stored !== undefined ? stored : NOTIFY_SERVICE_HOST
  if (!host) return null
  const trimmed = host.trim()
  if (!trimmed) return null
  return trimmed
}

function resolveNotifyHost(notifyServiceHost: string | undefined): string {
  const host = notifyServiceHost?.trim() || getNotifyServiceHostDefault()
  if (!host) {
    throw new Error('Notify service host is not configured')
  }
  return host
}

function invalidateNotificationConfigQueries(accountUid: string, notifyServiceHost: string) {
  appInvalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountUid])
}

async function signedNotificationConfigPost(accountUid: string, host: string, payload: NotificationConfigAction) {
  const signerPublicKey = new Uint8Array(base58btc.decode(accountUid))
  const unsigned = {
    ...payload,
    signer: signerPublicKey,
    time: Date.now(),
  }
  const encoded = cborEncode(unsigned)

  let signed
  try {
    signed = await grpcClient.daemon.signData({
      signingKeyName: accountUid,
      data: new Uint8Array(encoded),
    })
  } catch (error) {
    throw new Error('Local daemon is not available.')
  }

  const body = cborEncode({
    ...unsigned,
    sig: new Uint8Array(signed.signature),
  })

  let response: Response
  try {
    response = await fetch(`${normalizeHost(host)}/hm/api/notification-config`, {
      method: 'POST',
      body: Buffer.from(body),
      headers: {'Content-Type': 'application/cbor'},
    })
  } catch (error) {
    throw new Error('You are not connected to the notification server.')
  }

  let json: unknown = null
  try {
    json = await response.json()
  } catch (error) {
    // Ignore invalid JSON body and fall back to generic errors.
  }

  if (!response.ok) {
    if (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string') {
      throw new Error(json.error)
    }
    throw new Error(`Notification config request failed (${response.status})`)
  }

  return json
}

const notificationConfigInputSchema = z.object({
  accountUid: z.string(),
  notifyServiceHost: z.string().optional(),
})

export const notificationConfigApi = t.router({
  getConfig: t.procedure.input(notificationConfigInputSchema).query(async ({input}) => {
    const notifyServiceHost = resolveNotifyHost(input.notifyServiceHost)
    const response = await signedNotificationConfigPost(input.accountUid, notifyServiceHost, {
      action: 'get-notification-config',
    })
    return notificationConfigResponseSchema.parse(response)
  }),
  setConfig: t.procedure
    .input(
      notificationConfigInputSchema.extend({
        email: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      const notifyServiceHost = resolveNotifyHost(input.notifyServiceHost)
      const response = await signedNotificationConfigPost(input.accountUid, notifyServiceHost, {
        action: 'set-notification-config',
        email: input.email,
      })
      const config = notificationConfigMutationResponseSchema.parse(response)
      invalidateNotificationConfigQueries(input.accountUid, notifyServiceHost)
      return config
    }),
  resendVerification: t.procedure.input(notificationConfigInputSchema).mutation(async ({input}) => {
    const notifyServiceHost = resolveNotifyHost(input.notifyServiceHost)
    const response = await signedNotificationConfigPost(input.accountUid, notifyServiceHost, {
      action: 'resend-notification-config-verification',
    })
    const config = notificationConfigMutationResponseSchema.parse(response)
    invalidateNotificationConfigQueries(input.accountUid, notifyServiceHost)
    return config
  }),
  removeConfig: t.procedure.input(notificationConfigInputSchema).mutation(async ({input}) => {
    const notifyServiceHost = resolveNotifyHost(input.notifyServiceHost)
    const response = await signedNotificationConfigPost(input.accountUid, notifyServiceHost, {
      action: 'remove-notification-config',
    })
    const config = notificationConfigMutationResponseSchema.parse(response)
    invalidateNotificationConfigQueries(input.accountUid, notifyServiceHost)
    return config
  }),
})
