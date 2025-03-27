import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {cborEncode, postCBOR, signObject} from './api'
import {useLocalKeyPair} from './auth'
import {preparePublicKey} from './auth-utils'
import type {EmailNotifierAction} from './routes/hm.api.email-notifier.$.tsx'

export function useEmailNotifications() {
  const keyPair = useLocalKeyPair()

  return useQuery({
    queryKey: ['email-notifications', keyPair?.id],
    queryFn: async () => {
      if (!keyPair) {
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
        `/hm/api/email-notifier/${keyPair.id}`,
        cborEncode({
          ...payload,
          sig: new Uint8Array(sig),
        } satisfies EmailNotifierAction),
      )
      console.log('notifs... state...', result)
      return result as {
        account: {
          notifyAllMentions: boolean
          notifyAllReplies: boolean
          email: string
        }
      }
    },
  })
}

export function useSetEmailNotifications() {
  const keyPair = useLocalKeyPair()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      email,
      notifyAllMentions,
      notifyAllReplies,
    }: {
      email: string
      notifyAllMentions: boolean
      notifyAllReplies: boolean
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
      } as const
      const sig = await signObject(keyPair, payload)
      const result = await postCBOR(
        `/hm/api/email-notifier/${keyPair.id}`,
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
