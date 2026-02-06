import {WebCommenting} from '@/client-lazy'
import type {SiteDocumentPayload} from '@/loaders'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {WebSiteProvider} from '@/providers'
import {unwrap} from '@/wrapping'
import {WebResourcePage} from '@/web-resource-page'
import {Code} from '@connectrpc/connect'
import {Params, useLoaderData} from '@remix-run/react'
import {
  createDocumentNavRoute,
  UnpackedHypermediaId,
  ViewRouteKey,
} from '@shm/shared'
import {DaemonErrorPage, loader as loaderFn, meta as metaFn} from './$'

export const loader = async ({
  params,
  request,
}: {
  params: Params
  request: Request
}) => {
  return await loaderFn({
    params,
    request,
  })
}

type ExtendedSitePayload = SiteDocumentPayload & {
  viewTerm?: ViewRouteKey | null
  panelParam?: string | null // Supports extended format like "discussions/BLOCKID" or "comment/COMMENT_ID"
}

type DocumentPayload = ExtendedSitePayload | 'unregistered' | 'no-site'

export default function IndexPage() {
  const unwrappedData = useLoaderData()
  const data = unwrap<DocumentPayload>(unwrappedData)

  if (data === 'unregistered') {
    return <NotRegisteredPage />
  }
  if (data === 'no-site') {
    return <NoSitePage />
  }

  // Handle errors
  if (data.daemonError && data.daemonError.code !== Code.NotFound) {
    return (
      <DaemonErrorPage
        message={data.daemonError.message}
        code={data.daemonError.code}
      />
    )
  }

  // Render unified ResourcePage with WebSiteProvider for navigation context
  return (
    <WebSiteProvider
      origin={data.origin}
      originHomeId={data.originHomeId}
      siteHost={data.siteHost}
      dehydratedState={data.dehydratedState}
      initialRoute={createDocumentNavRoute(
        data.id,
        data.viewTerm,
        data.panelParam,
      )}
    >
      <InnerResourcePage docId={data.id} />
    </WebSiteProvider>
  )
}

/** Inner component that can use hooks after providers are mounted */
function InnerResourcePage({docId}: {docId: UnpackedHypermediaId}) {
  return <WebResourcePage docId={docId} CommentEditor={WebCommenting} />
}

export const meta = metaFn
