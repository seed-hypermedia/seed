import {useFullRender} from '@/cache-policy'
import {WebCommenting} from '@/client-lazy'
import {
  createInstrumentationContext,
  instrument,
  printInstrumentationSummary,
  setRequestInstrumentationContext,
} from '@/instrumentation.server'
import {createResourceMetadata, metadataToPageMeta} from '@/hypermedia-metadata'
import {GRPCError, loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {defaultPageMeta} from '@/meta'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {unwrap, type Wrapped} from '@/wrapping'
import {WebFeedPage} from '@/web-feed-page'
import {WebInspectorPage, WebResourcePage} from '@/web-resource-page'
import {wrapJSON} from '@/wrapping.server'
import {Code} from '@connectrpc/connect'
import {HeadersFunction} from '@remix-run/node'
import {MetaFunction, Params, useLoaderData} from '@remix-run/react'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useCallback, useMemo} from 'react'
import {
  commentIdToHmId,
  createDocumentNavRoute,
  createInspectIpfsNavRoute,
  createInspectNavRoute,
  createInspectNavRouteFromRoute,
  createRouteFromInspectNavRoute,
  hypermediaUrlToRoute,
  hmId,
  InspectTab,
  isSiteProfileTab,
  VIEW_TERMS,
  viewTermToRouteKey,
  ViewRouteKey,
} from '@shm/shared'
import {useNavigationState} from '@shm/shared/utils/navigation'
import {InspectIpfsPage} from '@shm/ui/inspect-ipfs-page'
import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'

// Extended payload with view term and panel param for page routing
type ExtendedSitePayload = SiteDocumentPayload & {
  isInspect?: boolean
  viewTerm?: ViewRouteKey | null
  panelParam?: string | null // Supports extended format like "comments/BLOCKID" or "comments/COMMENT_ID"
  openComment?: string | null
  accountUid?: string | null
  inspectTab?: InspectTab | null
}

type InspectIpfsPayload = {
  kind: 'inspect-ipfs'
  ipfsPath: string
  originHomeId: UnpackedHypermediaId
  siteHost: string
}

type DocumentPayload = ExtendedSitePayload | InspectIpfsPayload | 'unregistered' | 'no-site'

/**
 * Extract view term from path parts and return cleaned path + view term
 * e.g., ['docs', ':activity'] -> {path: ['docs'], viewTerm: 'activity'}
 */
function extractViewTermFromPath(pathParts: string[]): {
  path: string[]
  viewTerm: ViewRouteKey | null
  activityFilter?: string
  commentId?: string
  accountUid?: string
} {
  if (pathParts.length === 0) return {path: [], viewTerm: null}

  // Check for :comments/UID/TSID pattern (3 segments from end)
  if (pathParts.length >= 3) {
    const thirdToLast = pathParts[pathParts.length - 3]
    if (thirdToLast === ':comments' || thirdToLast === ':comment' || thirdToLast === ':discussions') {
      return {
        path: pathParts.slice(0, -3),
        viewTerm: 'comments',
        commentId: `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`,
      }
    }
  }

  // Check for :comments/COMMENT_ID pattern (2 segments from end)
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    if (secondToLast === ':comments' || secondToLast === ':comment' || secondToLast === ':discussions') {
      return {
        path: pathParts.slice(0, -2),
        viewTerm: 'comments',
        commentId: pathParts[pathParts.length - 1],
      }
    }
  }

  // Check for :activity/<slug> pattern (second-to-last + last)
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    if (secondToLast === ':activity') {
      return {
        path: pathParts.slice(0, -2),
        viewTerm: 'activity',
        activityFilter: pathParts[pathParts.length - 1],
      }
    }
  }

  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    const lastPart = pathParts[pathParts.length - 1]
    if (secondToLast && lastPart) {
      const tab = secondToLast.startsWith(':') ? secondToLast.slice(1) : null
      if (isSiteProfileTab(tab)) {
        return {
          path: pathParts.slice(0, -2),
          viewTerm: tab,
          accountUid: lastPart,
        }
      }
    }
  }

  const lastPart = pathParts[pathParts.length - 1]
  const viewTermMatch = VIEW_TERMS.find((term) => lastPart === term)

  if (viewTermMatch) {
    const viewTerm = viewTermToRouteKey(viewTermMatch)
    if (viewTerm) {
      return {
        path: pathParts.slice(0, -1),
        viewTerm,
      }
    }
  }

  return {path: pathParts, viewTerm: null}
}

