import {DraftsPage} from '@/drafts-page'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {loadSiteHeaderData, SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {getOptimizedImageUrl} from '@/providers'
import {parseRequest} from '@/request'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor} from '@remix-run/react'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'

/** Set the local Drafts page title and site icon. */
export const meta: MetaFunction = ({data}) => {
  const {homeMetadata} = unwrap<SiteHeaderPayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = homeMetadata?.icon ? getOptimizedImageUrl(extractIpfsUrlCid(homeMetadata.icon), 'S') : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({title: 'Drafts'})
  return meta
}

/** Load only the shared site header; drafts remain in browser storage. */
export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, async () => {
    const headerData = await loadSiteHeaderData(parsedRequest)
    return wrapJSON(headerData satisfies SiteHeaderPayload)
  })
}

/** Render the Drafts route. */
export default function DraftsIndexRoute() {
  return <DraftsPage />
}
