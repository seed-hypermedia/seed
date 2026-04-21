import {EditNavPopover} from '@/components/edit-navigation-popover'
import {HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {DocumentMachineSnapshot, useDocumentSelector, useDocumentSend} from '@shm/shared/models/use-document-machine'

function selectMachineNavigation(snapshot: DocumentMachineSnapshot): HMNavigationItem[] | undefined {
  return snapshot.context.navigation
}

export function EditNavHeaderPane({homeId}: {homeId: UnpackedHypermediaId}) {
  const {canEdit, beginEditIfNeeded} = useEditorGate()
  const send = useDocumentSend()
  const machineNavigation = useDocumentSelector(selectMachineNavigation)
  const homeResource = useResource(homeId, {subscribed: true})
  const homeDocument = homeResource.data?.type === 'document' ? homeResource.data.document : null

  if (!canEdit) return null

  const publishedNav: HMNavigationItem[] =
    homeDocument?.detachedBlocks?.navigation?.children
      ?.map((child) => {
        const linkBlock = child.block.type === 'Link' ? child.block : null
        if (!linkBlock) return null
        return {
          id: linkBlock.id,
          type: 'Link',
          text: linkBlock.text || '',
          link: linkBlock.link ?? '',
        } satisfies HMNavigationItem
      })
      .filter((item): item is HMNavigationItem => item !== null) ?? []

  const docNav = machineNavigation ?? publishedNav

  const editDocNav = (navigation: HMNavigationItem[]) => {
    beginEditIfNeeded()
    send({type: 'change.navigation', navigation})
  }

  return <EditNavPopover docNav={docNav} editDocNav={editDocNav} homeId={homeId} />
}