function extractInspectPrefixFromPath(
  pathParts: string[],
  isGatewayPath: boolean,
): {pathParts: string[]; isInspect: boolean} {
  if (isGatewayPath) {
    if (pathParts[1] === 'inspect') {
      return {pathParts: pathParts.slice(2), isInspect: true}
    }
    return {pathParts: pathParts.slice(1), isInspect: false}
  }

  if (pathParts[0] === 'inspect') {
    return {pathParts: pathParts.slice(1), isInspect: true}
  }

  return {pathParts, isInspect: false}
}

function extractInspectIpfsPathFromPath(pathParts: string[], isGatewayPath: boolean): string | null {
  if (isGatewayPath) {
    return pathParts[1] === 'inspect' && pathParts[2] === 'ipfs' ? pathParts.slice(3).join('/') || null : null
  }

  return pathParts[0] === 'inspect' && pathParts[1] === 'ipfs' ? pathParts.slice(2).join('/') || null : null
}

const unregisteredMeta = defaultPageMeta('Welcome to Seed Hypermedia')

// export const links = () => [...documentLinks()]

export const documentPageMeta = ({data}: {data: Wrapped<SiteDocumentPayload>}): ReturnType<MetaFunction> => {
  const siteDocument = unwrap<SiteDocumentPayload>(data)
  if (!siteDocument?.document) {
    return siteDocument ? [{title: 'Not Found'}] : []
  }
  const metadata = createResourceMetadata({
    id: siteDocument.comment ? commentIdToHmId(siteDocument.comment.id) : siteDocument.id,
    document: siteDocument.document,
    comment: siteDocument.comment,
  })
  return metadataToPageMeta(metadata, {
    origin: siteDocument.origin,
    id: siteDocument.id,
    siteHomeIcon: siteDocument.siteHomeIcon,
  })
}

export const meta: MetaFunction<typeof loader> = (args) => {
  const payload = unwrap<DocumentPayload>(args.data)
  if (payload === 'unregistered') return unregisteredMeta()
  if (payload === 'no-site') return unregisteredMeta()
  if ('kind' in payload && payload.kind === 'inspect-ipfs') {
    return [{title: `ipfs://${payload.ipfsPath}`}]
  }
  return documentPageMeta({
    // @ts-ignore
    data: args.data,
  })
}

export const headers: HeadersFunction = ({loaderHeaders}) => loaderHeaders

