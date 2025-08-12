import {focusDraftBlock} from '@/draft-focusing'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {
  useCreateDraft,
  useDocumentEmbeds,
  useListSite,
} from '@/models/documents'
import {useSubscribedResource} from '@/models/entities'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getDraftNodesOutline, UnpackedHypermediaId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Add} from '@shm/ui/icons'
import {SmallListItem} from '@shm/ui/list-item'
import {
  DocNavigationWrapper,
  DocumentOutline,
  DraftOutline,
  useNodesOutline,
} from '@shm/ui/navigation'
import {ReactNode, useMemo} from 'react'

export function DocNavigation({showCollapsed}: {showCollapsed: boolean}) {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('DocNavigation only supports document route')
  const {id} = route
  const entity = useSubscribedResource(id, true) // recursive subscriptions to make sure children get loaded
  const navigate = useNavigate('replace')
  const document =
    // @ts-ignore
    entity.data?.type === 'document' ? entity.data.document : undefined
  const createDraft = useCreateDraft({
    locationUid: id.uid,
    locationPath: id.path || undefined,
  })
  const capability = useSelectedAccountCapability(id)
  const siteList = useListSite(id)
  const siteListQuery = siteList?.data ? {in: id, results: siteList.data} : null

  const embeds = useDocumentEmbeds(document)

  let createDirItem: null | ((opts: {indented: number}) => ReactNode) = null
  if (roleCanWrite(capability?.role)) {
    createDirItem = ({indented}) => (
      <SmallListItem
        icon={<Add className="size-4" />}
        title="Create"
        onClick={createDraft}
        indented={indented}
      />
    )
  }
  const outline = useNodesOutline(document, id, embeds)

  if (!document || !siteListQuery || !outline.length) return null

  if (outline.length <= 1) return null

  return (
    <DocNavigationWrapper showCollapsed={showCollapsed} outline={outline}>
      <DocumentOutline
        onActivateBlock={(blockId) => {
          navigate({
            key: 'document',
            id: hmId(id.uid, {blockRef: blockId, path: id.path}),
          })
          const targetElement = window.document.getElementById(blockId)
          if (targetElement) {
            targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
          } else {
            console.error('Element not found:', blockId)
          }
        }}
        outline={outline}
        id={id}
        activeBlockId={id.blockRef}
      />
    </DocNavigationWrapper>
  )
}

export function DocNavigationDraftLoader({
  showCollapsed,
  id,
}: {
  showCollapsed: boolean
  id?: UnpackedHypermediaId
}) {
  const route = useNavRoute()
  if (route.key !== 'draft')
    throw new Error('DocNavigationDraftLoader only supports draft route')
  const draftQuery = useDraft(route.id)
  // const id = useMemo(() => {
  //   let uId = route.editUid || draftQuery.data?.editUid
  //   let path = route.editPath || draftQuery.data?.editPath
  //   if (!uId) {
  //     const locationPath = route.locationPath || draftQuery.data?.locationPath
  //     if (locationPath) {
  //       uId = route.locationUid || draftQuery.data?.locationUid
  //       path = locationPath
  //     }
  //   }
  //   if (uId) {
  //     return hmId( uId, {path})
  //   }
  //   return undefined
  // }, [route, draftQuery.data])

  const entity = useResource(id)
  const draft = draftQuery?.data
  const metadata =
    draftQuery?.data?.metadata ||
    (entity.data?.type === 'document'
      ? entity.data.document?.metadata
      : undefined)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined

  if (!document) return null

  const siteList = useListSite(id)
  const siteListQuery =
    siteList?.data && id ? {in: hmId(id.uid), results: siteList.data} : null
  const embeds = useDocumentEmbeds(document)

  const outline = useMemo(() => {
    if (!draft?.content) return []
    return getDraftNodesOutline(draft.content, id, embeds)
  }, [id, draft, embeds])

  if (!siteListQuery || !metadata) return null

  return (
    <DocNavigationWrapper showCollapsed={showCollapsed} outline={outline}>
      {draft && id ? (
        <DraftOutline
          outline={outline}
          onActivateBlock={(blockId: string) => {
            focusDraftBlock(id?.id, blockId)
          }}
          id={id}
        />
      ) : null}
    </DocNavigationWrapper>
  )
}
