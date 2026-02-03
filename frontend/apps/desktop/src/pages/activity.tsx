import {useAllDocumentCapabilities} from '@/models/access-control'
import {useDocumentEmbeds, useSiteNavigationItems} from '@/models/documents'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useChildrenActivity} from '@/models/library'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {
  ActivityRoute,
  HMDocument,
  hmId,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {panelContainerStyles} from '@shm/ui/container'
import {DocumentTools} from '@shm/ui/document-tools'
import {Feed} from '@shm/ui/feed'
import {OpenInPanelButton} from '@shm/ui/open-in-panel'
import {PageLayout} from '@shm/ui/page-layout'
import {
  PageDiscovery,
  PageNotFound,
  PageRedirected,
} from '@shm/ui/page-message-states'
import {SiteHeader} from '@shm/ui/site-header'
import {toast} from '@shm/ui/toast'
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {cn} from '@shm/ui/utils'
import React, {useEffect} from 'react'

function _ActivityContent({
  id,
  route,
}: {
  id: UnpackedHypermediaId
  route: ActivityRoute
}) {
  const replace = useNavigate('replace')
  const navigate = useNavigate()
  const selectedAccount = useSelectedAccount()

  // Data for DocumentTools
  const directory = useChildrenActivity(id)
  const {data: collaborators} = useAllDocumentCapabilities(id)
  const interactionSummary = useInteractionSummary(id)

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  // Scroll restoration for activity feed
  const scrollRef = useScrollRestoration({
    scrollId: `activity-page-${id.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })

  // Reset scroll when filter changes
  useEffect(() => {
    if (scrollRef.current && route.filterEventType) {
      const viewport = scrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLElement
      if (viewport) {
        viewport.scrollTo({top: 0, behavior: 'instant'})
      }
    }
  }, [route.filterEventType])

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: 'activity', id: account.data.id})
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'activity', id: redirectTarget})
      }
    },
  })

  const siteHomeEntity = useResource(id.path?.length ? hmId(id.uid) : id, {
    subscribed: true,
    recursive: id.path?.length ? false : true,
  })

  const document =
    // @ts-ignore
    resource.data?.type === 'document' ? resource.data.document : undefined

  if (resource.isInitialLoading) return null

  if (resource.data?.type === 'redirect') {
    return (
      <PageRedirected
        docId={id}
        redirectTarget={resource.data.redirectTarget}
        onNavigate={(target) => navigate({key: 'activity', id: target})}
      />
    )
  }

  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return <PageDiscovery />
    }
    return <PageNotFound />
  }

  // Only pass siteHomeEntity if it's loaded and is a document type
  const siteHomeEntityData =
    !siteHomeEntity.isLoading &&
    // @ts-ignore
    siteHomeEntity.data?.type === 'document'
      ? // @ts-ignore
        siteHomeEntity.data
      : null

  return (
    <div className={cn(panelContainerStyles)}>
      <ActivitySiteHeader
        siteHomeEntity={siteHomeEntityData}
        docId={id}
        document={document}
      />
      <DocumentTools
        id={id}
        activeTab={
          route.panel
            ? (route.panel.key as 'discussions' | 'collaborators' | 'directory')
            : 'activity'
        }
        commentsCount={interactionSummary.data?.comments || 0}
        collabsCount={collaborators?.filter((c) => c.role !== 'agent').length}
        directoryCount={directory.data?.length}
      />
      <PageLayout
        title="Activity"
        centered
        headerRight={
          <OpenInPanelButton id={id} panelRoute={{key: 'activity', id}} />
        }
      >
        <Feed
          size="md"
          centered
          filterResource={id.id}
          currentAccount={selectedAccount?.id.uid || ''}
          filterEventType={route.filterEventType || []}
        />
      </PageLayout>
    </div>
  )
}

const ActivityContent = React.memo(_ActivityContent)
const ActivitySiteHeader = React.memo(_ActivitySiteHeader)

function _ActivitySiteHeader({
  siteHomeEntity,
  docId,
  document,
}: {
  siteHomeEntity: HMResourceFetchResult | undefined | null
  docId: UnpackedHypermediaId
  document?: HMDocument
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const navItems = useSiteNavigationItems(siteHomeEntity)
  const notifyServiceHost = useNotifyServiceHost()
  const embeds = useDocumentEmbeds(document)

  if (!siteHomeEntity) return null
  if (route.key !== 'activity') return null

  return (
    <SiteHeader
      siteHomeId={hmId(siteHomeEntity.id.uid)}
      items={navItems}
      docId={docId}
      isCenterLayout={
        siteHomeEntity.document?.metadata.theme?.headerLayout === 'Center' ||
        siteHomeEntity.document?.metadata.layout ===
          'Seed/Experimental/Newspaper'
      }
      document={document}
      siteHomeDocument={siteHomeEntity.document}
      embeds={embeds}
      onBlockFocus={(blockId) => {
        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      onShowMobileMenu={() => {}}
      isMainFeedVisible={false}
      notifyServiceHost={notifyServiceHost}
    />
  )
}
