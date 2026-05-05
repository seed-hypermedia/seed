import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useCreateDraft, useDocumentEmbeds, useListSite} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {useResource} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Add} from '@shm/ui/icons'
import {SmallListItem} from '@shm/ui/list-item'
import {DocNavigationWrapper, DocumentOutline, useNodesOutline} from '@shm/ui/navigation'
import {ReactNode} from 'react'

export function DocNavigation({showCollapsed}: {showCollapsed: boolean}) {
  const route = useNavRoute()
  if (route.key !== 'document') throw new Error('DocNavigation only supports document route')
  const {id} = route
  const entity = useResource(id, {subscribed: true, recursive: true}) // recursive subscriptions to make sure children get loaded
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
        onClick={() => createDraft()}
        indented={indented}
      />
    )
  }
  const outline = useNodesOutline(document, id, embeds)

  if (!document || !siteListQuery || !outline.length) return null

  // if (outline.length <= 1) return null

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
