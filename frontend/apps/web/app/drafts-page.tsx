import {clientLazy, ClientOnly} from '@/client-lazy'
import {SiteHeaderPayload} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {WebSiteHeader, WebSidebarLayout} from '@/web-site-header'
import {WebHeaderActions} from '@/web-utils'
import {unwrap} from '@/wrapping'
import {useLoaderData} from '@remix-run/react'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {Spinner} from '@shm/ui/spinner'
import {Suspense} from 'react'

// Local drafts are available only in the browser.
const WebDraftsContent = clientLazy(async () => ({
  default: (await import('./web-drafts-content')).default,
}))

/** Render the local Drafts page inside the standard web navigation. */
export function DraftsPage() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState} = unwrap<SiteHeaderPayload>(useLoaderData())
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
      dehydratedState={dehydratedState}
      initialRoute={{key: 'drafts'}}
    >
      <WebSidebarLayout siteHomeId={originHomeId}>
        <GeneralPageSurface className="min-h-dvh items-center">
          <WebSiteHeader
            homeMetadata={homeMetadata}
            originHomeId={originHomeId}
            siteHomeId={originHomeId}
            docId={null}
            origin={origin}
            rightActions={<WebHeaderActions siteUid={originHomeId.uid} />}
          />
          <NavigationLoadingContent className="flex min-h-0 w-full flex-1 flex-col gap-4 pt-[var(--site-header-h)] sm:pt-0">
            <ClientOnly>
              <Suspense fallback={<Spinner />}>
                <WebDraftsContent />
              </Suspense>
            </ClientOnly>
          </NavigationLoadingContent>
          <PageFooter className="w-full" />
        </GeneralPageSurface>
      </WebSidebarLayout>
    </WebSiteProvider>
  )
}
