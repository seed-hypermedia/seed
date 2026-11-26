import {useAppContext} from '@/app-context'
import {readWebBrowserEnabled} from '@/models/experiments'
import {useNavigate} from '@/utils/useNavigate'
import {type AppWindowEvent} from '@/utils/window-events'
import {type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {type NavRoute} from '@shm/shared/routes'
import {extractViewTermFromUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {isHttpUrl} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute, isCreateSpaceUrl} from '@shm/shared/utils/url-to-route'
import {toast} from '@shm/ui/toast'
import {useMemo} from 'react'

/** Resolves a Hypermedia URL into an app route and base id for navigation or public URL generation. */
export function resolveHypermediaRoute(url: string): {
  id: UnpackedHypermediaId
  route: NavRoute
} | null {
  const route = hypermediaUrlToRoute(url)
  if (!route) return null

  const {url: cleanUrl} = extractViewTermFromUrl(url)
  const unpacked = unpackHmId(cleanUrl)
  if (!unpacked) return null

  return {
    id: unpacked,
    route,
  }
}

/** Opens Seed routes natively and web links according to the browser preference. */
export function useOpenUrl() {
  const {externalOpen, ipc} = useAppContext()

  const spawn = useNavigate('spawn')
  const push = useNavigate('push')
  return useMemo(() => {
    return (url?: string, newWindow?: boolean) => {
      if (!url) return
      if (isCreateSpaceUrl(url)) {
        ipc.send('focusedWindowAppEvent', {type: 'open_create_space'} satisfies AppWindowEvent)
        return
      }
      const appRoute = hypermediaUrlToRoute(url)
      if (appRoute) {
        if (newWindow) {
          spawn(appRoute)
        } else {
          push(appRoute)
        }
      } else if (isHttpUrl(url)) {
        void readWebBrowserEnabled().then((browserEnabled) => {
          if (browserEnabled) (newWindow ? spawn : push)({key: 'web', url})
          else externalOpen(url)
        })
      } else {
        toast.error(`Failed to resolve route for "${url}"`)
      }
    }
  }, [externalOpen, ipc, spawn, push])
}
