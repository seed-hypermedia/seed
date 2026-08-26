import {agentsRouteFromUrl} from '@/agents-routing'
import {clientLazy, ClientOnly} from '@/client-lazy'
import {SiteHeaderPayload} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {WebSiteHeader} from '@/web-site-header'
import {WebHeaderActions} from '@/web-utils'
import {unwrap} from '@/wrapping'
import {useLoaderData, useLocation} from '@remix-run/react'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {Spinner} from '@shm/ui/spinner'
import {Suspense, useMemo} from 'react'

// The agents chunk pulls in the editor and agents models; keep it out of the SSR bundle and load
// it only on the client, like the commenting editor.
const WebAgentsContent = clientLazy(async () => ({
  default: (await import('./agents-page-content')).default,
}))

/**
 * Shared body for the /hm/agents routes (index and splat). The loader payload is the standard site
 * header payload; the agents UI itself is client-only and talks straight to the agent server.
 */
export function AgentsPage() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState} = unwrap<SiteHeaderPayload>(useLoaderData())
  const location = useLocation()
  const initialRoute = useMemo(
    () => agentsRouteFromUrl(location.pathname, new URLSearchParams(location.search)),
    [location.pathname, location.search],
  )
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
      dehydratedState={dehydratedState}
      initialRoute={initialRoute}
    >
      {/* The agents pages are full-height panels (PanelContainer uses h-full and scrolls
          internally), so the surface must be a definite viewport height, not min-h-screen. */}
      <GeneralPageSurface className="h-dvh min-h-0 items-center">
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
              <WebAgentsContent />
            </Suspense>
          </ClientOnly>
        </NavigationLoadingContent>
        <PageFooter className="w-full" />
      </GeneralPageSurface>
    </WebSiteProvider>
  )
}
