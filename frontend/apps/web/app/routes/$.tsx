import {WebCommenting} from '@/client-lazy'
import {
  createInstrumentationContext,
  instrument,
  printInstrumentationSummary,
  setRequestInstrumentationContext,
} from '@/instrumentation.server'
import {createResourceMetadata, metadataToPageMeta} from '@/hypermedia-metadata'
import {
  GRPCError,
  loadSiteHeaderData,
  loadSiteResource,
  loadWebDraftPlaceholderResource,
  SiteDocumentPayload,
} from '@/loaders'
import {SiteSettingsEmailsScreen, type SiteSettingsEmailsPayload} from '@/site-settings-emails-content'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {defaultPageMeta} from '@/meta'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {unwrap, type Wrapped} from '@/wrapping'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {WebFeedPage} from '@/web-feed-page'
import {shouldBypassServerDocumentFetchForWebDraftShell} from '@/document-edit/web-draft-shell'
import {WebInspectorPage, WebResourcePage} from '@/web-resource-page'
import {extractRawBlobRouteFromPath, WebRawBlobPage} from '@/web-raw-blob'
import {extractOnyxRouteFromPath, WebOnyxPage} from '@/web-onyx'
import {wrapJSON} from '@/wrapping.server'
import {Code} from '@connectrpc/connect'
import {HeadersFunction} from '@remix-run/node'
import {MetaFunction, Params, useLoaderData} from '@remix-run/react'
import {HMDiscoveryStatusOutput, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {Spinner} from '@shm/ui/spinner'
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
  OnyxRoute,
  RawBlobRoute,
  isSiteProfileTab,
  VIEW_TERMS,
  viewTermToRouteKey,
  ViewRouteKey,
} from '@shm/shared'
import {useNavigationState} from '@shm/shared/utils/navigation'
import {InspectIpfsPage} from '@shm/ui/inspect-ipfs-page'
import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'
import {shouldRevalidateDocumentRoute} from './revalidation'

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

type RawBlobPayload = {
  kind: 'raw-blob'
  route: RawBlobRoute
  originHomeId: UnpackedHypermediaId
  siteHost: string
}

type OnyxPayload = {
  kind: 'onyx'
  route: OnyxRoute
  originHomeId: UnpackedHypermediaId
  siteHost: string
}

type DocumentPayload =
  | ExtendedSitePayload
  | InspectIpfsPayload
  | SiteSettingsEmailsPayload
  | RawBlobPayload
  | OnyxPayload
  | 'unregistered'
  | 'no-site'

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
    if (siteDocument?.discoveryPending) {
      return [{title: 'Looking for this document…'}]
    }
    return siteDocument
      ? [{title: siteDocument.daemonError?.code === Code.PermissionDenied ? 'Private Document' : 'Not Found'}]
      : []
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
  if ('kind' in payload && payload.kind === 'site-settings-emails') {
    return [{title: 'Email Subscribers'}]
  }
  if ('kind' in payload && payload.kind === 'raw-blob') {
    const {route} = payload
    return [{title: route.cid ? `ipfs://${route.cid}` : route.schemaCid ? 'New Instance' : 'New Blob'}]
  }
  if ('kind' in payload && payload.kind === 'onyx') {
    return [{title: payload.route.slug ? `Onyx · ${payload.route.slug}` : 'Onyx — the schema tour'}]
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
  return shouldRevalidateDocumentRoute({currentUrl, nextUrl, defaultShouldRevalidate})
}

export const loader = async ({params, request}: {params: Params; request: Request}) => {
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, () => loadRoute({params, request}))
}

