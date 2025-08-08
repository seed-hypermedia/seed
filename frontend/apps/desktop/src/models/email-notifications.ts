import {grpcClient} from '@/grpc-client'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {invalidateQueries} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import type {
  EmailNotifierAccountState,
  EmailNotifierAction,
// @ts-expect-error
} from '../../../web/app/routes/hm.api.email-notifier.$.tsx'
import {useGatewayUrl} from './gateway-settings'

type SetEmailNotificationsInput = {
  email: string
  notifyAllMentions: boolean
  notifyAllReplies: boolean
  notifyOwnedDocChange: boolean
}

export function createNotifierRequester(gatewayUrl: string | undefined) {
  async function notifierRequest(
    accountUid: string,
    action: Omit<EmailNotifierAction, 'sig'>,
  ) {
    if (!gatewayUrl || !accountUid) return null
    const cborData = cborEncode(action)
    const signResponse = await grpcClient.daemon.signData({
      signingKeyName: accountUid,
      // @ts-expect-error
      data: cborData,
    })
    const signedPayload = {...action, sig: signResponse.signature}
    const response = await fetch(
      `${gatewayUrl}/hm/api/email-notifier/${accountUid}`,
      {
        method: 'POST',
        body: cborEncode(signedPayload),
        headers: {
          'Content-Type': 'application/cbor',
        },
      },
    )
    if (!response.ok) {
      try {
        const error = await response.json()
        throw new Error('Error fetching email notifications: ' + error.error)
      } catch (e) {
        throw new Error('Failed to fetch email notifications')
      }
    }
    return response.json()
  }
  return notifierRequest
}

export function useEmailNotifierRequest(accountUid: string) {
  const gatewayUrl = useGatewayUrl()
  const notifierRequest =
    gatewayUrl.data && createNotifierRequester(gatewayUrl.data)
  async function getNotifs() {
    if (!notifierRequest) return null
    return await getAccountNotifs(notifierRequest, accountUid)
  }
  async function setNotifs(input: SetEmailNotificationsInput) {
    if (!notifierRequest) return null
    const publicKey = base58btc.decode(accountUid)
    const payload = {
      action: 'set-email-notifications',
      signer: publicKey,
      time: Date.now(),
      ...input,
    } as const
    return await notifierRequest(accountUid, payload)
  }
  return {getNotifs, setNotifs}
}

export async function getAccountNotifs(
  requester: ReturnType<typeof createNotifierRequester>,
  accountUid: string,
) {
  const publicKey = base58btc.decode(accountUid)
  const payload = {
    action: 'get-email-notifications',
    signer: publicKey,
    time: Date.now(),
  } as const
  const notifsResult = (await requester(
    accountUid,
    payload,
  )) as EmailNotifierAccountState
  return notifsResult
}
export async function getAccountNotifsSafe(
  requester: ReturnType<typeof createNotifierRequester>,
  accountUid: string,
) {
  try {
    return await getAccountNotifs(requester, accountUid)
  } catch (e) {
    return null
  }
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
