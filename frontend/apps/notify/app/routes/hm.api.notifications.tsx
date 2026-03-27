import {BadRequestError, cborApiAction} from '@/server-api'
import {applyNotificationActionsForAccount, getNotificationStateSnapshot} from '@/notification-state'
import {validateSignature} from '@/validate-signature'
import {resolveAccountId} from '@/verify-delegation'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const notificationMutationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mark-event-read'),
    eventId: z.string(),
    eventAtMs: z.number(),
  }),
  z.object({
    type: z.literal('mark-event-unread'),
    eventId: z.string(),
    eventAtMs: z.number(),
    otherLoadedEvents: z.array(
      z.object({
        eventId: z.string(),
        eventAtMs: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal('mark-all-read'),
    markAllReadAtMs: z.number(),
  }),
  z.object({
    type: z.literal('set-config'),
    email: z.string(),
    createdAtMs: z.number(),
  }),
  z.object({
    type: z.literal('resend-config-verification'),
    createdAtMs: z.number(),
  }),
  z.object({
    type: z.literal('remove-config'),
  }),
])

const notificationAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-notification-state'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
    beforeMs: z.number().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    action: z.literal('apply-notification-actions'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
    beforeMs: z.number().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    actions: z.array(notificationMutationActionSchema),
  }),
])

export type NotificationAction = z.infer<typeof notificationAction>

export const action = cborApiAction<NotificationAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const signerUid = base58btc.encode(signedPayload.signer)
  const now = Date.now()

  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    console.warn('[notifications] invalid signature', {
      signerUid,
      action: restPayload.action,
    })
    throw new BadRequestError('Invalid signature')
  }

  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    console.warn('[notifications] invalid request time', {
      signerUid,
      action: restPayload.action,
      requestTime: restPayload.time,
      now,
    })
    throw new BadRequestError('Request time invalid')
  }

  const accountId = await resolveAccountId(signedPayload.signer, signedPayload.accountUid)
  const page = {
    beforeMs: restPayload.beforeMs,
    limit: restPayload.limit,
  }

  if (restPayload.action === 'get-notification-state') {
    return getNotificationStateSnapshot(accountId, page)
  }

  if (restPayload.action === 'apply-notification-actions') {
    return applyNotificationActionsForAccount(accountId, restPayload.actions, page)
  }

  throw new BadRequestError('Invalid action')
})
