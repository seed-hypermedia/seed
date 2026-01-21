import {AccessoryLayout} from '@/components/accessory-sidebar'
import {AddCollaboratorForm} from '@/components/collaborators-panel'
import {useDocumentSelection} from '@/components/document-accessory'
import {useAllDocumentCapabilities} from '@/models/access-control'
import {
  useDocumentEmbeds,
  useDocumentRead,
  useSiteNavigationItems,
} from '@/models/documents'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useChildrenActivity} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {
  CollaboratorsRoute,
  HMDocument,
  HMResourceFetchResult,
  hmId,
  PanelSelectionOptions,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {ReadOnlyCollaboratorsContent} from '@shm/ui/collaborators-page'
import {panelContainerStyles} from '@shm/ui/container'
import {DocumentTools} from '@shm/ui/document-tools'
import {
  PageDiscovery,
  PageNotFound,
  PageRedirected,
} from '@shm/ui/page-message-states'
import {SiteHeader} from '@shm/ui/site-header'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import React, {useEffect} from 'react'
import {OpenInPanelButton} from '@shm/ui/open-in-panel'
import {PageLayout} from '@shm/ui/page-layout'

export default function CollaboratorsPage() {
  const route = useNavRoute()

  const docId: UnpackedHypermediaId | null =
    route.key === 'collaborators' ? route.id : null
  if (!docId) throw new Error('Invalid route, no document id')
  if (route.key !== 'collaborators')
    throw new Error('Invalid route, key is not collaborators')

  useDocumentRead(docId)

  const panelKey = route.panel?.key as PanelSelectionOptions | undefined
  const replace = useNavigate('replace')

  const {selectionUI} = useDocumentSelection({docId})

  return (
    <div className="flex h-full flex-1 flex-col">
      <AccessoryLayout panelUI={selectionUI} panelKey={panelKey}>
        <CollaboratorsContent id={docId} route={route} />
      </AccessoryLayout>
    </div>
  )
}

function _CollaboratorsContent({
  id,
  route,
}: {
  id: UnpackedHypermediaId
  route: CollaboratorsRoute
}) {
  const replace = useNavigate('replace')
  const navigate = useNavigate()

  // Data for DocumentTools
  const directory = useChildrenActivity(id)
  const {data: collaborators} = useAllDocumentCapabilities(id)
  const interactionSummary = useInteractionSummary(id)

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: 'collaborators', id: account.data.id})
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'collaborators', id: redirectTarget})
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
        onNavigate={(target) => navigate({key: 'collaborators', id: target})}
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
      <CollaboratorsSiteHeader
        siteHomeEntity={siteHomeEntityData}
        docId={id}
        document={document}
      />
      <DocumentTools
        id={id}
        activeTab={
          route.panel
            ? (route.panel.key as 'activity' | 'discussions' | 'directory')
            : 'collaborators'
        }
        commentsCount={interactionSummary.data?.comments || 0}
        collabsCount={collaborators?.filter((c) => c.role !== 'agent').length}
        directoryCount={directory.data?.length}
      />
      <PageLayout
        title="Collaborators"
        centered
        headerRight={
          <OpenInPanelButton id={id} panelRoute={{key: 'collaborators', id}} />
        }
      >
        <div className="flex flex-col gap-4 p-4">
          <AddCollaboratorForm id={id} />
          <ReadOnlyCollaboratorsContent docId={id} />
        </div>
      </PageLayout>
    </div>
  )
}

const CollaboratorsContent = React.memo(_CollaboratorsContent)
const CollaboratorsSiteHeader = React.memo(_CollaboratorsSiteHeader)

function _CollaboratorsSiteHeader({
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
  if (route.key !== 'collaborators') return null

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
