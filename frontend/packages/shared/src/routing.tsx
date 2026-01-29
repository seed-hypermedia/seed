import {createContext, useContext} from 'react'
import z from 'zod'
import {DAEMON_FILE_URL} from './constants'
import {HMContactRecord, UnpackedHypermediaId} from './hm-types'
import {NavRoute} from './routes'
import {LanguagePack} from './translation'
import type {UniversalClient} from './universal-client'
import {hmId, hmIdToURL, idToUrl, unpackHmId} from './utils'
import {StateStream} from './utils/stream'

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

  openUrl: (url: string) => void
  onCopyReference?: (hmId: UnpackedHypermediaId) => Promise<void>

  // set this to true if you want all <a href="" values to be full hm:// hypermedia urls. otherwise, web URLs will be prepared
  // you must be confused at this point, because I wrote this and I got confused! Here's why we do it:
  // when you copy content from the desktop app, you want to copy the <a> tags with full hm:// URLs, so they can be properly copy-pasted in an offline context.
  // ask Eric if you have questions.
  hmUrlHref?: boolean

  languagePack?: LanguagePack
  selectedIdentity?: StateStream<string | null>
  setSelectedIdentity?: (keyId: string | null) => void
  universalClient?: UniversalClient

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
  onClick?: React.MouseEventHandler<HTMLElement>
}

export function routeToHref(
  route: NavRoute | string,
  options?: {
    hmUrlHref?: boolean
    originHomeId?: UnpackedHypermediaId
    origin?: string | null
  },
) {
  if (typeof route !== 'string' && route.key == 'profile') {
    return `/hm/profile/${route.id.uid}`
  }

  // Handle view routes (activity, discussions, directory, collaborators)
  if (
    typeof route !== 'string' &&
    (route.key === 'activity' ||
      route.key === 'discussions' ||
      route.key === 'directory' ||
      route.key === 'collaborators')
  ) {
    // For discussions routes with openComment, generate a comment URL
    if (route.key === 'discussions' && route.openComment) {
      const activeCommentId = route.openComment
      const [accountUid, commentTsid] = activeCommentId.split('/')
      if (accountUid && commentTsid) {
        const commentId = hmId(accountUid, {
          path: [commentTsid],
          blockRef: route.id.blockRef,
          blockRange: route.id.blockRange,
          hostname: options?.origin,
        })
        return options?.hmUrlHref ? hmIdToURL(commentId) : idToUrl(commentId)
      }
    }

    const docId = route.id
    // Build path with view term
    let basePath = ''
    if (options?.originHomeId?.uid === docId.uid) {
      // Same as origin, use relative path
      basePath = docId.path?.length ? `/${docId.path.join('/')}` : ''
    } else {
      basePath = `/hm/${docId.uid}${
        docId.path?.length ? `/${docId.path.join('/')}` : ''
      }`
    }
    // Add view term - need a / separator between path and view term
    const viewTerm = `:${route.key}`
    // If basePath is empty, use "/:viewTerm", otherwise use "basePath/:viewTerm"
    return basePath ? `${basePath}/${viewTerm}` : `/${viewTerm}`
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
  const activeCommentSelection =
    docRoute?.panel?.key == 'discussions' ? docRoute.panel : null
  let href: string | undefined = undefined
  if (typeof route == 'string') {
    href = route
  } else if (activeCommentSelection && activeCommentSelection.openComment) {
    const activeCommentId = activeCommentSelection.openComment
    const [accountUid, commentTsid] = activeCommentId.split('/')
    if (!accountUid || !commentTsid) return undefined
    const commentId = hmId(accountUid, {
      path: [commentTsid],
      blockRef: activeCommentSelection.id?.blockRef,
      blockRange: activeCommentSelection.id?.blockRange,
      hostname: options?.origin,
    })
    href = options?.hmUrlHref ? hmIdToURL(commentId) : idToUrl(commentId)
  } else if (docRoute && docId) {
    // Extract panel key for URL query param
    const panelKey = docRoute.panel?.key as
      | import('./utils/entity-id-url').PanelQueryKey
      | undefined
    href = options?.hmUrlHref
      ? hmIdToURL(docId)
      : idToUrl(
          {...docId, hostname: null},
          {
            originHomeId: options?.originHomeId,
            feed: docRoute.key === 'feed',
            panel: panelKey,
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
      onClick: undefined,
      href: undefined,
      tag: 'a',
    }
  if (!context)
    throw new Error('useRouteLink must be used in a UniversalRoutingProvider')

  const href = routeToHref(route, {
    hmUrlHref: context.hmUrlHref,
    originHomeId: context.originHomeId,
  })

  const onClick = context.openRoute
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
        opts?.onClick?.(e)
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

  return {
    href: href || '/',
    tag: 'a',
    onClick,
  }
}
