import {createContext, useContext} from 'react'
import {DAEMON_FILE_URL} from './constants'
import {UnpackedHypermediaId} from './hm-types'
import {NavRoute} from './routes'
import {idToUrl, unpackHmId} from './utils'

export type OptimizedImageSize = 'S' | 'M' | 'L' | 'XL'

type UniversalAppContextValue = {
  ipfsFileUrl?: string
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute?: null | ((route: NavRoute, replace?: boolean) => void)
  originHomeId?: UnpackedHypermediaId | undefined
  origin?: string
  openUrl: (url: string) => void
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>
}

export const UniversalAppContext = createContext<UniversalAppContextValue>({
  ipfsFileUrl: DAEMON_FILE_URL,
  openUrl: () => {
    console.error('UniversalAppContext not set. Can not openUrl')
  },
})

export function UniversalAppProvider(props: {
  children: React.ReactNode
  originHomeId?: UnpackedHypermediaId
  origin?: string
  ipfsFileUrl?: string
  openUrl: (url: string) => void
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute: null | ((route: NavRoute, replace?: boolean) => void)
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>
}) {
  return (
    <UniversalAppContext.Provider
      value={{
        originHomeId: props.originHomeId,
        origin: props.origin,
        ipfsFileUrl: props.ipfsFileUrl,
        getOptimizedImageUrl: props.getOptimizedImageUrl,
        openUrl: props.openUrl,
        openRoute: props.openRoute,
        onCopyReference: props.onCopyReference,
      }}
    >
      {props.children}
    </UniversalAppContext.Provider>
  )
}

export function useUniversalAppContext() {
  const context = useContext(UniversalAppContext)
  if (!context) {
    throw new Error(
      'useUniversalAppContext must be used within a UniversalAppProvider',
    )
  }
  return context
}

export function useOpenRoute() {
  const context = useContext(UniversalAppContext)
  if (!context)
    throw new Error('useOpenRoute must be used in a UniversalRoutingProvider')
  const openRoute = context.openRoute
  if (!openRoute) {
    throw new Error(
      'No openRoute function in UniversalAppContext. Cannot open route',
    )
  }
  return (route: NavRoute) => {
    openRoute(route)
  }
}

export function useOpenUrl() {
  const context = useContext(UniversalAppContext)
  if (!context)
    throw new Error('useOpenUrl must be used in a UniversalRoutingProvider')
  return context.openUrl
}

export function useRouteLinkHref(href: string) {
  const hmId = unpackHmId(href)
  return useRouteLink(hmId ? {key: 'document', id: hmId} : href)
}

export function useRouteLink(
  route: NavRoute | string | null,
  opts?: {
    replace?: boolean
  },
) {
  const context = useContext(UniversalAppContext)

  if (!route)
    return {
      onPress: undefined,
      href: undefined,
      style: {textDecoration: 'none'},
      tag: 'a',
    }
  if (!context)
    throw new Error('useRouteLink must be used in a UniversalRoutingProvider')
  const href =
    typeof route === 'string'
      ? route
      : route.key == 'document'
      ? idToUrl(route.id, {
          originHomeId: context.originHomeId,
          hasExplicitRouteHandling: !!context.openRoute,
        })
      : undefined
  return {
    onPress: context.openRoute
      ? (e: {preventDefault: () => void; stopPropagation: () => void}) => {
          e.preventDefault()
          e.stopPropagation()
          if (typeof route === 'string') {
            context.openUrl(route)
          } else if (context.openRoute) {
            context.openRoute(route, opts?.replace)
          } else {
            console.error(
              'No openRoute function in UniversalAppContext. Cannot open route',
              route,
            )
          }
        }
      : undefined,
    href: href || '/',
    style: {
      textDecoration: 'none',
    },
    tag: 'a',
  }
}
