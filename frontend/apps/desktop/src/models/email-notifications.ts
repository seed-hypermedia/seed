import {grpcClient} from '@/grpc-client'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {invalidateQueries} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import type {
  EmailNotifierAccountState,
  EmailNotifierAction,
} from '../../../web/app/routes/hm.api.email-notifier.$.tsx'
import {useGatewayUrl} from './gateway-settings'

type SetEmailNotificationsInput = {
  email: string
  notifyAllMentions: boolean
  notifyAllReplies: boolean
}

export function useEmailNotifierRequest(accountUid: string) {
  const gatewayUrl = useGatewayUrl()
  async function notifierRequest(action: Omit<EmailNotifierAction, 'sig'>) {
    if (!gatewayUrl.data) return null
    const cborData = cborEncode(action)
    const signResponse = await grpcClient.daemon.signData({
      signingKeyName: accountUid,
      data: cborData,
    })
    const signedPayload = {...action, sig: signResponse.signature}
    console.log('~~ signedPayload', signedPayload)
    const response = await fetch(
      `${gatewayUrl.data}/hm/api/email-notifier/${accountUid}`,
      {
        method: 'POST',
        body: cborEncode(signedPayload),
        headers: {
          'Content-Type': 'application/cbor',
        },
      },
    )
    return response.json()
  }
  async function getNotifs() {
    const publicKey = base58btc.decode(accountUid)
    const payload = {
      action: 'get-email-notifications',
      signer: publicKey,
      time: Date.now(),
    } as const
    return (await notifierRequest(payload)) as EmailNotifierAccountState
  }
  async function setNotifs(input: SetEmailNotificationsInput) {
    const publicKey = base58btc.decode(accountUid)
    const payload = {
      action: 'set-email-notifications',
      signer: publicKey,
      time: Date.now(),
      ...input,
    } as const
    return await notifierRequest(payload)
  }
  return {getNotifs, setNotifs}
}

export function useEmailNotifications(accountUid: string) {
  const {getNotifs} = useEmailNotifierRequest(accountUid)
  const emailNotifs = useQuery({
    queryKey: ['email-notifications', accountUid],
    queryFn: async () => {
      return await getNotifs()
    },
  })
  return emailNotifs
}

export function useSetEmailNotifications(accountUid: string) {
  const {setNotifs} = useEmailNotifierRequest(accountUid)
  const setEmailNotifs = useMutation({
    mutationFn: async (input: SetEmailNotificationsInput) => {
      return await setNotifs(input)
    },
    onSuccess: () => {
      invalidateQueries(['email-notifications', accountUid])
    },
  })
  return setEmailNotifs
}
