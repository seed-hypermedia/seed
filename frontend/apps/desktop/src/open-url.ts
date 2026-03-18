import {useAppContext} from '@/app-context'
import {useNavigate} from '@/utils/useNavigate'
import {type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {type NavRoute} from '@shm/shared/routes'
import {extractViewTermFromUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {isHttpUrl} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
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

/** Returns a URL opener that routes Hypermedia links in-app and external links via the OS. */
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
