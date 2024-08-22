import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {trpc} from '@/trpc'
import {DocumentChange, hmId, UnpackedHypermediaId} from '@shm/shared'
import {useMutation} from '@tanstack/react-query'
import {queryKeys} from './query-keys'

export function useSiteRegistration() {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()

  const registerSite = trpc.sites.registerSite.useMutation()
  const getSiteConfig = trpc.sites.getConfig.useMutation()
  return useMutation({
    mutationFn: async (input: {url: string; accountUid: string}) => {
      // http://localhost:5175/hm/register?secret=abc
      const url = new URL(input.url)
      const secret = url.searchParams.get('secret')
      const siteUrl = `${url.protocol}//${url.host}`
      const registerUrl = `${siteUrl}/hm/api/register`
      console.log('registerUrl', registerUrl)
      const siteConfig = await getSiteConfig.mutateAsync(siteUrl)
      console.log('siteConfig', siteConfig)
      if (!siteConfig) throw new Error('Site is not set up.')

      if (
        siteConfig.registeredAccountUid &&
        siteConfig.registeredAccountUid !== input.accountUid
      ) {
        throw new Error('Site already registered to another account')
      }
      if (!siteConfig.registeredAccountUid) {
        const daemonInfo = await grpcClient.daemon.getInfo({})
        const peerInfo = await grpcClient.networking.getPeerInfo({
          deviceId: daemonInfo.peerId,
        })
        const registerPayload = {
          registrationSecret: secret,
          accountUid: input.accountUid,
          peerId: daemonInfo.peerId,
          addrs: peerInfo.addrs,
        }
        console.log(JSON.stringify(registerPayload, null, 2))
        const registerResult = await registerSite.mutateAsync({
          url: registerUrl,
          payload: registerPayload,
        })
        console.log('registerResult', registerResult)
      }
      console.log('connecting to site...')
      await grpcClient.networking.connect({
        addrs: siteConfig.addrs,
      })
      console.log('doing force sync from this node...')
      await grpcClient.daemon.forceSync({})

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
