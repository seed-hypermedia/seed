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
    stateUpdatedAtMs: z.number(),
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
  stateUpdatedAtMs: number
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
    stateUpdatedAtMs: state.stateUpdatedAtMs,
    readEvents: sanitizeReadEvents(state.readEvents),
    updatedAt: state.updatedAt,
  }
}

export const action = cborApiAction<NotificationReadStateAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const accountId = base58btc.encode(signedPayload.signer)
  const now = Date.now()
  const requestAgeMs = now - restPayload.time

  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    console.warn('[notification-read-state] invalid signature', {
      accountId,
      action: restPayload.action,
      requestAgeMs,
    })
    throw new BadRequestError('Invalid signature')
  }

  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    console.warn('[notification-read-state] invalid request time', {
      accountId,
      action: restPayload.action,
      requestAgeMs,
      requestTime: restPayload.time,
      now,
    })
    throw new BadRequestError('Request time invalid')
  }

  // console.info('[notification-read-state] request accepted', {
  //   accountId,
  //   action: restPayload.action,
  //   requestAgeMs,
  // })

  if (restPayload.action === 'get-notification-read-state') {
    const state = getNotificationReadState(accountId)
    // console.info('[notification-read-state] get state', {
    //   accountId,
    //   markAllReadAtMs: state.markAllReadAtMs,
    //   stateUpdatedAtMs: state.stateUpdatedAtMs,
    //   readEventsCount: state.readEvents.length,
    // })
    return toResponse(state)
  }

  if (restPayload.action === 'merge-notification-read-state') {
    // console.info('[notification-read-state] merge request', {
    //   accountId,
    //   markAllReadAtMs: restPayload.markAllReadAtMs,
    //   stateUpdatedAtMs: restPayload.stateUpdatedAtMs,
    //   readEventsCount: restPayload.readEvents.length,
    // })
    const state = mergeNotificationReadState(accountId, {
      markAllReadAtMs: restPayload.markAllReadAtMs,
      stateUpdatedAtMs: restPayload.stateUpdatedAtMs,
      readEvents: sanitizeReadEvents(restPayload.readEvents),
    })
    // console.info('[notification-read-state] merge result', {
    //   accountId,
    //   markAllReadAtMs: state.markAllReadAtMs,
    //   stateUpdatedAtMs: state.stateUpdatedAtMs,
    //   readEventsCount: state.readEvents.length,
    // })
    return toResponse(state)
  }

  throw new BadRequestError('Invalid action')
})
