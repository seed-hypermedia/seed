import type {HMContactRecord, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext} from 'react'
import z from 'zod'
import {DAEMON_FILE_URL} from './constants'
import type {NavRoute} from './routes'
import type {LanguagePack} from './translation'
import type {UniversalClient} from './universal-client'
import {
  activityFilterToSlug,
  getRoutePanelParam,
  hmIdToURL,
  hypermediaUrlToRoute,
  idToUrl,
  routeToHmUrl,
  serializeBlockRange,
  unpackHmId,
} from './utils'
import type {StateStream} from './utils/stream'

export type OptimizedImageSize = 'S' | 'M' | 'L' | 'XL'

export type {UniversalClient}

export const appExperimentsSchema = z
  .object({
    hosting: z.boolean().optional(),
    webImporting: z.boolean().optional(),
    nostr: z.boolean().optional(),
    developerTools: z.boolean().optional(),
    pubContentDevMenu: z.boolean().optional(),
    newLibrary: z.boolean().optional(),
    embeddingEnabled: z.boolean().optional(),
    notifications: z.boolean().optional(),
  })
  .strict()
export type AppExperiments = z.infer<typeof appExperimentsSchema>

type UniversalAppContextValue = {
  ipfsFileUrl?: string
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute?: null | ((route: NavRoute, replace?: boolean) => void)
  openRouteNewWindow?: null | ((route: NavRoute) => void)
  originHomeId?: UnpackedHypermediaId | undefined

  // the web URL in the current context. If null, the hm URL should be used.
  // on desktop its the gateway URL, on mobile its the web site host.
  origin?: string | null

  openUrl: (url: string, newWindow?: boolean) => void
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>

  // set this to true if you want all <a href="" values to be full hm:// hypermedia urls. otherwise, web URLs will be prepared
  // you must be confused at this point, because I wrote this and I got confused! Here's why we do it:
  // when you copy content from the desktop app, you want to copy the <a> tags with full hm:// URLs, so they can be properly copy-pasted in an offline context.
  // ask Eric if you have questions.
  hmUrlHref?: boolean

  languagePack?: LanguagePack
  selectedIdentity?: StateStream<string | null>
  setSelectedIdentity?: (keyId: string | null) => void
  // The UID of the key that actually signs blobs. On desktop this equals
  // selectedIdentity. On web with vault accounts the signing key differs
  // from the vault account identity, so both must be checked for authorship.
  signingIdentity?: StateStream<string | null>
  universalClient: UniversalClient

  experiments?: AppExperiments
  contacts?: HMContactRecord[]
  broadcastEvent?: (event: AppEvent) => void
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
}

export const UniversalAppContext = createContext<UniversalAppContextValue>({
  ipfsFileUrl: DAEMON_FILE_URL,
  openUrl: () => {
    console.error('UniversalAppContext not set. Can not openUrl')
  },
  universalClient: {
    request: (async () => {
      throw new Error(
        'universalClient not found in UniversalAppContext. Ensure your platform sets universalClient in UniversalAppProvider.',
      )
    }) as UniversalClient['request'],
    publish: (async () => {
      throw new Error(
        'universalClient not found in UniversalAppContext. Ensure your platform sets universalClient in UniversalAppProvider.',
      )
    }) as UniversalClient['publish'],
  },
})

export type AppEvent =
  | {
      type: 'hypermediaHoverIn'
      id: UnpackedHypermediaId
    }
  | {
      type: 'hypermediaHoverOut'
      id: UnpackedHypermediaId
    }

export function UniversalAppProvider(props: {
  children: React.ReactNode
  originHomeId?: UnpackedHypermediaId
  origin?: string | null
  ipfsFileUrl?: string
  openUrl: (url: string, newWindow?: boolean) => void
  getOptimizedImageUrl?: (cid: string, size?: OptimizedImageSize) => string
  openRoute: null | ((route: NavRoute, replace?: boolean) => void)
  openRouteNewWindow?: null | ((route: NavRoute) => void)
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>
  hmUrlHref?: boolean
  languagePack?: LanguagePack
  selectedIdentity?: StateStream<string | null>
  setSelectedIdentity?: (keyId: string | null) => void
  signingIdentity?: StateStream<string | null>
  universalClient: UniversalClient
  experiments?: AppExperiments
  contacts?: HMContactRecord[]
  broadcastEvent?: (event: AppEvent) => void
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
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
        signingIdentity: props.signingIdentity,
        universalClient: props.universalClient,
        experiments: props.experiments,
        contacts: props.contacts,
        broadcastEvent: props.broadcastEvent,
        saveCidAsFile: props.saveCidAsFile,
      }}
    >
      {props.children as any}
    </UniversalAppContext.Provider>
  )
}

