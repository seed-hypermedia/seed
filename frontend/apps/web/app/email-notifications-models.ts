import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {cborEncode, postCBOR, signObject} from './api'
import {useLocalKeyPair} from './auth'
import {preparePublicKey} from './auth-utils'
import type {EmailNotifierAction} from './routes/hm.api.email-notifier.$'

export function useEmailNotifications() {
  const keyPair = useLocalKeyPair()
  const account = useAccount(keyPair?.id)

  return useQuery({
    queryKey: ['email-notifications', account.data?.id.uid],
    queryFn: async () => {
      if (!keyPair || !account.data?.id) {
        return null
      }
      const publicKey = await preparePublicKey(keyPair.publicKey)
      const payload = {
        action: 'get-email-notifications',
        signer: publicKey,
        time: Date.now(),
      } as const
      const sig = await signObject(keyPair, payload)
      const result = await postCBOR(
        `${NOTIFY_SERVICE_HOST}/hm/api/email-notifier/${account.data?.id.uid}`,
        cborEncode({
          ...payload,
          sig: new Uint8Array(sig),
        } satisfies EmailNotifierAction),
      )
      return result as {
        account: {
          notifyAllMentions: boolean
          notifyAllReplies: boolean
          notifyOwnedDocChange: boolean
          notifySiteDiscussions: boolean
          email: string
        }
      }
    },
  })
}

export function useSetEmailNotifications() {
  const keyPair = useLocalKeyPair()
  const account = useAccount(keyPair?.id)

  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      email,
      notifyAllMentions,
      notifyAllReplies,
      notifyOwnedDocChange,
      notifySiteDiscussions,
    }: {
      email: string
      notifyAllMentions: boolean
      notifyAllReplies: boolean
      notifyOwnedDocChange: boolean
      notifySiteDiscussions: boolean
    }) => {
      if (!keyPair) {
        return null
      }
      const publicKey = await preparePublicKey(keyPair.publicKey)
      const payload = {
        action: 'set-email-notifications',
        signer: publicKey,
        time: Date.now(),
        email,
        notifyAllMentions,
        notifyAllReplies,
        notifyOwnedDocChange,
        notifySiteDiscussions,
      } as const
      const sig = await signObject(keyPair, payload)
      const result = await postCBOR(
        `${NOTIFY_SERVICE_HOST}/hm/api/email-notifier/${account.data?.id.uid}`,
        cborEncode({
          ...payload,
          sig: new Uint8Array(sig),
        } satisfies EmailNotifierAction),
      )
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['email-notifications']})
    },
  })
}
