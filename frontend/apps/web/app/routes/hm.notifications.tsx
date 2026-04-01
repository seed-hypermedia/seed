import {loadSiteHeaderData, SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {ClientOnly} from '@/client-lazy'
import {WebNotificationsPage} from '@/notifications-page-content'
import {WebAccountFooter} from '@/web-utils'
import {Suspense} from 'react'
import {Spinner} from '@shm/ui/spinner'

type NotificationsPagePayload = SiteHeaderPayload

export const meta: MetaFunction = ({data}) => {
  const {homeMetadata} = unwrap<NotificationsPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = homeMetadata?.icon ? getOptimizedImageUrl(extractIpfsUrlCid(homeMetadata.icon), 'S') : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({title: 'Notifications'})
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const headerData = await loadSiteHeaderData(parsedRequest)
  return wrapJSON(headerData satisfies NotificationsPagePayload)
}

export default function NotificationsRoute() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState} = unwrap<NotificationsPagePayload>(
    useLoaderData(),
  )
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider origin={origin} originHomeId={originHomeId} siteHost={siteHost} dehydratedState={dehydratedState}>
      <WebAccountFooter siteUid={originHomeId.uid} liftForPageFooter>
        <div className="flex min-h-screen flex-1 flex-col items-center">
          <WebSiteHeader
            homeMetadata={homeMetadata}
            originHomeId={originHomeId}
            siteHomeId={originHomeId}
            docId={null}
            origin={origin}
          />
          <NavigationLoadingContent className="flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-[var(--site-header-h)] sm:pt-0">
            <ClientOnly>
              <Suspense fallback={<Spinner />}>
                <WebNotificationsPage />
              </Suspense>
            </ClientOnly>
          </NavigationLoadingContent>
          <PageFooter className="w-full" hideDeviceLinkToast />
        </div>
      </WebAccountFooter>
    </WebSiteProvider>
  )
}
