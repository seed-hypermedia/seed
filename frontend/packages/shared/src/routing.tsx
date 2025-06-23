import {createContext, useContext} from 'react'
import {DAEMON_FILE_URL} from './constants'
import {UnpackedHypermediaId} from './hm-types'
import {NavRoute} from './routes'
import {LanguagePack} from './translation'
import {
  createHMUrl,
  idToUrl,
  StateStream,
  unpackHmId,
  writeableStateStream,
} from './utils'

export type OptimizedImageSize = 'S' | 'M' | 'L' | 'XL'

type UniversalAppContextValue = {
  ipfsFileUrl?: string
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute?: null | ((route: NavRoute, replace?: boolean) => void)
  openRouteNewWindow?: null | ((route: NavRoute) => void)
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
  openRouteNewWindow?: null | ((route: NavRoute) => void)
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
        openRouteNewWindow: props.openRouteNewWindow,
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

export function useRouteLinkHref(href: string, opts?: UseRouteLinkOpts) {
  const hmId = unpackHmId(href)
  return useRouteLink(hmId ? {key: 'document', id: hmId} : href, opts)
}

const [setIsMetaKeyPressed, isMetaKeyPressed] =
  writeableStateStream<boolean>(false)

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey) {
      setIsMetaKeyPressed(true)
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.metaKey) {
      setIsMetaKeyPressed(false)
    }
  })
  window.addEventListener('blur', () => {
    setIsMetaKeyPressed(false)
  })
}

type UseRouteLinkOpts = {
  replace?: boolean
  onPress?: () => void
  handler?: 'onClick' | 'onPress'
}

export function useRouteLink(
  route: NavRoute | string | null,
  opts?: UseRouteLinkOpts,
) {
  const context = useContext(UniversalAppContext)

  if (!route)
    return {
      onPress: undefined,
      onClick: undefined,
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

  const clickHandler = context.openRoute
    ? (e: {preventDefault: () => void; stopPropagation: () => void}) => {
        e.stopPropagation()
        if (isMetaKeyPressed.get()) {
          if (context.openRouteNewWindow) {
            e.preventDefault()
            if (typeof route === 'string') {
              context.openUrl(
                route.startsWith('http') ? route : `https://${route}`,
              )
            } else {
              context.openRouteNewWindow(route)
            }
          }
          return // default behavior will not be stopped on web
        }
        e.preventDefault()
        opts?.onPress?.()
        if (typeof route === 'string') {
          context.openUrl(route.startsWith('http') ? route : `https://${route}`)
        } else if (context.openRoute) {
          context.openRoute(route, opts?.replace)
        } else {
          console.error(
            'No openRoute function in UniversalAppContext. Cannot open route',
            route,
          )
        }
      }
    : undefined

  const props = {
    href: href || '/',
    style: {
      textDecoration: 'none',
    },
    tag: 'a',
  }
  if (opts?.handler === 'onClick') {
    return {
      ...props,
      onClick: clickHandler,
    }
  }
  return {
    ...props,
    onPress: clickHandler,
  }
}
