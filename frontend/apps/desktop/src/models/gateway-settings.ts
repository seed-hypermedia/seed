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

export function useNotifyServiceHost() {
  const notifyServiceHost = trpc.gatewaySettings.getNotifyServiceHost.useQuery()
  return notifyServiceHost
}

export function useSetNotifyServiceHost() {
  const setNotifyServiceHost =
    trpc.gatewaySettings.setNotifyServiceHost.useMutation({
      onSuccess: () => {
        invalidateQueries(['trpc.gatewaySettings.getNotifyServiceHost'])
      },
    })
  return setNotifyServiceHost
}

export function usePushOnCopy() {
  const pushOnCopy = trpc.gatewaySettings.getPushOnCopy.useQuery(undefined, {
    onError: (error) => {
      console.error('Error fetching push on copy setting:', error)
      return 'always'
    },
    retry: 3,
    retryDelay: 1000,
  })
  return pushOnCopy
}

export function useSetPushOnCopy() {
  const utils = trpc.useContext()

  const setPushOnCopy = trpc.gatewaySettings.setPushOnCopy.useMutation({
    onSuccess: () => {
      utils.gatewaySettings.getPushOnCopy.invalidate()
    },
    onError: (error) => {
      console.error('Error setting push on copy:', error)
    },
  })
  return setPushOnCopy
}

export function usePushOnPublish() {
  const pushOnPublish = trpc.gatewaySettings.getPushOnPublish.useQuery(
    undefined,
    {
      onError: (error) => {
        console.error('Error fetching push on publish setting:', error)
        return 'always'
      },
      retry: 3,
      retryDelay: 1000,
    },
  )

  return pushOnPublish
}

export function useSetPushOnPublish() {
  const utils = trpc.useContext()

  const setPushOnPublish = trpc.gatewaySettings.setPushOnPublish.useMutation({
    onSuccess: () => {
      utils.gatewaySettings.getPushOnPublish.invalidate()
    },
    onError: (error) => {
      console.error('Error setting push on publish:', error)
    },
  })
  return setPushOnPublish
}
