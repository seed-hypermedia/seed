import {createContext, useContext} from 'react'
import {DAEMON_FILE_URL} from './constants'
import {UnpackedHypermediaId} from './hm-types'
import {NavRoute} from './routes'
import {LanguagePack} from './translation'
import type {UniversalClient} from './universal-client'
import {createHMUrl, hmId, idToUrl, unpackHmId} from './utils'
import {StateStream} from './utils/stream'

export type OptimizedImageSize = 'S' | 'M' | 'L' | 'XL'

export type {UniversalClient}

type UniversalAppContextValue = {
  ipfsFileUrl?: string
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute?: null | ((route: NavRoute, replace?: boolean) => void)
  openRouteNewWindow?: null | ((route: NavRoute) => void)
  originHomeId?: UnpackedHypermediaId | undefined

  // the web URL in the current context. If null, the hm URL should be used.
  // on desktop its the gateway URL, on mobile its the web site host.
  origin?: string | null

  openUrl: (url: string) => void
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>

  // set this to true if you want all <a href="" values to be full hm:// hypermedia urls. otherwise, web URLs will be prepared
  hmUrlHref?: boolean

  languagePack?: LanguagePack
  selectedIdentity?: StateStream<string | null>
  setSelectedIdentity?: (keyId: string | null) => void
  universalClient?: UniversalClient
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
  origin?: string | null
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
  universalClient?: UniversalClient
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
        universalClient: props.universalClient,
      }}
    >
      {props.children as any}
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

export function useUniversalClient() {
  const {universalClient} = useUniversalAppContext()
  if (!universalClient) {
    throw new Error(
      'universalClient not found in UniversalAppContext. Ensure your platform sets universalClient in UniversalAppProvider.',
    )
  }
  return universalClient
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

type UseRouteLinkOpts = {
  replace?: boolean
  onPress?: React.MouseEventHandler<HTMLElement>
  handler?: 'onClick' | 'onPress'
}

export function routeToHref(
  route: NavRoute | string,
  options: {
    hmUrlHref?: boolean
    originHomeId?: UnpackedHypermediaId
    origin?: string | null
  },
) {
  if (typeof route !== 'string' && route.key == 'profile') {
    return `/hm/profile/${route.id.uid}`
  }
  const docRoute =
    typeof route !== 'string' &&
    (route.key == 'document' || route.key == 'feed')
      ? route
      : null
  const docId =
    typeof route === 'string'
      ? null
      : route.key == 'document' || route.key == 'feed'
      ? route.id
      : null
  const activeCommentId =
    docRoute?.accessory?.key == 'discussions'
      ? docRoute.accessory?.openComment
      : null
  let href: string | undefined = undefined
  if (typeof route == 'string') {
    href = route
  } else if (activeCommentId) {
    const [accountUid, commentTsid] = activeCommentId.split('/')
    // @ts-ignore
    const commentId = hmId(accountUid, {path: [commentTsid]})

    href = options.hmUrlHref ? createHMUrl(commentId) : idToUrl(commentId)
  } else if (docRoute && docId) {
    href = options.hmUrlHref
      ? createHMUrl(docId)
      : idToUrl(
          {...docId, hostname: null},
          {
            originHomeId: options.originHomeId,
          },
        )
  }
  return href
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

  const href = routeToHref(route, {
    hmUrlHref: context.hmUrlHref,
    originHomeId: context.originHomeId,
  })

  const clickHandler = context.openRoute
    ? (e: React.MouseEvent<HTMLElement>) => {
        e?.stopPropagation()
        if (e.metaKey) {
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
        opts?.onPress?.(e)
        if (typeof route === 'string') {
          context.openUrl(route.startsWith('http') ? route : `https://${route}`)
        } else if (context.openRoute) {
          console.log('openRoute', route, opts?.replace)
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
