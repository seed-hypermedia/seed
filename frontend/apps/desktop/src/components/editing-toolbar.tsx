import {useDeleteDraftDialog} from './delete-draft-dialog'
import {client} from '@/trpc'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  selectDraftId,
  selectSaveIndicatorStatus,
  useDocumentSelector,
  useDocumentSend,
} from '@shm/shared/models/use-document-machine'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {Check, Eye, Settings, Trash} from 'lucide-react'
import {ReactNode} from 'react'

function SaveIndicator() {
  const status = useDocumentSelector(selectSaveIndicatorStatus)

  if (status === 'saving') {
    return (
      <div className="flex items-center gap-1 opacity-60">
        <Spinner />
        <span className="text-xs">saving...</span>
      </div>
    )
  }

  if (status === 'saved') {
    return (
      <div className="flex items-center gap-1 opacity-60">
        <Check className="size-3" />
        <span className="text-xs">saved</span>
      </div>
    )
  }

  return null
}

/**
 * Combined right-actions for DocumentTools when editing.
 * Renders: save indicator, publish, preview, new button, three-dots (merged menu).
 * Must be rendered inside DocumentMachineProvider.
 */
export function EditingDocToolsRight({
  docId,
  existingMenuItems,
  newButton,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  newButton?: ReactNode
}) {
  const draftId = useDocumentSelector(selectDraftId)
  const send = useDocumentSend()
  const deleteDraftDialog = useDeleteDraftDialog()
  const route = useNavRoute()
  const navigate = useNavigate('replace')

  // Editing-specific menu items (prepended to existing items)
  const editingMenuItems: MenuItemType[] = []

  if (draftId) {
    editingMenuItems.push({
      key: 'doc-options',
      label: 'Document Options',
      icon: <Settings className="size-4" />,
      onClick: () => {
        navigate({
          ...route,
          panel: (route as any).panel?.key === 'options' ? null : ({key: 'options'} as any),
        } as any)
      },
    })
    editingMenuItems.push({
      key: 'discard-changes',
      label: 'Discard Changes',
      icon: <Trash className="size-4" />,
      variant: 'destructive' as const,
      onClick: () => {
        deleteDraftDialog.open({
          draftId,
          onSuccess: () => send({type: 'edit.discard'}),
        })
      },
    })
  }

  const allItems = [...editingMenuItems, ...existingMenuItems]

  return (
    <div className="flex items-center gap-1">
      <SaveIndicator />

      <Button size="sm" disabled={!draftId} onClick={() => send({type: 'publish.start'})}>
        Publish
      </Button>

      <Tooltip content="Preview Published Version">
        <Button
          size="icon"
          variant="outline"
          onClick={() => {
            client.createAppWindow.mutate({
              routes: [{key: 'preview', docId}],
              sidebarLocked: false,
              sidebarWidth: 0,
              accessoryWidth: 0,
            })
          }}
        >
          <Eye className="size-3.5" />
        </Button>
      </Tooltip>

      {newButton}

      <OptionsDropdown menuItems={allItems} align="end" side="bottom" />
      {deleteDraftDialog.content}
    </div>
  )
}