/**
 * Prevent Remix from re-running the loader when only panel-related search params change.
 * The loader only depends on the pathname, `v` (version), and `l` (latest) params.
 * Changes to `panel`, `view`, etc. are purely client-side state.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: {
  currentUrl: URL
  nextUrl: URL
  defaultShouldRevalidate: boolean
}) {
  // Different pathname always revalidates
  if (currentUrl.pathname !== nextUrl.pathname) {
    return defaultShouldRevalidate
  }

  // Same pathname — check if data-affecting params changed
  const currentV = currentUrl.searchParams.get('v')
  const nextV = nextUrl.searchParams.get('v')
  const currentL = currentUrl.searchParams.get('l')
  const nextL = nextUrl.searchParams.get('l')

  if (currentV === nextV && currentL === nextL) {
    return false // Only cosmetic params (panel, view) changed
  }

  return defaultShouldRevalidate
}

export const loader = async ({params, request}: {params: Params; request: Request}) => {
  const parsedRequest = parseRequest(request)
  const ctx = createInstrumentationContext(parsedRequest.url.pathname, request.method)

  // Check if this is a data request (client-side navigation) vs document request (full page)
  // Remix single fetch normalizes URLs, so check sec-fetch-mode header
  const isDataRequest = request.headers.get('Sec-Fetch-Mode') === 'cors'

  // Store context for SSR phase access (will be retrieved in entry.server.tsx)
  // Only needed for document requests that will go through SSR
  if (!isDataRequest) {
    setRequestInstrumentationContext(request.url, ctx)
  }

  if (!useFullRender(parsedRequest)) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return null
  }
  const {url, hostname, pathParts} = parsedRequest
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === '' || !version
  const panelParam = url.searchParams.get('panel')
  const inspectTab = url.searchParams.get('tab')

  const serviceConfig = await instrument(ctx, 'getConfig', () => getConfig(hostname))
  if (!serviceConfig) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON('no-site', {status: 404})
  }
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON('unregistered', {status: 404})
  }

  const gatewayInspectIpfsPath = pathParts[0] === 'hm' ? extractInspectIpfsPathFromPath(pathParts, true) : null
  const siteInspectIpfsPath = gatewayInspectIpfsPath ? null : extractInspectIpfsPathFromPath(pathParts, false)
  const inspectIpfsPath = gatewayInspectIpfsPath || siteInspectIpfsPath
  if (inspectIpfsPath) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'inspect-ipfs',
      ipfsPath: inspectIpfsPath,
      originHomeId: hmId(registeredAccountUid),
      siteHost: hostname,
    } satisfies InspectIpfsPayload)
  }

  let documentId
  let isInspect = false
  let viewTerm: ViewRouteKey | null = null
  // Merge activity filter slug from path into panelParam for createDocumentNavRoute
  let effectivePanelParam = panelParam
  let openComment: string | null = null
  let accountUid: string | null = null

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...) or inspector document (/hm/inspect/uid/path...)
    const inspectResult = extractInspectPrefixFromPath(pathParts, true)
    isInspect = inspectResult.isInspect
    const targetPathParts = inspectResult.pathParts
    const docUid = targetPathParts[0]
    const extracted = extractViewTermFromPath(targetPathParts.slice(1))
    viewTerm = extracted.viewTerm
    if (extracted.activityFilter) {
      effectivePanelParam = `activity/${extracted.activityFilter}`
    }
    if (extracted.commentId) {
      openComment = extracted.commentId
    }
    accountUid = extracted.accountUid || null
    documentId = hmId(docUid, {
      path: extracted.path,
      version,
      latest,
    })
  } else {
    // Site document (regular path) or inspector document (/inspect/path...)
    const rawPath = params['*'] ? params['*'].split('/').filter(Boolean) : []
    const inspectResult = extractInspectPrefixFromPath(rawPath, false)
    isInspect = inspectResult.isInspect
    const extracted = extractViewTermFromPath(inspectResult.pathParts)
    viewTerm = extracted.viewTerm
    if (extracted.activityFilter) {
      effectivePanelParam = `activity/${extracted.activityFilter}`
    }
    if (extracted.commentId) {
      openComment = extracted.commentId
    }
    accountUid = extracted.accountUid || null
    documentId = hmId(registeredAccountUid, {
      path: extracted.path,
      version,
      latest,
    })
  }

  const result = await instrument(ctx, 'loadSiteResource', () =>
    loadSiteResource(parsedRequest, documentId, {
      prefersLanguages: parsedRequest.prefersLanguages,
      viewTerm,
      panelParam: effectivePanelParam,
      openComment,
      accountUid,
      isInspect,
      inspectTab: isInspect && inspectTab ? (inspectTab as ExtendedSitePayload['inspectTab']) : null,
      instrumentationCtx: ctx,
    }),
  )

  // For data requests (client-side nav), print summary here since there's no SSR phase
  if (isDataRequest && ctx.enabled) {
    printInstrumentationSummary(ctx)
  }

  return result
}

export default function UnifiedDocumentPage() {
  const unwrappedData = useLoaderData()
  const data = unwrap<DocumentPayload>(unwrappedData)
  if (data === 'unregistered') {
    return <NotRegisteredPage />
  }
  if (data === 'no-site') {
    return <NoSitePage />
  }
  if ('kind' in data && data.kind === 'inspect-ipfs') {
    return (
      <WebSiteProvider
        originHomeId={data.originHomeId}
        siteHost={data.siteHost}
        initialRoute={createInspectIpfsNavRoute(data.ipfsPath)}
      >
        <InnerInspectIpfsPage ipfsPath={data.ipfsPath} />
      </WebSiteProvider>
    )
  }
  const siteData = data as ExtendedSitePayload

  // The not found error is handled by the DocumentPage component,
  // and here we handle the rest of the errors.
  // For profile views, skip error handling since we don't need the document to exist
  if (
    siteData.daemonError &&
    siteData.daemonError.code !== Code.NotFound &&
    !['profile', 'membership', 'followers', 'following'].includes(siteData.viewTerm || '')
  ) {
    return <DaemonErrorPage message={siteData.daemonError.message} code={siteData.daemonError.code} />
  }

  // Render unified ResourcePage or FeedPage with WebSiteProvider for navigation context
  const initialRoute = createDocumentNavRoute(
    siteData.id,
    siteData.viewTerm,
    siteData.panelParam,
    siteData.openComment,
    siteData.accountUid,
  )
  const initialInspectRoute = createInspectNavRoute(
    siteData.id,
    siteData.viewTerm,
    siteData.panelParam,
    siteData.openComment,
    siteData.accountUid,
    siteData.inspectTab,
  )

  return (
    <WebSiteProvider
      origin={siteData.origin}
      originHomeId={siteData.originHomeId}
      siteHost={siteData.siteHost}
      dehydratedState={siteData.dehydratedState}
      initialRoute={siteData.isInspect ? initialInspectRoute : initialRoute}
    >
      {siteData.viewTerm === 'feed' && !siteData.isInspect ? (
        <WebFeedPage docId={siteData.id} />
      ) : siteData.isInspect ? (
        <InnerInspectorPage docId={siteData.id} />
      ) : (
        <InnerResourcePage docId={siteData.id} ssrContentHTML={siteData.ssrContentHTML} />
      )}
    </WebSiteProvider>
  )
}

/** Inner component that can use hooks after providers are mounted */
function InnerResourcePage({docId, ssrContentHTML}: {docId: UnpackedHypermediaId; ssrContentHTML?: string | null}) {
  return <WebResourcePage docId={docId} CommentEditor={WebCommenting} ssrContentHTML={ssrContentHTML} />
}

