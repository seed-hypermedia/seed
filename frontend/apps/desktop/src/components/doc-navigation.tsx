import {focusDraftBlock} from '@/draft-focusing'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {
  useAccountDraftList,
  useCreateDraft,
  useDocumentEmbeds,
  useListSite,
} from '@/models/documents'
import {useSubscribedEntity} from '@/models/entities'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {useEntity} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SmallListItem} from '@shm/ui/list-item'
import {
  DocDirectory,
  DocNavigationWrapper,
  DocumentOutline,
  DraftOutline,
} from '@shm/ui/navigation'
import {Plus as Add} from '@tamagui/lucide-icons'
import {ReactNode, useMemo} from 'react'

export function DocNavigation({showCollapsed}: {showCollapsed: boolean}) {
  return (
    <DocNavigationWrapper showCollapsed={showCollapsed}>
      <DocNavigationLoader />
    </DocNavigationWrapper>
  )
}

export function DocNavigationLoader({onPress}: {onPress?: () => void}) {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('DocNavigation only supports document route')
  const {id} = route
  const entity = useSubscribedEntity(id, true) // recursive subscriptions to make sure children get loaded
  const navigate = useNavigate('replace')
  const document = entity.data?.document
  const createDraft = useCreateDraft({
    locationUid: id.uid,
    locationPath: id.path || undefined,
  })
  const capability = useMyCapability(id)
  const siteList = useListSite(id)
  const isHome = !id.path?.length
  const siteListQuery = siteList?.data ? {in: id, results: siteList.data} : null

  const embeds = useDocumentEmbeds(document)

  let createDirItem: null | ((opts: {indented: number}) => ReactNode) = null
  if (roleCanWrite(capability?.role)) {
    createDirItem = ({indented}) => (
      <SmallListItem
        icon={Add}
        title="Create"
        onPress={createDraft}
        color="$green10"
        indented={indented}
      />
    )
  }
  const drafts = useAccountDraftList(id?.uid)

  if (!document || !siteListQuery) return null

  return (
    <>
      <DocumentOutline
        onActivateBlock={(blockId) => {
          onPress?.()
          navigate({
            key: 'document',
            id: hmId(id.type, id.uid, {blockRef: blockId, path: id.path}),
          })
          const targetElement = window.document.getElementById(blockId)
          if (targetElement) {
            targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
          } else {
            console.error('Element not found:', blockId)
          }
        }}
        document={document}
        id={id}
        supportDocuments={embeds}
        activeBlockId={id.blockRef}
      />
      {!isHome && (
        <DocDirectory
          id={id}
          drafts={drafts.data}
          supportQueries={[siteListQuery]}
          createDirItem={createDirItem}
          onPress={onPress}
        />
      )}
    </>
  )
}

export function DocNavigationDraftLoader({
  showCollapsed,
}: {
  showCollapsed: boolean
}) {
  const route = useNavRoute()
  if (route.key !== 'draft')
    throw new Error('DocNavigationDraftLoader only supports draft route')
  const draftQuery = useDraft(route.id)
  const id = useMemo(() => {
    let uId = route.editUid || draftQuery.data?.editUid
    let path = route.editPath || draftQuery.data?.editPath
    if (uId) {
      return hmId('d', uId, {path})
    }
    return undefined
  }, [route, draftQuery.data])

  const entity = useEntity(id)
  const draft = draftQuery?.data
  const metadata = draftQuery?.data?.metadata || entity.data?.document?.metadata

  const document = entity.data?.document

  const siteList = useListSite(id)
  const siteListQuery =
    siteList?.data && id
      ? {in: hmId('d', id.uid), results: siteList.data}
      : null
  const embeds = useDocumentEmbeds(document)

  const drafts = useAccountDraftList(id?.uid)

  if (!siteListQuery || !metadata) return null

  return (
    <DocNavigationWrapper showCollapsed={showCollapsed}>
      {draft && id ? (
        <DraftOutline
          onActivateBlock={(blockId: string) => {
            focusDraftBlock(id?.id, blockId)
          }}
          draft={draft}
          id={id}
          supportDocuments={embeds}
          onPress={() => {}}
        />
      ) : null}
      {id ? (
        <DocDirectory
          id={id}
          drafts={drafts.data}
          supportQueries={[siteListQuery]}
        />
      ) : null}
    </DocNavigationWrapper>
  )
}
