import {getNotificationsPage} from '@/db'
import {BadRequestError, cborApiAction} from '@/server-api'
import {validateSignature} from '@/validate-signature'
import {resolveAccountId} from '@/verify-delegation'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const notificationInboxAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('register-inbox'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
  }),
  z.object({
    action: z.literal('get-notification-inbox'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
    beforeMs: z.number().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
])

export type NotificationInboxAction = z.infer<typeof notificationInboxAction>

export const action = cborApiAction<NotificationInboxAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const signerUid = base58btc.encode(signedPayload.signer)
  const now = Date.now()

  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    console.warn('[notification-inbox] invalid signature', {
      signerUid,
      action: restPayload.action,
    })
    throw new BadRequestError('Invalid signature')
  }

  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    console.warn('[notification-inbox] invalid request time', {
      signerUid,
      action: restPayload.action,
      requestTime: restPayload.time,
      now,
    })
    throw new BadRequestError('Request time invalid')
  }

  const accountId = await resolveAccountId(signedPayload.signer, signedPayload.accountUid)

  if (restPayload.action === 'register-inbox') {
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
