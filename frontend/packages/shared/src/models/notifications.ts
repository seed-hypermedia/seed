import {encode as cborEncode} from '@ipld/dag-cbor'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {queryKeys} from './query-keys'

export type NotificationConfig = {
  accountId: string
  email: string | null
}

export type NotificationSigner = {
  publicKey: Uint8Array
  sign: (data: Uint8Array) => Promise<Uint8Array>
}

async function signedNotifPost(
  host: string,
  signer: NotificationSigner,
  payload: Record<string, any>,
) {
  const unsigned = {...payload, signer: signer.publicKey, time: Date.now()}
  const encoded = cborEncode(unsigned)
  const sig = new Uint8Array(await signer.sign(encoded))
  const body = new Uint8Array(cborEncode({...unsigned, sig}))
  const res = await fetch(`${host}/hm/api/notification-config`, {
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

export function useNotificationConfig(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  return useQuery({
    queryKey: [queryKeys.NOTIFICATIONS_STATE, notifyServiceHost],
    queryFn: async (): Promise<NotificationConfig> => {
      return signedNotifPost(notifyServiceHost!, signer!, {
        action: 'get-notification-config',
      })
    },
    enabled: !!notifyServiceHost && !!signer,
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
  return useMutation({
    mutationFn: async (input: SetNotificationConfigInput) => {
      if (!notifyServiceHost || !signer) {
        throw new Error('Missing notifyServiceHost or signer')
      }
      return signedNotifPost(notifyServiceHost, signer, {
        action: 'set-notification-config',
        ...input,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.NOTIFICATIONS_STATE, notifyServiceHost],
      })
    },
  })
}