export function useUniversalAppContext() {
  const context = useContext(UniversalAppContext)
  if (!context) {
    throw new Error('useUniversalAppContext must be used within a UniversalAppProvider')
  }
  return context
}

export function useUniversalClient() {
  return useUniversalAppContext().universalClient
}

export function useOpenUrl() {
  const context = useContext(UniversalAppContext)
  if (!context) throw new Error('useOpenUrl must be used in a UniversalRoutingProvider')
  return context.openUrl
}

export function useRouteLinkHref(href: string, opts?: UseRouteLinkOpts) {
  const route = hypermediaUrlToRoute(href)
  const hmId = unpackHmId(href)
  return useRouteLink(route || (hmId ? {key: 'document', id: hmId} : href), opts)
}

type UseRouteLinkOpts = {
  replace?: boolean
  onClick?: React.MouseEventHandler<HTMLElement>
  origin?: string | null
  originHomeId?: UnpackedHypermediaId
}

export function routeToHref(
  route: NavRoute | string,
  options?: {
    hmUrlHref?: boolean
    originHomeId?: UnpackedHypermediaId
    origin?: string | null
  },
) {
  if (typeof route !== 'string' && route.key === 'site-profile') {
    const docId = route.id
    const siteBase = options?.originHomeId?.uid === docId.uid ? '' : `/hm/${docId.uid}`
    const accountSuffix = route.accountUid && route.accountUid !== docId.uid ? `/${route.accountUid}` : ''
    return `${siteBase}/:${route.tab}${accountSuffix}`
  }
  if (typeof route !== 'string' && route.key == 'profile') {
    const tab = route.tab || 'profile'
    return `/:${tab}/${route.id.uid}`
  }
  if (typeof route !== 'string' && route.key == 'contact') {
    return `/hm/contact/${route.id.uid}`
  }
  if (typeof route !== 'string' && route.key === 'notifications') {
    const viewParam = route.view ? `?view=${route.view}` : ''
    return `/hm/notifications${viewParam}`
  }

  if (typeof route !== 'string' && route.key === 'inspect') {
    if (options?.hmUrlHref) {
      return routeToHmUrl(route)
    }
    const docId = route.id
    let basePath = ''
    if (options?.originHomeId?.uid === docId.uid) {
      basePath = '/inspect'
      if (docId.path?.length) {
        basePath += `/${docId.path.join('/')}`
      }
    } else {
      basePath = `/hm/inspect/${docId.uid}${docId.path?.length ? `/${docId.path.join('/')}` : ''}`
    }

    let suffix = ''
    if (route.targetView === 'activity') {
      const filterSlug = activityFilterToSlug(route.targetActivityFilter)
      suffix = filterSlug ? `/:activity/${filterSlug}` : '/:activity'
    } else if (route.targetView === 'comments') {
      suffix = route.targetOpenComment ? `/:comments/${route.targetOpenComment}` : '/:comments'
    } else if (
      route.targetView === 'profile' ||
      route.targetView === 'membership' ||
      route.targetView === 'followers' ||
      route.targetView === 'following'
    ) {
      suffix = `/:${route.targetView}${route.targetAccountUid ? `/${route.targetAccountUid}` : ''}`
    } else if (route.targetView) {
      suffix = `/:${route.targetView}`
    }

    let href = `${basePath}${suffix}`
    const query: string[] = []
    if (route.id.version) {
      query.push(`v=${route.id.version}`)
      if (route.id.latest) query.push('l')
    }
    if (route.inspectTab && route.inspectTab !== 'document') {
      query.push(`tab=${route.inspectTab}`)
    }
    if (query.length) {
      href += `?${query.join('&')}`
    }
    if (route.id.blockRef) {
      href += `#${route.id.blockRef}${serializeBlockRange(route.id.blockRange)}`
    }
    return href
  }

  if (typeof route !== 'string' && route.key === 'inspect-ipfs') {
    if (options?.hmUrlHref) {
      return routeToHmUrl(route)
    }
    const basePath = options?.originHomeId ? '/inspect' : '/hm/inspect'
    return `${basePath}/ipfs/${route.ipfsPath}`
  }

  // Handle view routes (activity, comments, directory, collaborators, feed)
  if (
    typeof route !== 'string' &&
    (route.key === 'activity' ||
      route.key === 'comments' ||
      route.key === 'directory' ||
      route.key === 'collaborators' ||
      route.key === 'feed')
  ) {
    const docId = route.id
    // Build path with view term
    let basePath = ''
    if (options?.originHomeId?.uid === docId.uid) {
      // Same as origin, use relative path
      basePath = docId.path?.length ? `/${docId.path.join('/')}` : ''
    } else {
      basePath = `/hm/${docId.uid}${docId.path?.length ? `/${docId.path.join('/')}` : ''}`
    }
    // Add view term - need a / separator between path and view term
    let viewTerm = `:${route.key}`
    // Append activity filter slug to view term path
    if (route.key === 'activity') {
      const filterSlug = activityFilterToSlug(route.filterEventType)
      if (filterSlug) viewTerm += `/${filterSlug}`
    }
    // Append openComment to view term path for comments
    if (route.key === 'comments' && route.openComment) {
      viewTerm += `/${route.openComment}`
    }
    let href = basePath ? `${basePath}/${viewTerm}` : `/${viewTerm}`
    // Append panel query param if present
    const panelParam = getRoutePanelParam(route)
    if (panelParam) {
      const separator = href.includes('?') ? '&' : '?'
      href += `${separator}panel=${panelParam}`
    }
    // Append block fragment if present
    if (route.id.blockRef) {
      href += `#${route.id.blockRef}${serializeBlockRange(route.id.blockRange)}`
    }
    return href
  }

  const docRoute = typeof route !== 'string' && route.key == 'document' ? route : null
  const docId = typeof route === 'string' ? null : route.key == 'document' ? route.id : null
  let href: string | undefined = undefined
  if (typeof route == 'string') {
    href = route
  } else if (docRoute && docId) {
    const panelParam = getRoutePanelParam(docRoute)
    href = options?.hmUrlHref
      ? hmIdToURL(docId)
      : idToUrl(
          {
            ...docId,
            hostname: options?.origin || null,
          },
          {
            originHomeId: options?.originHomeId,
            panel: panelParam,
          },
        )
  }
  return href
}

