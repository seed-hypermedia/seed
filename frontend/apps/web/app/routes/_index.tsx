import {Params, useLoaderData} from '@remix-run/react'
import {loader as loaderFn, meta as metaFn} from './$'
import {FeedPage} from '@/feed'
import {unwrap} from '@/wrapping'
import type {SiteDocumentPayload} from '@/loaders'
import {NotRegisteredPage} from '@/not-registered'
import {NoSitePage} from '@/not-registered'
import {DocumentPage} from '@/document'
import {DaemonErrorPage} from './$'
import {Code} from '@connectrpc/connect'

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

type DocumentPayload = SiteDocumentPayload | 'unregistered' | 'no-site'

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

  // Show feed page if feed param is present
  if (data.feed) {
    return <FeedPage {...data} />
  }

  // Otherwise show the document page
  return <DocumentPage {...data} />
}

export const meta = metaFn
