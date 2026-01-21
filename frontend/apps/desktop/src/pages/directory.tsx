import {useAllDocumentCapabilities} from '@/models/access-control'
import {useDocumentEmbeds, useSiteNavigationItems} from '@/models/documents'
import {useExistingDraft} from '@/models/drafts'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useChildrenActivity} from '@/models/library'
import {NewSubDocumentButton, useCanCreateSubDocument} from '@/pages/document'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocumentDirectorySelection,
  HMDocument,
  hmId,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {panelContainerStyles} from '@shm/ui/container'
import {DirectoryPageContent} from '@shm/ui/directory-page'
import {DocumentTools} from '@shm/ui/document-tools'
import {OpenInPanelButton} from '@shm/ui/open-in-panel'
import {
  PageDiscovery,
  PageNotFound,
  PageRedirected,
} from '@shm/ui/page-message-states'
import {SiteHeader} from '@shm/ui/site-header'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import React, {useEffect} from 'react'

function _DirectoryContent({
  id,
  route,
}: {
  id: UnpackedHypermediaId
  route: DocumentDirectorySelection
}) {
  const replace = useNavigate('replace')
  const navigate = useNavigate()
  const canCreate = useCanCreateSubDocument(id)

  const existingDraft = useExistingDraft(route)
  console.log('~~ Existing draft:', existingDraft)
  // Data for DocumentTools
  const directory = useChildrenActivity(id)
  const {data: collaborators} = useAllDocumentCapabilities(id)
  const interactionSummary = useInteractionSummary(id)

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: 'directory', id: account.data.id})
    }
  }, [account.data])

  const resource = useResource(id, {
    subscribed: true,
    recursive: true,
    onRedirectOrDeleted: ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'directory', id: redirectTarget})
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
        onNavigate={(target) => navigate({key: 'directory', id: target})}
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
      <DirectorySiteHeader
        siteHomeEntity={siteHomeEntityData}
        docId={id}
        document={document}
      />
      <DocumentTools
        id={id}
        activeTab={
          route.panel
            ? (route.panel.key as 'activity' | 'discussions' | 'collaborators')
            : 'directory'
        }
        isContentDraft={!!existingDraft}
        commentsCount={interactionSummary.data?.comments || 0}
        collabsCount={collaborators?.filter((c) => c.role !== 'agent').length}
        directoryCount={directory.data?.length}
      />
      <DirectoryPageContent
        docId={id}
        header={
          canCreate ? <NewSubDocumentButton locationId={id} /> : undefined
        }
        headerRight={
          <OpenInPanelButton id={id} panelRoute={{key: 'directory', id}} />
        }
        canCreate={canCreate}
      />
    </div>
  )
}

const DirectoryContent = React.memo(_DirectoryContent)
const DirectorySiteHeader = React.memo(_DirectorySiteHeader)

function _DirectorySiteHeader({
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
  if (route.key !== 'directory') return null

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
