import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {hmId} from '@shm/shared'
import {useMutation} from '@tanstack/react-query'
import {queryKeys} from './query-keys'

export function useSiteRegistration() {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()
  return useMutation({
    mutationFn: async (input: {url: string; accountUid: string}) => {
      // http://localhost:5175/hm/register?secret=abc
      const url = new URL(input.url)
      const secret = url.searchParams.get('secret')
      const siteUrl = `${url.protocol}//${url.host}`
      const registerUrl = `${siteUrl}/hm/register`
      const daemonInfo = await grpcClient.daemon.getInfo({})
      const resp = await fetch(registerUrl, {
        method: 'POST',
        body: JSON.stringify({
          registrationSecret: secret,
          accountUid: input.accountUid,
          peerId: daemonInfo.peerId,
        }),
      })
      if (resp.status !== 200) {
        throw new Error(`Failed to register`)
      }
      //   await grpcClient.documents.createDocumentChange({
      //     account: input.accountUid,
      //     signingKeyName: '', // TODO!
      //     changes: [
      //       new DocumentChange({
      //         op: {
      //           case: 'setMetadata',
      //           value: {
      //             key: 'siteUrl',
      //             value: siteUrl,
      //           },
      //         },
      //       }),
      //     ],
      //   })
      return null
    },
    onSuccess: (result, input) => {
      invalidate([queryKeys.ENTITY, hmId('d', input.accountUid).uid])
    },
  })
}
