import {useAppContext} from '@/app-context'
import {useNavigate} from '@/utils/useNavigate'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {isHttpUrl} from '@shm/shared/utils/navigation'
import {toast} from '@shm/ui/toast'
import {useMemo} from 'react'

export function useOpenUrl() {
  const {externalOpen} = useAppContext()

  const spawn = useNavigate('spawn')
  const push = useNavigate('push')
  return useMemo(() => {
    return (url?: string, newWindow?: boolean) => {
      if (!url) return
      const appRoute = hypermediaUrlToRoute(url)
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
