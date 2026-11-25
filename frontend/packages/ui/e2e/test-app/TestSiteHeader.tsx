import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {SiteHeader} from '../../src/site-header'
import {TooltipProvider} from '../../src/tooltip'
import '../../../../apps/web/app/tailwind.css'

/**
 * E2E harness for the Seed site header. Mounts the REAL SiteHeader with mock
 * props reproducing the user's "Develop Seed" screenshot (site name, Home nav
 * item plus one "Seed Hypermedia" nav item, non-center layout) so the header's
 * text-baseline geometry can be measured against the real Tailwind build. The
 * right-hand account button is approximated by a 48px-tall stand-in so the
 * header's tallest child — and therefore its height — matches the real app.
 */

const SITE_UID = 'z6MkSiteFixture'

const mockUniversalClient = {
  request: async () => ({type: 'not-found'}),
  publish: async () => ({cids: []}),
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
    },
  },
})

const siteHomeId = hmId(SITE_UID)

function TestSiteHeader() {
  // SiteHeader prepends the fixed Home item itself (getSiteHeaderItems), so the
  // items prop is just the configured navigation. The default two items (Home +
  // Seed Hypermedia) reproduce the user's screenshot; extra items are added so
  // the responsive-overflow chevron appears at narrow desktop widths.
  const items = [
    {key: 'seed-hypermedia', id: hmId(SITE_UID, {path: ['seed-hypermedia']}), metadata: {name: 'Seed Hypermedia'}},
    {key: 'documents', id: hmId(SITE_UID, {path: ['documents']}), metadata: {name: 'Documents'}},
    {key: 'collections', id: hmId(SITE_UID, {path: ['collections']}), metadata: {name: 'Collections'}},
    {key: 'agents', id: hmId(SITE_UID, {path: ['agents']}), metadata: {name: 'Agents'}},
    {key: 'settings', id: hmId(SITE_UID, {path: ['settings']}), metadata: {name: 'Settings'}},
  ]
  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <UniversalAppProvider universalClient={mockUniversalClient as any} openUrl={() => {}} openRoute={() => {}}>
          <SiteHeader
            siteHomeId={siteHomeId}
            docId={siteHomeId}
            items={items}
            isCenterLayout={false}
            draftMetadata={{name: 'Develop Seed'}}
            rightActions={<div className="bg-muted size-12 rounded-full" />}
          />
        </UniversalAppProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TestSiteHeader />
  </React.StrictMode>,
)
