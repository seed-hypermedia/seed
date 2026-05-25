import {useDraft} from '@/models/accounts'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {selectDraftId, useDocumentSelector} from '@shm/shared/models/use-document-machine'
import {createSiteUrl, createWebHMUrl, hmId} from '@shm/shared/utils/entity-id-url'
import {pathNameify} from '@shm/shared/utils/path'
import {computeInlineDraftPublishPath} from '@shm/shared/utils/publish-paths'
import {
  type EditingToolbarCallbacks,
  DraftActionsToolbar as SharedDraftActionsToolbar,
  EditingDocToolsRight as SharedEditingDocToolsRight,
} from '@shm/ui/editing-toolbar'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {useCallback, useMemo} from 'react'
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

/**
 * Walks the current draft's content for embed blocks that still
 * point to unpublished child drafts and returns the unique count.
 * Auto-link clears draftId when the child publishes, so the count
 * drops naturally. Must be rendered inside DocumentMachineProvider.
 */
function useUnpublishedChildCount(): number {
  const draftId = useDocumentSelector(selectDraftId)
  const parentDraft = useDraft(draftId ?? undefined)
  return useMemo(() => {
    const content = parentDraft.data?.content
    if (!content) return 0
    const ids = new Set<string>()
    const walk = (blocks: any[]) => {
      for (const b of blocks) {
        if (b?.type === 'embed' && b?.props?.draftId) {
          ids.add(b.props.draftId)
        }
        if (b?.children?.length) walk(b.children)
      }
    }
    walk(content as any[])
    return ids.size
  }, [parentDraft.data?.content])
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
      onDiscardConfirm: (discardDraftId: string, send) => {
        deleteDraftDialog.open({
          draftId: discardDraftId,
          onConfirm: () => send({type: 'edit.discard'}),
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
  getUnpublishedChildCount,
}: {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  getUnpublishedChildCount?: () => number
}) {
  const {callbacks, deleteDraftDialog} = useDesktopToolbarCallbacks(docId)
  const unpublishedChildCount = useUnpublishedChildCount()
  return (
    <>
      <SharedEditingDocToolsRight
        docId={docId}
        existingMenuItems={existingMenuItems}
        unpublishedChildCount={unpublishedChildCount}
        getUnpublishedChildCount={getUnpublishedChildCount}
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
  const unpublishedChildCount = useUnpublishedChildCount()
  return (
    <>
      <SharedDraftActionsToolbar
        docId={docId}
        existingMenuItems={existingMenuItems}
        unpublishedChildCount={unpublishedChildCount}
        {...callbacks}
      />
      {deleteDraftDialog.content}
    </>
  )
}
