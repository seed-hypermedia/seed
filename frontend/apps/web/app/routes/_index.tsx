import type {SiteDocumentPayload} from '@/loaders'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {WebSiteProvider} from '@/providers'
import {unwrap} from '@/wrapping'
import {Code} from '@connectrpc/connect'
import {Params, useLoaderData} from '@remix-run/react'
import {createDocumentNavRoute, ViewRouteKey} from '@shm/shared'
import {WebResourcePage} from '@shm/ui/web-resource-page'
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
      initialRoute={createDocumentNavRoute(data.id, data.viewTerm)}
    >
      <WebResourcePage docId={data.id} />
    </WebSiteProvider>
  )
}

export const meta = metaFn
