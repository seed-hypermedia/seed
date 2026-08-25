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
  loadSpaceHeaderData,
  loadSpaceResource,
  loadWebDraftPlaceholderResource,
  SpaceDocumentPayload,
} from '@/loaders'
import {SpaceSettingsEmailsScreen, type SpaceSettingsEmailsPayload} from '@/space-settings-emails-content'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {defaultPageMeta} from '@/meta'
import {NoSpacePage, NotRegisteredPage} from '@/not-registered'
import {WebSpaceProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/space-config.server'
import {unwrap, type Wrapped} from '@/wrapping'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {WebFeedPage} from '@/web-feed-page'
import {shouldBypassServerDocumentFetchForWebDraftShell} from '@/document-edit/web-draft-shell'
import {WebInspectorPage, WebResourcePage} from '@/web-resource-page'
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
  isSpaceProfileTab,
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
type ExtendedSpacePayload = SpaceDocumentPayload & {
  isInspect?: boolean
  viewTerm?: ViewRouteKey | null
  exploreQ?: string | null
  exploreSort?: 'relevance' | 'recently_updated' | 'newest' | 'oldest' | 'title' | null
  panelParam?: string | null // Supports extended format like "comments/BLOCKID" or "comments/COMMENT_ID"
  openComment?: string | null
  commentVersion?: string | null
  accountUid?: string | null
  inspectTab?: InspectTab | null
}

type InspectIpfsPayload = {
  kind: 'inspect-ipfs'
  ipfsPath: string
  originHomeId: UnpackedHypermediaId
  spaceHost: string
}

type DocumentPayload =
  | ExtendedSpacePayload
  | InspectIpfsPayload
  | SpaceSettingsEmailsPayload
  | 'unregistered'
  | 'no-space'

function isInspectIpfsPayload(data: DocumentPayload): data is InspectIpfsPayload {
  return typeof data === 'object' && 'kind' in data && data.kind === 'inspect-ipfs'
}

function getInspectTab(value: string | null): InspectTab | null {
  switch (value) {
    case 'document':
    case 'changes':
    case 'versions':
    case 'comments':
    case 'citations':
    case 'children':
    case 'authored-comments':
    case 'contacts':
    case 'capabilities':
      return value
    default:
      return null
  }
}

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
      if (isSpaceProfileTab(tab)) {
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

export const documentPageMeta = ({data}: {data: Wrapped<SpaceDocumentPayload>}): ReturnType<MetaFunction> => {
  const spaceDocument = unwrap<SpaceDocumentPayload>(data)
  if (!spaceDocument?.document) {
    if (spaceDocument?.discoveryPending) {
      return [{title: 'Looking for this document…'}]
    }
    return spaceDocument
      ? [{title: spaceDocument.daemonError?.code === Code.PermissionDenied ? 'Private Document' : 'Not Found'}]
      : []
  }
  const metadata = createResourceMetadata({
    id: spaceDocument.comment ? commentIdToHmId(spaceDocument.comment.id) : spaceDocument.metadataId,
    document: spaceDocument.document,
    comment: spaceDocument.comment,
  })
  return metadataToPageMeta(metadata, {
    origin: spaceDocument.origin,
    id: spaceDocument.id,
    spaceHomeIcon: spaceDocument.spaceHomeIcon,
  })
}

export const meta: MetaFunction<typeof loader> = (args) => {
  const payload = unwrap<DocumentPayload>(args.data)
  if (payload === 'unregistered') return unregisteredMeta()
  if (payload === 'no-space') return unregisteredMeta()
  if ('kind' in payload && payload.kind === 'inspect-ipfs') {
    return [{title: `ipfs://${payload.ipfsPath}`}]
  }
  if ('kind' in payload && payload.kind === 'space-settings-emails') {
    return [{title: 'Email Subscribers'}]
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
  const exploreQ = url.searchParams.get('q')
  const rawExploreSort = url.searchParams.get('sort')
  const exploreSort =
    rawExploreSort === 'relevance' ||
    rawExploreSort === 'recently_updated' ||
    rawExploreSort === 'newest' ||
    rawExploreSort === 'oldest' ||
    rawExploreSort === 'title'
      ? rawExploreSort
      : null

  const serviceConfig = await instrument(ctx, 'getConfig', () => getConfig(hostname))
  if (!serviceConfig) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON('no-space', {status: 404})
  }
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON('unregistered', {status: 404})
  }

  // Space settings pages use a `:settings` view term: /:settings/email-subscribers
  // on the space's own origin, or /hm/<uid>/:settings/email-subscribers on the gateway.
  const rawSpacePath = params['*'] ? params['*'].split('/').filter(Boolean) : []
  let settingsSpaceAccountUid: string | null = null
  if (rawSpacePath.length === 2 && rawSpacePath[0] === ':settings' && rawSpacePath[1] === 'email-subscribers') {
    settingsSpaceAccountUid = registeredAccountUid
  } else if (
    rawSpacePath.length === 4 &&
    rawSpacePath[0] === 'hm' &&
    rawSpacePath[2] === ':settings' &&
    rawSpacePath[3] === 'email-subscribers'
  ) {
    settingsSpaceAccountUid = rawSpacePath[1] || null
  }
  if (settingsSpaceAccountUid) {
    const headerData = await instrument(ctx, 'loadSpaceHeaderData', () => loadSpaceHeaderData(parsedRequest))
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'space-settings-emails',
      ...headerData,
      spaceAccountUid: settingsSpaceAccountUid,
      notifyServiceHost: NOTIFY_SERVICE_HOST || null,
    } satisfies SpaceSettingsEmailsPayload)
  }

  const gatewayInspectIpfsPath = pathParts[0] === 'hm' ? extractInspectIpfsPathFromPath(pathParts, true) : null
  const spaceInspectIpfsPath = gatewayInspectIpfsPath ? null : extractInspectIpfsPathFromPath(pathParts, false)
  const inspectIpfsPath = gatewayInspectIpfsPath || spaceInspectIpfsPath
  if (inspectIpfsPath) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'inspect-ipfs',
      ipfsPath: inspectIpfsPath,
      originHomeId: hmId(registeredAccountUid),
      spaceHost: hostname,
    } satisfies InspectIpfsPayload)
  }

  let documentId
  let isInspect = false
  let viewTerm: ViewRouteKey | null = null
  // Merge activity filter slug from path into panelParam for createDocumentNavRoute
  let effectivePanelParam = panelParam
  let openComment: string | null = null
  // On comment permalink routes, ?v refers to the comment version CID, not
  // the target document version. Keep it off the document lookup or the
  // target document resolves as not found.
  let isCommentPermalink = false
  let accountUid: string | null = null

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && isSpaceProfileTab(pathParts[1])) {
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
      isCommentPermalink = true
    }
    accountUid = extracted.accountUid || null
    documentId = hmId(docUid, {
      path: extracted.path,
      version: isCommentPermalink ? null : version,
      latest: isCommentPermalink ? true : latest,
    })
  } else {
    // Space document (regular path) or inspector document (/inspect/path...)
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
      isCommentPermalink = true
    }
    accountUid = extracted.accountUid || null
    documentId = hmId(registeredAccountUid, {
      path: extracted.path,
      version: isCommentPermalink ? null : version,
      latest: isCommentPermalink ? true : latest,
    })
  }

  const spaceResourceData = {
    prefersLanguages: parsedRequest.prefersLanguages,
    viewTerm,
    exploreQ,
    exploreSort,
    panelParam: effectivePanelParam,
    openComment,
    commentVersion: isCommentPermalink ? version : null,
    accountUid,
    isInspect,
    inspectTab: isInspect ? getInspectTab(inspectTab) : null,
    instrumentationCtx: ctx,
  }

  const shouldLoadLocalDraftShell = shouldBypassServerDocumentFetchForWebDraftShell({
    path: documentId.path,
    isInspect,
    version,
  })

  const result = await instrument(
    ctx,
    shouldLoadLocalDraftShell ? 'loadWebDraftPlaceholderResource' : 'loadSpaceResource',
    () =>
      shouldLoadLocalDraftShell
        ? loadWebDraftPlaceholderResource(parsedRequest, documentId, spaceResourceData)
        : loadSpaceResource(parsedRequest, documentId, spaceResourceData),
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
  if (data === 'no-space') {
    return <NoSpacePage />
  }
  if ('kind' in data && data.kind === 'space-settings-emails') {
    return <SpaceSettingsEmailsScreen payload={data} />
  }
  if (isInspectIpfsPayload(data)) {
    return (
      <WebSpaceProvider
        originHomeId={data.originHomeId}
        spaceHost={data.spaceHost}
        initialRoute={createInspectIpfsNavRoute(data.ipfsPath)}
      >
        <InnerInspectIpfsPage ipfsPath={data.ipfsPath} />
      </WebSpaceProvider>
    )
  }
  const spaceData: ExtendedSpacePayload = data

  // The resource isn't available locally yet; discovery is running in the
  // background. Render a fast shim page that polls until it arrives.
  if (spaceData.discoveryPending && spaceData.id) {
    return <DiscoveryPendingPage id={spaceData.id} />
  }

  // The not found error is handled by the DocumentPage component,
  // and here we handle the rest of the errors.
  // For profile views, skip error handling since we don't need the document to exist
  if (
    spaceData.daemonError &&
    spaceData.daemonError.code !== Code.NotFound &&
    spaceData.daemonError.code !== Code.PermissionDenied &&
    !['profile', 'membership', 'followers', 'following'].includes(spaceData.viewTerm || '')
  ) {
    return <DaemonErrorPage message={spaceData.daemonError.message} code={spaceData.daemonError.code} />
  }

  // Render unified ResourcePage or FeedPage with WebSpaceProvider for navigation context
  const initialRoute = createDocumentNavRoute(
    spaceData.id,
    spaceData.viewTerm,
    spaceData.panelParam,
    spaceData.openComment,
    spaceData.accountUid,
    spaceData.commentVersion,
  )
  const initialRouteWithExploreParams =
    initialRoute.key === 'explore'
      ? {
          ...initialRoute,
          q: spaceData.exploreQ || undefined,
          sort: spaceData.exploreSort || undefined,
        }
      : initialRoute
  const initialInspectRoute = createInspectNavRoute(
    spaceData.id,
    spaceData.viewTerm,
    spaceData.panelParam,
    spaceData.openComment,
    spaceData.accountUid,
    spaceData.inspectTab,
  )

  return (
    <WebSpaceProvider
      origin={spaceData.origin}
      originHomeId={spaceData.originHomeId}
      spaceHost={spaceData.spaceHost}
      dehydratedState={spaceData.dehydratedState}
      initialRoute={spaceData.isInspect ? initialInspectRoute : initialRouteWithExploreParams}
    >
      {spaceData.viewTerm === 'feed' && !spaceData.isInspect ? (
        <WebFeedPage docId={spaceData.id} />
      ) : spaceData.isInspect ? (
        <InnerInspectorPage docId={spaceData.id} />
      ) : (
        <InnerResourcePage docId={spaceData.id} ssrContentHTML={spaceData.ssrContentHTML} />
      )}
    </WebSpaceProvider>
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

  // On web the current space is the gateway serving the file.
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
