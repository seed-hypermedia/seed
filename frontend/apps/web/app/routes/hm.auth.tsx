import {HMAuthPageLazy} from '@/client-lazy'
import {loadSiteDocument, SiteDocumentPayload} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {LoaderFunctionArgs} from '@remix-run/node'
import {useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'
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

  const {hostname} = parsedRequest
  const serviceConfig = await getConfig(hostname)
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`)
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid)
    throw new Error(`No registered account uid defined for ${hostname}`)
  const result = await loadSiteDocument(
    parsedRequest,
    hmId('d', registeredAccountUid, {path: [], latest: true}),
    {
      enableWebIssuing,
    },
  )
  return result
}

export default function HMWebAuth() {
  const data = unwrap<SiteDocumentPayload & {enableWebIssuing: boolean}>(
    useLoaderData(),
  )
  const {
    enableWebIssuing,
    originHomeId,
    siteHost,
    homeMetadata,
    id,
    document,
    supportDocuments,
    supportQueries,
    origin,
    enableWebSigning,
  } = data
  console.log('enableWebIssuing', enableWebIssuing)

  if (!enableWebIssuing) {
    return <div>Web auth not configured for this host.</div>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <YStack>
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          docId={id}
          document={document}
          supportDocuments={supportDocuments}
          supportQueries={supportQueries}
          origin={origin}
        >
          <HMAuthPageLazy enableWebIssuing={enableWebIssuing} />
        </WebSiteHeader>
        <PageFooter enableWebSigning={true} id={null} />
      </YStack>
    </WebSiteProvider>
  )
}
