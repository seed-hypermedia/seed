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
import {WebResourcePage} from '@/web-resource-page'
import {wrapJSON} from '@/wrapping.server'
import {Code} from '@connectrpc/connect'
import {HeadersFunction} from '@remix-run/node'
import {MetaFunction, Params, useLoaderData} from '@remix-run/react'
import {
  commentIdToHmId,
  createDocumentNavRoute,
  hmId,
  UnpackedHypermediaId,
  VIEW_TERMS,
  ViewRouteKey,
} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'

// Extended payload with view term and panel param for page routing
type ExtendedSitePayload = SiteDocumentPayload & {
  viewTerm?: ViewRouteKey | null
  panelParam?: string | null // Supports extended format like "comments/BLOCKID" or "comments/COMMENT_ID"
  openComment?: string | null
}

type DocumentPayload = ExtendedSitePayload | 'unregistered' | 'no-site'

/**
 * Extract view term from path parts and return cleaned path + view term
 * e.g., ['docs', ':activity'] -> {path: ['docs'], viewTerm: 'activity'}
 */
function extractViewTermFromPath(pathParts: string[]): {
  path: string[]
  viewTerm: ViewRouteKey | null
  activityFilter?: string
  commentId?: string
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

  const lastPart = pathParts[pathParts.length - 1]
  const viewTermMatch = VIEW_TERMS.find((term) => lastPart === term)

  if (viewTermMatch) {
    // Map :activity -> activity, etc.
    const viewTerm = viewTermMatch.slice(1) as ViewRouteKey
    return {
      path: pathParts.slice(0, -1),
      viewTerm,
    }
  }

  return {path: pathParts, viewTerm: null}
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
  return documentPageMeta({
    // @ts-ignore
    data: args.data,
  })
}

export const headers: HeadersFunction = ({loaderHeaders}) => loaderHeaders

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
  const latest = url.searchParams.get('l') === ''
  const panelParam = url.searchParams.get('panel')

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

  let documentId
  let viewTerm: ViewRouteKey | null = null
  // Merge activity filter slug from path into panelParam for createDocumentNavRoute
  let effectivePanelParam = panelParam
  let openComment: string | null = null

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...)
    const extracted = extractViewTermFromPath(pathParts.slice(2))
    viewTerm = extracted.viewTerm
    if (extracted.activityFilter) {
      effectivePanelParam = `activity/${extracted.activityFilter}`
    }
    if (extracted.commentId) {
      openComment = extracted.commentId
    }
    documentId = hmId(pathParts[1], {
      path: extracted.path,
      version,
      latest,
    })
  } else {
    // Site document (regular path)
    const rawPath = params['*'] ? params['*'].split('/').filter(Boolean) : []
    const extracted = extractViewTermFromPath(rawPath)
    viewTerm = extracted.viewTerm
    if (extracted.activityFilter) {
      effectivePanelParam = `activity/${extracted.activityFilter}`
    }
    if (extracted.commentId) {
      openComment = extracted.commentId
    }
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

  // The not found error is handled by the DocumentPage component,
  // and here we handle the rest of the errors.
  if (data.daemonError && data.daemonError.code !== Code.NotFound) {
    return <DaemonErrorPage message={data.daemonError.message} code={data.daemonError.code} />
  }

  // Render unified ResourcePage or FeedPage with WebSiteProvider for navigation context
  const initialRoute = createDocumentNavRoute(data.id, data.viewTerm, data.panelParam, data.openComment)

  return (
    <WebSiteProvider
      origin={data.origin}
      originHomeId={data.originHomeId}
      siteHost={data.siteHost}
      dehydratedState={data.dehydratedState}
      initialRoute={initialRoute}
    >
      {data.viewTerm === 'feed' ? <WebFeedPage docId={data.id} /> : <InnerResourcePage docId={data.id} />}
    </WebSiteProvider>
  )
}

/** Inner component that can use hooks after providers are mounted */
function InnerResourcePage({docId}: {docId: UnpackedHypermediaId}) {
  return <WebResourcePage docId={docId} CommentEditor={WebCommenting} />
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
