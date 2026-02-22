import {encode as cborEncode} from '@ipld/dag-cbor'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {queryKeys} from './query-keys'

export type NotificationConfig = {
  accountId: string
  email: string | null
}

export type NotificationReadEvent = {
  eventId: string
  eventAtMs: number
}

export type NotificationReadState = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: NotificationReadEvent[]
  updatedAt: string
}

export type NotificationSigner = {
  publicKey: Uint8Array
  sign: (data: Uint8Array) => Promise<Uint8Array>
}

function normalizeHost(host: string) {
  return host.replace(/\/$/, '')
}

function accountIdFromSigner(signer: NotificationSigner | undefined) {
  return signer ? base58btc.encode(signer.publicKey) : undefined
}

async function signedNotifPost(host: string, path: string, signer: NotificationSigner, payload: Record<string, any>) {
  const unsigned = {...payload, signer: signer.publicKey, time: Date.now()}
  const encoded = cborEncode(unsigned)
  const sig = new Uint8Array(await signer.sign(encoded))
  const body = new Uint8Array(cborEncode({...unsigned, sig}))
  const res = await fetch(`${normalizeHost(host)}${path}`, {
    method: 'POST',
    body,
    headers: {'Content-Type': 'application/cbor'},
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export function useNotificationConfig(notifyServiceHost: string | undefined, signer: NotificationSigner | undefined) {
  const accountId = accountIdFromSigner(signer)
  return useQuery({
    queryKey: [queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountId],
    queryFn: async (): Promise<NotificationConfig> => {
      return signedNotifPost(notifyServiceHost!, '/hm/api/notification-config', signer!, {
        action: 'get-notification-config',
      })
    },
    enabled: !!notifyServiceHost && !!signer && !!accountId,
  })
}

export type SetNotificationConfigInput = {
  email: string
}

export function useSetNotificationConfig(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const queryClient = useQueryClient()
  const accountId = accountIdFromSigner(signer)
  return useMutation({
    mutationFn: async (input: SetNotificationConfigInput) => {
      if (!notifyServiceHost || !signer) {
        throw new Error('Missing notifyServiceHost or signer')
      }
      return signedNotifPost(notifyServiceHost, '/hm/api/notification-config', signer, {
        action: 'set-notification-config',
        ...input,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountId],
      })
    },
  })
}

export type MergeNotificationReadStateInput = {
  markAllReadAtMs: number | null
  readEvents: NotificationReadEvent[]
}

export function useNotificationReadState(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const accountId = accountIdFromSigner(signer)
  return useQuery({
    queryKey: [queryKeys.NOTIFICATION_READ_STATE, notifyServiceHost, accountId],
    queryFn: async (): Promise<NotificationReadState> => {
      return signedNotifPost(notifyServiceHost!, '/hm/api/notification-read-state', signer!, {
        action: 'get-notification-read-state',
      })
    },
    enabled: !!notifyServiceHost && !!signer && !!accountId,
  })
}

export function useMergeNotificationReadState(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const queryClient = useQueryClient()
  const accountId = accountIdFromSigner(signer)
  return useMutation({
    mutationFn: async (input: MergeNotificationReadStateInput) => {
      if (!notifyServiceHost || !signer) {
        throw new Error('Missing notifyServiceHost or signer')
      }
      return signedNotifPost(notifyServiceHost, '/hm/api/notification-read-state', signer, {
        action: 'merge-notification-read-state',
        markAllReadAtMs: input.markAllReadAtMs,
        readEvents: input.readEvents,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.NOTIFICATION_READ_STATE, notifyServiceHost, accountId],
      })
    },
  })
}

export async function getNotificationReadState(notifyServiceHost: string, signer: NotificationSigner) {
  return signedNotifPost(notifyServiceHost, '/hm/api/notification-read-state', signer, {
    action: 'get-notification-read-state',
  }) as Promise<NotificationReadState>
}

export async function mergeNotificationReadState(
  notifyServiceHost: string,
  signer: NotificationSigner,
  input: MergeNotificationReadStateInput,
) {
  return signedNotifPost(notifyServiceHost, '/hm/api/notification-read-state', signer, {
    action: 'merge-notification-read-state',
    markAllReadAtMs: input.markAllReadAtMs,
    readEvents: input.readEvents,
  }) as Promise<NotificationReadState>
}
