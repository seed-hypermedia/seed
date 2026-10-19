import {ClientOnly} from '@/client-lazy'
import type {SiteHeaderPayload} from '@/loaders'
import {NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {WebSiteHeader} from '@/web-site-header'
import {WebHeaderActions} from '@/web-utils'
import {hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {Spinner} from '@shm/ui/spinner'
import {lazy, Suspense, useMemo} from 'react'

/** Loader payload for a space's full-page settings, independent of the gateway's own space. */
export type WebSpaceSettingsPayload = SiteHeaderPayload & {
  kind: 'site-settings'
  siteUid: string
  section?: 'identity' | 'navigation' | 'web-domain'
  domain?: string
}

const LazySettingsPage = lazy(() =>
  import('./components/web-space-settings').then((module) => ({default: module.WebSpaceSettingsPage})),
)
const LazyDomainSetupPage = lazy(() =>
  import('./components/web-hosting').then((module) => ({default: module.WebDomainSetupPage})),
)

/** Site chrome and navigation context for desktop-style space settings on the web. */
export function WebSpaceSettingsScreen({payload}: {payload: WebSpaceSettingsPayload}) {
  const {origin, originHomeId, siteHost, dehydratedState, siteUid, section, domain} = payload
  const siteId = useMemo(() => hmId(siteUid, {latest: true}), [siteUid])
  if (!originHomeId) return <h1>Space unavailable</h1>
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
      dehydratedState={dehydratedState}
      initialRoute={{key: 'site-settings', id: siteId, tab: section, ...(domain ? {domain} : {})}}
    >
      <SettingsScreenContent payload={payload} />
    </WebSiteProvider>
  )
}

function SettingsScreenContent({payload}: {payload: WebSpaceSettingsPayload}) {
  const {origin, originHomeId, homeMetadata, siteUid, section, domain} = payload
  const siteId = useMemo(() => hmId(siteUid, {latest: true}), [siteUid])
  const resource = useResource(siteId)
  const viewedMetadata = resource.data?.type === 'document' ? resource.data.document.metadata : null
  return (
    <GeneralPageSurface className="h-dvh min-h-0 overflow-hidden">
      <div className="shrink-0">
        <WebSiteHeader
          homeMetadata={viewedMetadata ?? (originHomeId?.uid === siteUid ? homeMetadata : null)}
          originHomeId={originHomeId!}
          siteHomeId={siteId}
          docId={null}
          origin={origin}
          noScroll
          rightActions={<WebHeaderActions siteUid={siteUid} />}
        />
      </div>
      <NavigationLoadingContent className="flex min-h-0 w-full flex-1 flex-col pt-[var(--site-header-h)] sm:pt-0">
        <ClientOnly>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Spinner />
              </div>
            }
          >
            {domain ? (
              <LazyDomainSetupPage key={`${siteUid}:${domain}`} siteId={siteId} hostname={domain} />
            ) : (
              <LazySettingsPage key={siteUid} siteUid={siteUid} section={section} />
            )}
          </Suspense>
        </ClientOnly>
      </NavigationLoadingContent>
    </GeneralPageSurface>
  )
}
