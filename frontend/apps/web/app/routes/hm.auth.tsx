import {HMAuthPageLazy} from '@/client-lazy'
import {PageFooter} from '@/page-footer'
import {parseRequest} from '@/request'
import {json, LoaderFunctionArgs} from '@remix-run/node'
import {useLoaderData} from '@remix-run/react'
import {
  SITE_BASE_URL,
  WEB_SIGNING_ENABLED,
  WEB_SIGNING_ISSUER,
} from '@shm/shared/constants'
import {YStack} from 'tamagui'

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const enableWebSigning =
    WEB_SIGNING_ENABLED && parsedRequest.origin === SITE_BASE_URL
  const enableWebIssuing = WEB_SIGNING_ISSUER === 'true' && enableWebSigning
  return json({enableWebIssuing})
}

export default function HMWebAuth() {
  const {enableWebIssuing} = useLoaderData<typeof loader>()
  console.log('enableWebIssuing', enableWebIssuing)

  if (!enableWebIssuing) {
    return <div>Web auth not configured for this host.</div>
  }
  return (
    <YStack>
      <HMAuthPageLazy enableWebIssuing={enableWebIssuing} />
      <PageFooter enableWebSigning={true} id={null} />
    </YStack>
  )
}