export function useRouteLink(route: NavRoute | string | null, opts?: UseRouteLinkOpts) {
  const context = useContext(UniversalAppContext)

  if (!route)
    return {
      onClick: undefined,
      href: undefined,
      tag: 'a',
    }
  if (!context) throw new Error('useRouteLink must be used in a UniversalRoutingProvider')

  const href = routeToHref(route, {
    hmUrlHref: context.hmUrlHref,
    originHomeId: opts?.originHomeId || context.originHomeId,
    origin: opts?.origin,
  })

  const onClick = context.openRoute
    ? (e: React.MouseEvent<HTMLElement>) => {
        e?.stopPropagation()
        if (e.metaKey) {
          if (context.openRouteNewWindow) {
            e.preventDefault()
            if (typeof route === 'string') {
              context.openUrl(route.startsWith('http') ? route : `https://${route}`)
            } else {
              context.openRouteNewWindow(route)
            }
          }
          return // default behavior will not be stopped on web
        }
        e.preventDefault()
        opts?.onClick?.(e)
        if (typeof route === 'string') {
          context.openUrl(route.startsWith('http') ? route : `https://${route}`)
        } else if (context.openRoute) {
          context.openRoute(route, opts?.replace)
        } else {
          console.error('No openRoute function in UniversalAppContext. Cannot open route', route)
        }
      }
    : undefined

  return {
    href: href || '/',
    tag: 'a',
    onClick,
  }
}
