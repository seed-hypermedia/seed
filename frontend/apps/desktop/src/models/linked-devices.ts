import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {invalidateQueries, queryKeys} from '@shm/shared'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useEffect} from 'react'

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
        label,
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
          addrs: addrInfo.addrs.filter((addr) => addr.match('webrtc-direct')),
        },
      } satisfies DeviceLinkSession
    },
  })
}

export function useLinkDeviceStatus(enabled = false) {
  const devicelinkStatus = useQuery({
    queryKey: ['linkDeviceStatus'],
    queryFn: async () => {
      const result = await grpcClient.daemon.getDeviceLinkSession({})
      return toPlainMessage(result)
    },
    refetchInterval: 1000,
    enabled: enabled,
  })
  useEffect(() => {
    if (devicelinkStatus.data?.redeemTime) {
      invalidateQueries([queryKeys.CAPABILITIES])
    }
  }, [devicelinkStatus.data?.redeemTime])
  return devicelinkStatus
}