async function loadRoute({params, request}: {params: Params; request: Request}) {
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

  // Site settings pages use a `:settings` view term: /:settings/email-subscribers
  // on the site's own origin, or /hm/<uid>/:settings/email-subscribers on the gateway.
  const rawSitePath = params['*'] ? params['*'].split('/').filter(Boolean) : []
  let settingsSiteAccountUid: string | null = null
  if (rawSitePath.length === 2 && rawSitePath[0] === ':settings' && rawSitePath[1] === 'email-subscribers') {
    settingsSiteAccountUid = registeredAccountUid
  } else if (
    rawSitePath.length === 4 &&
    rawSitePath[0] === 'hm' &&
    rawSitePath[2] === ':settings' &&
    rawSitePath[3] === 'email-subscribers'
  ) {
    settingsSiteAccountUid = rawSitePath[1] || null
  }
  if (settingsSiteAccountUid) {
    const headerData = await instrument(ctx, 'loadSiteHeaderData', () => loadSiteHeaderData(parsedRequest))
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'site-settings-emails',
      ...headerData,
      siteAccountUid: settingsSiteAccountUid,
      notifyServiceHost: NOTIFY_SERVICE_HOST || null,
    } satisfies SiteSettingsEmailsPayload)
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

  // The raw blob / schema editor page (reserved `/hm/blob/…` URLs). Client-side
  // only — the editor fetches/publishes blobs through the universal client — so
  // the loader just hands the parsed route to the provider; no server fetch.
  const rawBlobRoute = extractRawBlobRouteFromPath(pathParts)
  if (rawBlobRoute) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'raw-blob',
      route: rawBlobRoute,
      originHomeId: hmId(registeredAccountUid),
      siteHost: hostname,
    } satisfies RawBlobPayload)
  }

  // The Onyx schema explorer / tour (reserved `/hm/onyx/…` URLs). Client-side
  // only — the bundled schemas + engine live in the browser — so the loader just
  // hands the parsed route to the provider; no server fetch.
  const onyxRoute = extractOnyxRouteFromPath(pathParts)
  if (onyxRoute) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'onyx',
      route: onyxRoute,
      originHomeId: hmId(registeredAccountUid),
      siteHost: hostname,
    } satisfies OnyxPayload)
  }

  let documentId
  let isInspect = false
  let viewTerm: ViewRouteKey | null = null
  // Merge activity filter slug from path into panelParam for createDocumentNavRoute
  let effectivePanelParam = panelParam
  let openComment: string | null = null
  let accountUid: string | null = null

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && isSiteProfileTab(pathParts[1])) {
    // Backward-compatible utility profile URLs: /hm/profile/:accountUid.
    viewTerm = pathParts[1]
    accountUid = pathParts[2] || registeredAccountUid
    documentId = hmId(registeredAccountUid, {
      path: [],
      version,
      latest,
    })
  } else if (pathParts[0] === 'hm' && pathParts.length > 1) {
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

  const siteResourceData = {
    prefersLanguages: parsedRequest.prefersLanguages,
    viewTerm,
    panelParam: effectivePanelParam,
    openComment,
    accountUid,
    isInspect,
    inspectTab: isInspect && inspectTab ? (inspectTab as ExtendedSitePayload['inspectTab']) : null,
    instrumentationCtx: ctx,
  }

  const shouldLoadLocalDraftShell = shouldBypassServerDocumentFetchForWebDraftShell({
    path: documentId.path,
    isInspect,
    version,
  })

  const result = await instrument(
    ctx,
    shouldLoadLocalDraftShell ? 'loadWebDraftPlaceholderResource' : 'loadSiteResource',
    () =>
      shouldLoadLocalDraftShell
        ? loadWebDraftPlaceholderResource(parsedRequest, documentId, siteResourceData)
        : loadSiteResource(parsedRequest, documentId, siteResourceData),
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
  if ('kind' in data && data.kind === 'site-settings-emails') {
    return <SiteSettingsEmailsScreen payload={data} />
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
  if ('kind' in data && data.kind === 'raw-blob') {
    return (
      <WebSiteProvider originHomeId={data.originHomeId} siteHost={data.siteHost} initialRoute={data.route}>
        <WebRawBlobPage />
      </WebSiteProvider>
    )
  }
  if ('kind' in data && data.kind === 'onyx') {
    return (
      <WebSiteProvider originHomeId={data.originHomeId} siteHost={data.siteHost} initialRoute={data.route}>
        <WebOnyxPage />
      </WebSiteProvider>
    )
  }
  const siteData = data as ExtendedSitePayload

  // The resource isn't available locally yet; discovery is running in the
  // background. Render a fast shim page that polls until it arrives.
  if (siteData.discoveryPending && siteData.id) {
    return <DiscoveryPendingPage id={siteData.id} />
  }

  // The not found error is handled by the DocumentPage component,
  // and here we handle the rest of the errors.
  // For profile views, skip error handling since we don't need the document to exist
  if (
    siteData.daemonError &&
    siteData.daemonError.code !== Code.NotFound &&
    siteData.daemonError.code !== Code.PermissionDenied &&
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

  // On web the current site is the gateway serving the file.
  const gatewayUrl = typeof window !== 'undefined' ? window.location.origin : undefined
  return (
    <InspectIpfsPage
      ipfsPath={ipfsPath}
      exitRoute={exitRoute}
      getRouteForUrl={getRouteForUrl}
      gatewayUrl={gatewayUrl}
    />
  )
}

const DISCOVERY_POLL_INTERVAL_MS = 2_000
// Give up polling after ~2 minutes even if the daemon never reports the task
// as completed (e.g. the status endpoint keeps erroring).
const DISCOVERY_MAX_POLLS = 60

/**
 * Shim page returned when a resource isn't available locally and discovery is
 * running in the background. The server responds immediately (never holding
 * the HTTP request open on discovery) and this page polls the status endpoint
 * with short-lived requests until the resource arrives, then reloads.
 */
function DiscoveryPendingPage({id}: {id: UnpackedHypermediaId}) {
  const tx = useTx()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let polls = 0

    async function poll() {
      polls += 1
      let status: HMDiscoveryStatusOutput | null = null
      try {
        const params = new URLSearchParams({uid: id.uid, path: (id.path || []).join('/')})
        if (id.version) params.set('v', id.version)
        if (id.latest || !id.version) params.set('l', '')
        const res = await fetch(`/api/DiscoveryStatus?${params.toString()}`)
        if (res.ok) {
          status = unwrap<HMDiscoveryStatusOutput>(await res.json())
        }
      } catch (e) {
        // Network hiccup — keep polling until the cap.
      }
      if (cancelled) return
      if (status?.state === 'found') {
        window.location.reload()
        return
      }
      if (status?.state === 'failed' || polls >= DISCOVERY_MAX_POLLS) {
        setFailed(true)
        return
      }
      timeout = setTimeout(poll, DISCOVERY_POLL_INTERVAL_MS)
    }

    poll()
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [id.uid, id.path?.join('/'), id.version, id.latest])

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        {failed ? (
          <>
            <SizableText size="3xl">☹️</SizableText>
            <SizableText size="2xl" weight="bold">
              {tx('Document Not Found')}
            </SizableText>
            <SizableText className="max-w-md text-center">
              {tx(
                'discovery_failed_description',
                'We searched the network but could not find this document. It may be unavailable right now.',
              )}
            </SizableText>
            <button
              className="text-primary underline"
              onClick={() => {
                window.location.reload()
              }}
            >
              {tx('Try Again')}
            </button>
          </>
        ) : (
          <>
            <Spinner size="large" />
            <SizableText size="2xl" weight="bold">
              {tx('Looking for this document…')}
            </SizableText>
            <SizableText className="max-w-md text-center">
              {tx(
                'discovery_pending_description',
                'This document is not on this server yet. We are searching the network for it — the page will load automatically once it is found.',
              )}
            </SizableText>
          </>
        )}
      </div>
    </div>
  )
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