/** Inner component that renders the dedicated inspector after providers are mounted. */
function InnerInspectorPage({docId}: {docId: UnpackedHypermediaId}) {
  return <WebInspectorPage docId={docId} />
}

function InnerInspectIpfsPage({ipfsPath}: {ipfsPath: string}) {
  const navState = useNavigationState()
  const getRouteForUrl = useCallback((url: string) => {
    if (url.startsWith('ipfs://')) {
      return createInspectIpfsNavRoute(url.slice('ipfs://'.length))
    }

    const targetRoute = hypermediaUrlToRoute(url)
    return targetRoute ? createInspectNavRouteFromRoute(targetRoute) : null
  }, [])
  const exitRoute = useMemo(() => {
    const previousRoute = navState && navState.routeIndex > 0 ? navState.routes[navState.routeIndex - 1] : null
    if (!previousRoute || previousRoute.key === 'inspect-ipfs') return null
    return previousRoute.key === 'inspect'
      ? createRouteFromInspectNavRoute(previousRoute, previousRoute.inspectTab)
      : previousRoute
  }, [navState])

  return <InspectIpfsPage ipfsPath={ipfsPath} exitRoute={exitRoute} getRouteForUrl={getRouteForUrl} />
}

export function DaemonErrorPage(props: GRPCError) {
  const tx = useTx()
  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-2xl flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="3xl">☹️</SizableText>
          <SizableText size="2xl" weight="bold">
            {props.code === Code.Unavailable ? tx('Internal Server Error') : tx('Server Error')}
          </SizableText>

          {props.code === Code.Unavailable ? (
            <SizableText>
              {tx(
                'error_no_daemon_connection',
                `No connection to the backend daemon server. It's probably a bug in our software. Please let us know!`,
              )}
            </SizableText>
          ) : null}

          <pre className="text-destructive wrap-break-word whitespace-pre-wrap">{props.message}</pre>
        </div>
      </div>
    </div>
  )
}
