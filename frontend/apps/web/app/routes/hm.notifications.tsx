import {loadSpaceHeaderData, SpaceHeaderPayload} from '@/loaders'
import {defaultSpaceIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, NavigationLoadingContent, WebSpaceProvider} from '@/providers'
import {parseRequest} from '@/request'
import {WebSpaceHeader} from '@/web-space-header'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {ClientOnly} from '@/client-lazy'
import {WebNotificationsPage} from '@/notifications-page-content'
import {WebHeaderActions} from '@/web-utils'
import {Suspense} from 'react'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {Spinner} from '@shm/ui/spinner'

type NotificationsPagePayload = SpaceHeaderPayload

export const meta: MetaFunction = ({data}) => {
  const {homeMetadata} = unwrap<NotificationsPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = homeMetadata?.icon ? getOptimizedImageUrl(extractIpfsUrlCid(homeMetadata.icon), 'S') : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSpaceIcon,
    type: 'image/png',
  })
  meta.push({title: 'Notifications'})
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, async () => {
    const headerData = await loadSpaceHeaderData(parsedRequest)
    return wrapJSON(headerData satisfies NotificationsPagePayload)
  })
}

export default function NotificationsRoute() {
  const {originHomeId, spaceHost, origin, homeMetadata, dehydratedState} =
    unwrap<NotificationsPagePayload>(useLoaderData())
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSpaceProvider
      origin={origin}
      originHomeId={originHomeId}
      spaceHost={spaceHost}
      dehydratedState={dehydratedState}
    >
      <GeneralPageSurface className="min-h-screen items-center">
        <WebSpaceHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          spaceHomeId={originHomeId}
          docId={null}
          origin={origin}
          rightActions={<WebHeaderActions spaceUid={originHomeId.uid} />}
        />
        <NavigationLoadingContent className="flex w-full flex-1 flex-col gap-4 pt-[var(--space-header-h)] sm:pt-0">
          <ClientOnly>
            <Suspense fallback={<Spinner />}>
              <WebNotificationsPage />
            </Suspense>
          </ClientOnly>
        </NavigationLoadingContent>
        <PageFooter className="w-full" />
      </GeneralPageSurface>
    </WebSpaceProvider>
  )
}
