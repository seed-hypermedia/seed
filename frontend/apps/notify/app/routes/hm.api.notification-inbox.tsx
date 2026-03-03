import {getNotificationsPage, registerInboxAccount} from '@/db'
import {BadRequestError, cborApiAction} from '@/server-api'
import {validateSignature} from '@/validate-signature'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const notificationInboxAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('register-inbox'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
  z.object({
    action: z.literal('get-notification-inbox'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    beforeMs: z.number().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
])

export type NotificationInboxAction = z.infer<typeof notificationInboxAction>

export const action = cborApiAction<NotificationInboxAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const accountId = base58btc.encode(signedPayload.signer)
  const now = Date.now()

  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    console.warn('[notification-inbox] invalid signature', {
      accountId,
      action: restPayload.action,
    })
    throw new BadRequestError('Invalid signature')
  }

  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    console.warn('[notification-inbox] invalid request time', {
      accountId,
      action: restPayload.action,
      requestTime: restPayload.time,
      now,
    })
    throw new BadRequestError('Request time invalid')
  }

  if (restPayload.action === 'register-inbox') {
    registerInboxAccount(accountId)
    return {registered: true}
  }

  if (restPayload.action === 'get-notification-inbox') {
    const result = getNotificationsPage(accountId, {
      beforeMs: restPayload.beforeMs,
      limit: restPayload.limit,
    })
    return {
      accountId,
      notifications: result.notifications,
      hasMore: result.hasMore,
      oldestEventAtMs: result.oldestEventAtMs,
    }
  }

  throw new BadRequestError('Invalid action')
})
