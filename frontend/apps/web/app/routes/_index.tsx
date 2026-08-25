import {WebCommenting} from '@/client-lazy'
import type {SpaceDocumentPayload} from '@/loaders'
import {NoSpacePage, NotRegisteredPage} from '@/not-registered'
import {WebSpaceProvider} from '@/providers'
import {unwrap} from '@/wrapping'
import {WebResourcePage} from '@/web-resource-page'
import {Code} from '@connectrpc/connect'
import {Params, useLoaderData} from '@remix-run/react'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createDocumentNavRoute, ViewRouteKey} from '@shm/shared'
import {DaemonErrorPage, loader as loaderFn, meta as metaFn} from './$'
import {shouldRevalidateDocumentRoute} from './revalidation'

export const loader = async ({params, request}: {params: Params; request: Request}) => {
  return await loaderFn({
    params,
    request,
  })
}

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

type ExtendedSpacePayload = SpaceDocumentPayload & {
  viewTerm?: ViewRouteKey | null
  panelParam?: string | null // Supports extended format like "comments/BLOCKID" or "comments/COMMENT_ID"
  openComment?: string | null
}

type DocumentPayload = ExtendedSpacePayload | 'unregistered' | 'no-space'

export default function IndexPage() {
  const unwrappedData = useLoaderData()
  const data = unwrap<DocumentPayload>(unwrappedData)

  if (data === 'unregistered') {
    return <NotRegisteredPage />
  }
  if (data === 'no-space') {
    return <NoSpacePage />
  }

  // Handle errors
  if (data.daemonError && data.daemonError.code !== Code.NotFound && data.daemonError.code !== Code.PermissionDenied) {
    return <DaemonErrorPage message={data.daemonError.message} code={data.daemonError.code} />
  }

  // Render unified ResourcePage with WebSpaceProvider for navigation context
  return (
    <WebSpaceProvider
      origin={data.origin}
      originHomeId={data.originHomeId}
      spaceHost={data.spaceHost}
      dehydratedState={data.dehydratedState}
      initialRoute={createDocumentNavRoute(data.id, data.viewTerm, data.panelParam, data.openComment)}
    >
      <InnerResourcePage docId={data.id} ssrContentHTML={data.ssrContentHTML} />
    </WebSpaceProvider>
  )
}

/** Inner component that can use hooks after providers are mounted */
function InnerResourcePage({docId, ssrContentHTML}: {docId: UnpackedHypermediaId; ssrContentHTML?: string | null}) {
  return <WebResourcePage docId={docId} CommentEditor={WebCommenting} ssrContentHTML={ssrContentHTML} />
}

export const meta = metaFn
