import {createContext, useContext} from 'react'
import {DAEMON_FILE_URL} from './constants'
import {UnpackedHypermediaId} from './hm-types'
import {NavRoute} from './routes'
import {LanguagePack} from './translation'
import {createHMUrl, idToUrl, StateStream, unpackHmId} from './utils'

export type OptimizedImageSize = 'S' | 'M' | 'L' | 'XL'

type UniversalAppContextValue = {
  ipfsFileUrl?: string
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute?: null | ((route: NavRoute, replace?: boolean) => void)
  originHomeId?: UnpackedHypermediaId | undefined
  origin?: string
  openUrl: (url: string) => void
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>

  // set this to true if you want all <a href="" values to be full hypermedia urls. otherwise, web URLs will be prepared
  hmUrlHref?: boolean
  languagePack?: LanguagePack
  selectedIdentity?: StateStream<string | null>
  setSelectedIdentity?: (keyId: string | null) => void
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
  hmUrlHref?: boolean
  languagePack?: LanguagePack
  selectedIdentity?: StateStream<string | null>
  setSelectedIdentity?: (keyId: string | null) => void
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
        hmUrlHref: props.hmUrlHref,
        languagePack: props.languagePack,
        selectedIdentity: props.selectedIdentity,
        setSelectedIdentity: props.setSelectedIdentity,
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
    onPress?: () => void
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

  function getDocHref(docId: UnpackedHypermediaId | null) {
    if (!docId) return undefined
    if (context.hmUrlHref) {
      return createHMUrl(docId)
    }
    return idToUrl(docId, {
      originHomeId: context.originHomeId,
    })
  }
  const docId =
    typeof route === 'string' ? null : route.key == 'document' ? route.id : null

  const href = typeof route === 'string' ? route : getDocHref(docId)

  return {
    onPress: context.openRoute
      ? (e: {preventDefault: () => void; stopPropagation: () => void}) => {
          e.preventDefault()
          e.stopPropagation()
          opts?.onPress?.()
          if (typeof route === 'string') {
            context.openUrl(
              route.startsWith('http') ? route : `https://${route}`,
            )
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
    onClick: context.openRoute
      ? (e: {preventDefault: () => void; stopPropagation: () => void}) => {
          e.preventDefault()
          e.stopPropagation()
          opts?.onPress?.()
          if (typeof route === 'string') {
            context.openUrl(
              route.startsWith('http') ? route : `https://${route}`,
            )
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
