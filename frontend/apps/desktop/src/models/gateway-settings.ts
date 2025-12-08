import {client} from '@/trpc'
import {DEFAULT_GATEWAY_URL, NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useEffect, useMemo} from 'react'

export function useGatewayUrl() {
  const gatewayUrl = useQuery({
    queryKey: [queryKeys.GATEWAY_URL],
    queryFn: () => client.gatewaySettings.getGatewayUrl.query(),
  })
  return gatewayUrl
}
export function useGatewayUrlStream(): StateStream<string> {
  const gatewayUrl = useQuery({
    queryKey: [queryKeys.GATEWAY_URL],
    queryFn: () => client.gatewaySettings.getGatewayUrl.query(),
  })
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
  const setGatewayUrl = useMutation({
    mutationFn: (url: string) =>
      client.gatewaySettings.setGatewayUrl.mutate(url),
    onSuccess: () => {
      invalidateQueries([queryKeys.GATEWAY_URL])
    },
  })
  return setGatewayUrl
}

export function useNotifyServiceHost() {
  const notifyServiceHost = useQuery({
    queryKey: [queryKeys.NOTIFY_SERVICE_HOST],
    queryFn: () => client.gatewaySettings.getNotifyServiceHost.query(),
  })
  return notifyServiceHost.data || NOTIFY_SERVICE_HOST
}

export function useSetNotifyServiceHost() {
  const setNotifyServiceHost = useMutation({
    mutationFn: (host: string) =>
      client.gatewaySettings.setNotifyServiceHost.mutate(host),
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFY_SERVICE_HOST])
    },
  })
  return setNotifyServiceHost
}

export function usePushOnCopy() {
  const pushOnCopy = useQuery({
    queryKey: [queryKeys.PUSH_ON_COPY],
    queryFn: () => client.gatewaySettings.getPushOnCopy.query(),
    onError: (error: unknown) => {
      console.error('Error fetching push on copy setting:', error)
      return 'always'
    },
    retry: 3,
    retryDelay: 1000,
  })
  return pushOnCopy
}

export function useSetPushOnCopy() {
  const setPushOnCopy = useMutation({
    mutationFn: (value: 'always' | 'never' | 'ask') =>
      client.gatewaySettings.setPushOnCopy.mutate(value),
    onSuccess: () => {
      invalidateQueries([queryKeys.PUSH_ON_COPY])
    },
    onError: (error: unknown) => {
      console.error('Error setting push on copy:', error)
    },
  })
  return setPushOnCopy
}

export function usePushOnPublish() {
  const pushOnPublish = useQuery({
    queryKey: [queryKeys.PUSH_ON_PUBLISH],
    queryFn: () => client.gatewaySettings.getPushOnPublish.query(),
    onError: (error: unknown) => {
      console.error('Error fetching push on publish setting:', error)
      return 'always'
    },
    retry: 3,
    retryDelay: 1000,
  })

  return pushOnPublish
}

export function useSetPushOnPublish() {
  const setPushOnPublish = useMutation({
    mutationFn: (value: 'always' | 'never' | 'ask') =>
      client.gatewaySettings.setPushOnPublish.mutate(value),
    onSuccess: () => {
      invalidateQueries([queryKeys.PUSH_ON_PUBLISH])
    },
    onError: (error: unknown) => {
      console.error('Error setting push on publish:', error)
    },
  })
  return setPushOnPublish
}
