import {WebCommenting} from '@/client-lazy'
import {createResourceMetadata, metadataToPageMeta} from '@/hypermedia-metadata'
import {GRPCError, SiteDocumentPayload} from '@/loaders'
import {defaultPageMeta} from '@/meta'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {WebSiteProvider} from '@/providers'
import {unwrap, type Wrapped} from '@/wrapping'
import {loadDocumentRouteWithAuth, type DocumentPayload, type ExtendedSitePayload} from '@/document-route-loader.server'
import {WebFeedPage} from '@/web-feed-page'
import {WebInspectorPage, WebResourcePage} from '@/web-resource-page'
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
} from '@shm/shared'
import {shouldReloadDocumentRouteData} from '@/document-route-path'
import {useNavigationState} from '@shm/shared/utils/navigation'
import {InspectIpfsPage} from '@shm/ui/inspect-ipfs-page'
import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'

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
  return shouldReloadDocumentRouteData(currentUrl, nextUrl, defaultShouldRevalidate)
}

export const loader = async ({params, request}: {params: Params; request: Request}) => {
  return loadDocumentRouteWithAuth({params, request})
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
