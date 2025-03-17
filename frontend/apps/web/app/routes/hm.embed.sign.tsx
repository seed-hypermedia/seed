import {EmbedSignPageLazy} from '@/client-lazy'
import {parseRequest} from '@/request'
import {json, LoaderFunctionArgs} from '@remix-run/node'
import {useLoaderData} from '@remix-run/react'
import {
  SITE_BASE_URL,
  WEB_SIGNING_ENABLED,
  WEB_SIGNING_ISSUER,
} from '@shm/shared'

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const enableWebSigning =
    WEB_SIGNING_ENABLED && parsedRequest.origin === SITE_BASE_URL
  const enableWebIssuing = WEB_SIGNING_ISSUER === 'true' && enableWebSigning
  return json({enableWebIssuing})
}

export default function HMWebEmbedSign() {
  const {enableWebIssuing} = useLoaderData<typeof loader>()
  if (!enableWebIssuing) {
    return <div>Web auth not configured for this host.</div>
  }
  return <EmbedSignPageLazy />
}
