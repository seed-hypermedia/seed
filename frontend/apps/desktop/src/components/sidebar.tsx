import {grpcClient} from '@/grpc-client'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMyAccountIds} from '@/models/daemon'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {defaultJoinedSiteUid, hmId} from '@shm/shared'
import {getRouteSpaceUid} from '@shm/shared/routes'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {SiteSidebar, SiteSidebarDocuments} from '@shm/ui/site-sidebar'
import {useSiteSidebar} from '@shm/ui/site-sidebar-context'
import {useEffect, useState} from 'react'
import {useCreateDocumentMenuItem} from './create-doc-button'
import {GenericSidebarContainer} from './sidebar-base'
import {ExploreButton} from './titlebar-common'

/** The unified desktop sidebar, retaining the site's tree on non-site pages. */
export function AppSidebar() {
  const route = useNavRoute()
  const selectedAccountId = useSelectedAccountId()
  useEffect(() => {
    if (selectedAccountId) return
    grpcClient.subscriptions
      .subscribe({account: defaultJoinedSiteUid, path: '', recursive: true})
      .then(() => invalidateQueries([queryKeys.SUBSCRIPTIONS]))
      .catch((error) => console.error('Failed to subscribe to default joined site', error))
  }, [selectedAccountId])
  const ownSites = useMyAccountIds()
  const routeSite = getRouteSpaceUid(route)
  const [lastSite, setLastSite] = useState<string | null>(() => {
    try {
      return localStorage.getItem('seed.sidebar.last-site')
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (!routeSite) return
    setLastSite(routeSite)
    try {
      localStorage.setItem('seed.sidebar.last-site', routeSite)
    } catch {
      /* Session navigation still works. */
    }
  }, [routeSite])
  const siteId = hmId(routeSite || lastSite || selectedAccountId || defaultJoinedSiteUid)
  const navigate = useNavigate()
  const sidebar = useSiteSidebar()
  return (
    <GenericSidebarContainer>
      <SiteSidebar
        siteId={siteId}
        ownSiteUids={ownSites.data ?? []}
        onNavigate={(id) => navigate({key: 'document', id})}
        explore={<ExploreButton />}
      >
        <div className="h-full min-h-0" ref={sidebar?.setTarget}>
          {!sidebar?.hasPageContent && <FallbackDocuments siteId={siteId} />}
        </div>
      </SiteSidebar>
    </GenericSidebarContainer>
  )
}

function FallbackDocuments({siteId}: {siteId: ReturnType<typeof hmId>}) {
  const navigate = useNavigate()
  const {menuItem, content} = useCreateDocumentMenuItem({locationId: siteId})
  return (
    <>
      <SiteSidebarDocuments
        siteId={siteId}
        activeDocumentId={null}
        createMenuItem={menuItem}
        onNavigate={(id) => navigate({key: 'document', id})}
      />
      {content}
    </>
  )
}
