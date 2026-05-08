import {useGatewayUrl} from '@/models/gateway-settings'
import {client} from '@/trpc'
import {pathNameify} from '@shm/shared/utils/path'
import {computeInlineDraftPublishPath} from '@shm/shared/utils/publish-paths'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {createSiteUrl, createWebHMUrl, hmId} from '@shm/shared/utils/entity-id-url'
import {
  type EditingToolbarCallbacks,
  EditingDocToolsRight as SharedEditingDocToolsRight,
  DraftActionsToolbar as SharedDraftActionsToolbar,
} from '@shm/ui/editing-toolbar'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {ReactNode, useCallback, useMemo} from 'react'
import {useDeleteDraftDialog} from './delete-draft-dialog'

export {PublishPopoverBody} from '@shm/ui/editing-toolbar'

/** Resolve the public URL for a document, including site URL from the site home resource. */
function useDocumentUrlWithSite(ownerUid: string): (docId: UnpackedHypermediaId) => string | null {
  const gatewayUrl = useGatewayUrl()
  const siteHomeResource = useResource(hmId(ownerUid))
  const siteUrl =
    siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document?.metadata?.siteUrl : undefined

  return useCallback(
    (docId: UnpackedHypermediaId) => {
      if (!gatewayUrl.data) return null
      if (siteUrl) {
        return createSiteUrl({path: docId.path, hostname: siteUrl})
      }
      return createWebHMUrl(docId.uid, {path: docId.path, hostname: gatewayUrl.data})
    },
    [gatewayUrl.data, siteUrl],
  )
}

/** Build all desktop-specific callbacks for the shared toolbar. */
function useDesktopToolbarCallbacks(docId: UnpackedHypermediaId): {
  callbacks: EditingToolbarCallbacks
  deleteDraftDialog: ReturnType<typeof useDeleteDraftDialog>
} {
  const deleteDraftDialog = useDeleteDraftDialog()
  const navigate = useNavigate('replace')
  const getDocumentUrl = useDocumentUrlWithSite(docId.uid)

  const callbacks: EditingToolbarCallbacks = useMemo(
    () => ({
      getDocumentUrl,
      onOpenPreview: (dId: string | null, id: UnpackedHypermediaId) => {
        const previewRoute = dId ? {key: 'preview' as const, draftId: dId} : {key: 'preview' as const, docId: id}
        client.createAppWindow.mutate({
          routes: [previewRoute],
          sidebarLocked: false,
          sidebarWidth: 0,
          accessoryWidth: 0,
        })
      },
      onDiscardConfirm: (discardDraftId: string, send) => {
        deleteDraftDialog.open({
          draftId: discardDraftId,
          onSuccess: () => send({type: 'edit.discard'}),
        })
      },
      slugify: pathNameify,
      computeFirstPublishPath: computeInlineDraftPublishPath,
      onGoToVersions: (id: UnpackedHypermediaId) => {
        navigate({
          key: 'document',
          id,
          panel: {key: 'activity', id, filterEventType: ['Ref']},
        } as any)
      },
    }),
    [getDocumentUrl, deleteDraftDialog, navigate],
  )

  return {callbacks, deleteDraftDialog}
}

/**
 * Combined right-actions for DocumentTools when editing.
 * Desktop wrapper: injects desktop-specific callbacks into the shared component.
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
  const {callbacks, deleteDraftDialog} = useDesktopToolbarCallbacks(docId)
  return (
    <>
      <SharedEditingDocToolsRight
        docId={docId}
        existingMenuItems={existingMenuItems}
        newButton={newButton}
        {...callbacks}
      />
      {deleteDraftDialog.content}
    </>
  )
}

/**
 * Slim toolbar shown when a draft exists but not actively editing.
 * Desktop wrapper: injects desktop-specific callbacks into the shared component.
 * Must be rendered inside DocumentMachineProvider.
 */
export function DraftActionsToolbar({
  docId,
  existingMenuItems,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
}) {
  const {callbacks, deleteDraftDialog} = useDesktopToolbarCallbacks(docId)
  return (
    <>
      <SharedDraftActionsToolbar docId={docId} existingMenuItems={existingMenuItems} {...callbacks} />
      {deleteDraftDialog.content}
    </>
  )
}
