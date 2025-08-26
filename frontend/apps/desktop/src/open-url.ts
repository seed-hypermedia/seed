import {useAppContext} from '@/app-context'
import {useNavigate} from '@/utils/useNavigate'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {appRouteOfId, isHttpUrl} from '@shm/shared/utils/navigation'
import {toast} from '@shm/ui/toast'
import {useMemo} from 'react'

export function useOpenUrl() {
  const {externalOpen} = useAppContext()

  const spawn = useNavigate('spawn')
  const push = useNavigate('push')
  return useMemo(() => {
    return (url?: string, newWindow?: boolean) => {
      if (!url) return
      const unpacked = unpackHmId(url)
      // if (!unpacked) {
      //   toast.error(`Failed to resolve route for "${url}"`)
      //   return
      // }
      const appRoute = unpacked && appRouteOfId(unpacked)
      if (appRoute) {
        if (newWindow) {
          spawn(appRoute)
        } else {
          push(appRoute)
        }
      } else if (isHttpUrl(url)) {
        externalOpen(url)
      } else {
        toast.error(`Failed to resolve route for "${url}"`)
      }
    }
  }, [])
}
