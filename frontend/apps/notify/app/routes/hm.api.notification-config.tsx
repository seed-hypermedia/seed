import {getNotificationConfig, setNotificationConfig} from '@/db'
import {BadRequestError, cborApiAction} from '@/server-api'
import {validateSignature} from '@/validate-signature'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const notificationConfigAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
  z.object({
    action: z.literal('set-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    email: z.string(),
  }),
])

export type NotificationConfigAction = z.infer<typeof notificationConfigAction>

export const action = cborApiAction<NotificationConfigAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    throw new BadRequestError('Invalid signature')
  }
  const accountId = base58btc.encode(signedPayload.signer)
  const now = Date.now()
  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    throw new BadRequestError('Request time invalid')
  }
  if (restPayload.action === 'get-notification-config') {
    const config = getNotificationConfig(accountId)
    return {
      accountId,
      email: config?.email ?? null,
    }
  }
  if (restPayload.action === 'set-notification-config') {
    setNotificationConfig(accountId, restPayload.email)
    return {success: true}
  }
  throw new BadRequestError('Invalid action')
})
