import {
  getNotificationReadState,
  mergeNotificationReadState,
  NotificationReadEvent,
  NotificationReadStateRow,
} from '@/db'
import {BadRequestError, cborApiAction} from '@/server-api'
import {validateSignature} from '@/validate-signature'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const notificationReadStateAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-notification-read-state'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
  z.object({
    action: z.literal('merge-notification-read-state'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    markAllReadAtMs: z.number().nullable(),
    readEvents: z.array(
      z.object({
        eventId: z.string(),
        eventAtMs: z.number(),
      }),
    ),
  }),
])

export type NotificationReadStateAction = z.infer<typeof notificationReadStateAction>

export type NotificationReadStateResponse = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: NotificationReadEvent[]
  updatedAt: string
}

function sanitizeReadEvents(readEvents: NotificationReadEvent[]) {
  return readEvents
    .filter((evt) => evt?.eventId && Number.isFinite(evt.eventAtMs))
    .map((evt) => ({
      eventId: evt.eventId,
      eventAtMs: Math.max(0, Math.floor(evt.eventAtMs)),
    }))
}

function toResponse(state: NotificationReadStateRow): NotificationReadStateResponse {
  return {
    accountId: state.accountId,
    markAllReadAtMs: state.markAllReadAtMs,
    readEvents: sanitizeReadEvents(state.readEvents),
    updatedAt: state.updatedAt,
  }
}

export const action = cborApiAction<NotificationReadStateAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    throw new BadRequestError('Invalid signature')
  }

  const now = Date.now()
  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    throw new BadRequestError('Request time invalid')
  }

  const accountId = base58btc.encode(signedPayload.signer)

  if (restPayload.action === 'get-notification-read-state') {
    const state = getNotificationReadState(accountId)
    return toResponse(state)
  }

  if (restPayload.action === 'merge-notification-read-state') {
    const state = mergeNotificationReadState(accountId, {
      markAllReadAtMs: restPayload.markAllReadAtMs,
      readEvents: sanitizeReadEvents(restPayload.readEvents),
    })
    return toResponse(state)
  }

  throw new BadRequestError('Invalid action')
})
