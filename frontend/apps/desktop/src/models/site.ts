import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {trpc} from '@/trpc'
import {DocumentChange, hmId, UnpackedHypermediaId} from '@shm/shared'
import {useMutation} from '@tanstack/react-query'
import {queryKeys} from './query-keys'

export function useSiteRegistration() {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()

  const registerSite = trpc.sites.registerSite.useMutation()
  return useMutation({
    mutationFn: async (input: {url: string; accountUid: string}) => {
      // http://localhost:5175/hm/register?secret=abc
      const url = new URL(input.url)
      const secret = url.searchParams.get('secret')
      const siteUrl = `${url.protocol}//${url.host}`
      const registerUrl = `${siteUrl}/hm/register`
      const daemonInfo = await grpcClient.daemon.getInfo({})
      const peerInfo = await grpcClient.networking.getPeerInfo({
        deviceId: daemonInfo.peerId,
      })
      const registerResult = await registerSite.mutateAsync({
        url: registerUrl,
        payload: {
          registrationSecret: secret,
          accountUid: input.accountUid,
          peerId: daemonInfo.peerId,
          addrs: peerInfo.addrs,
        },
      })
      console.log(registerResult)

      await grpcClient.documents.createDocumentChange({
        account: input.accountUid,
        signingKeyName: input.accountUid,
        changes: [
          new DocumentChange({
            op: {
              case: 'setMetadata',
              value: {
                key: 'siteUrl',
                value: siteUrl,
              },
            },
          }),
        ],
      })
      return null
    },
    onSuccess: (result, input) => {
      invalidate([queryKeys.ENTITY, hmId('d', input.accountUid).id])
    },
  })
}

export function useRemoveSite() {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()
  return useMutation({
    mutationFn: async (input: UnpackedHypermediaId) => {
      await grpcClient.documents.createDocumentChange({
        account: input.uid,
        signingKeyName: input.uid,
        changes: [
          new DocumentChange({
            op: {
              case: 'setMetadata',
              value: {
                key: 'siteUrl',
                value: '',
              },
            },
          }),
        ],
      })
      return null
    },
    onSuccess: (result, input) => {
      invalidate([queryKeys.ENTITY, input.id])
    },
  })
}
