import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {useMutation} from '@tanstack/react-query'

export function useLinkDevice() {
  return useMutation({
    mutationFn: async ({
      label,
      accountUid,
    }: {
      label: string
      accountUid: string
    }) => {
      const result = await grpcClient.daemon.createDeviceLinkSession({
        signingKeyName: accountUid,
      })

      const {accountId, secretToken, addrInfo} = toPlainMessage(result)
      if (!addrInfo) {
        throw new Error(
          'No addrInfo returned from daemon.createDeviceLinkSession',
        )
      }
      return {
        accountId,
        secretToken,
        addrInfo: {
          peerId: addrInfo.peerId,
          addrs: addrInfo.addrs,
        },
      } satisfies DeviceLinkSession
    },
  })
}
