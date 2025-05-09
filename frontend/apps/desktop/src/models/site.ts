import {grpcClient} from '@/grpc-client'
import {trpc} from '@/trpc'
import {hmId} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation} from '@tanstack/react-query'

export function useSiteRegistration(accountUid: string) {
  const accountId = hmId('d', accountUid)
  const entity = useEntity(accountId)

  const registerSite = trpc.sites.registerSite.useMutation()
  const getSiteConfig = trpc.sites.getConfig.useMutation()
  return useMutation({
    mutationFn: async (input: {url: string}) => {
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
        siteConfig.registeredAccountUid !== accountUid
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
          accountUid,
          peerId: daemonInfo.peerId,
          addrs: peerInfo.addrs,
        }
        console.log(JSON.stringify(registerPayload, null, 2))
        const registerResult = await registerSite.mutateAsync({
          url: registerUrl,
          payload: registerPayload,
        })
        console.log('registerResult', registerResult)
        console.log('connecting to site...')
        await grpcClient.networking.connect({
          addrs: siteConfig.addrs,
        })
        console.log('doing force sync from this node...')
        await grpcClient.daemon.forceSync({})
      }

      await grpcClient.documents.createDocumentChange({
        account: accountUid,
        signingKeyName: accountUid,
        baseVersion: entity.data?.document?.version,
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
      return siteUrl
    },
    onSuccess: (result, input) => {
      invalidateQueries([queryKeys.ENTITY, accountId.id])
      invalidateQueries([queryKeys.ACCOUNT, accountId.uid])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, accountId.id])
    },
  })
}

export function useRemoveSite(id: UnpackedHypermediaId) {
  const entity = useEntity(id)
  return useMutation({
    mutationFn: async () => {
      await grpcClient.documents.createDocumentChange({
        account: id.uid,
        signingKeyName: id.uid,
        baseVersion: entity.data?.document?.version,
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
    onSuccess: () => {
      invalidateQueries([queryKeys.ENTITY, id.id])
      invalidateQueries([queryKeys.ACCOUNT, id.uid])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
    },
  })
}
