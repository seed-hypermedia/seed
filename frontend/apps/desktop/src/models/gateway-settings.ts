import {trpc} from '@/trpc'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {useEffect, useMemo} from 'react'

export function useGatewayUrl() {
  const gatewayUrl = trpc.gatewaySettings.getGatewayUrl.useQuery()
  return gatewayUrl
}
export function useGatewayUrlStream(): StateStream<string> {
  const gatewayUrl = trpc.gatewaySettings.getGatewayUrl.useQuery()
  const [writeGwUrl, gwStateStream] = useMemo(() => {
    return writeableStateStream<string>(DEFAULT_GATEWAY_URL)
  }, [])
  useEffect(() => {
    gatewayUrl.data && writeGwUrl(gatewayUrl.data)
  }, [gatewayUrl.data])
  return gwStateStream
}

export function useGatewayHost_DEPRECATED() {
  const gatewayUrl = useGatewayUrl()
  const gatewayHost = gatewayUrl.data?.replace(/https?:\/\//, '')
  return gatewayHost || 'hyper.media'
}

export function useSetGatewayUrl() {
  const setGatewayUrl = trpc.gatewaySettings.setGatewayUrl.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.gatewaySettings.getGatewayUrl'])
    },
  })
  return setGatewayUrl
}

export function usePushOnCopy() {
  const pushOnCopy = trpc.gatewaySettings.getPushOnCopy.useQuery()
  return pushOnCopy
}

export function useSetPushOnCopy() {
  const setPushOnCopy = trpc.gatewaySettings.setPushOnCopy.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.gatewaySettings.getPushOnCopy'])
    },
  })
  return setPushOnCopy
}

export function usePushOnPublish() {
  const pushOnPublish = trpc.gatewaySettings.getPushOnPublish.useQuery()
  return pushOnPublish
}

export function useSetPushOnPublish() {
  const setPushOnPublish = trpc.gatewaySettings.setPushOnPublish.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.gatewaySettings.getPushOnPublish'])
    },
  })
  return setPushOnPublish
}
